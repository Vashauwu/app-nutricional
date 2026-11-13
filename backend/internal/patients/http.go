package patients

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

type Controller struct {
	svc  *Service
	auth *auth.Service
	log  *slog.Logger
}

func NewController(svc *Service, authSvc *auth.Service, log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: authSvc, log: log}
}

const idKey = "patient_id"

// nz garantiza `[]` (no `null`) en las listas vacías: el contrato JSON no debe obligar al cliente a defenderse.
func nz[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func actor(c *gin.Context) Actor {
	id := auth.IdentityFrom(c)
	return Actor{ID: id.UserID, RequestID: middleware.GetRequestID(c), IP: c.ClientIP(), UA: c.Request.UserAgent()}
}

func fail(c *gin.Context, log *slog.Logger, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{
			Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: middleware.GetRequestID(c), Fields: ve}})
	case errors.Is(err, ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No encontrado.")
	case errors.Is(err, ErrEmailTaken):
		shared.AbortWithError(c, http.StatusConflict, "email_taken", ErrEmailTaken.Error()+".")
	case errors.Is(err, ErrAccountExists):
		shared.AbortWithError(c, http.StatusConflict, "account_exists", ErrAccountExists.Error()+".")
	case errors.Is(err, ErrNotAdult):
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{
			Code: "not_adult", Message: ErrNotAdult.Error() + ".", RequestID: middleware.GetRequestID(c), Fields: map[string]string{"birth_date": ErrNotAdult.Error()}}})
	case errors.Is(err, ErrConsentPending):
		shared.AbortWithError(c, http.StatusLocked, "consent_pending", ErrConsentPending.Error()+".")
	case errors.Is(err, ErrNotAvailable):
		shared.AbortWithError(c, http.StatusForbidden, "not_available", ErrNotAvailable.Error()+".")
	default:
		log.ErrorContext(c.Request.Context(), "patients_internal_error", slog.String("request_id", middleware.GetRequestID(c)), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
	}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	nutri := v1.Group("/patients", auth.Authenticate(ct.auth), auth.RequirePermission("patients:manage"), auth.CSRF())
	nutri.GET("", ct.list)
	nutri.POST("", ct.create)

	one := nutri.Group("/:id", ct.loadPatient)
	one.GET("", ct.get)
	one.PATCH("", ct.update)
	one.POST("/deactivate", ct.deactivate)
	one.POST("/restore", ct.restore)
	one.POST("/invite", ct.resend)
	one.POST("/exports", ct.logExport)
	one.GET("/consents", ct.consents)
	one.POST("/consents/record", ct.recordConsent)
	one.POST("/consents/:aid/revoke", ct.revokeConsent)

	// El expediente clínico permanece restringido hasta cumplir las aceptaciones (§4.1).
	clin := one.Group("", ct.requireConsent)
	clin.GET("/measurements", ct.measurements)
	clin.POST("/measurements", ct.addMeasurement)
	clin.GET("/clinical", ct.clinical)
	clin.POST("/conditions", ct.saveCondition)
	clin.PUT("/conditions/:cid", ct.saveCondition)
	clin.DELETE("/conditions/:cid", ct.deleteCondition)
	clin.POST("/allergies", ct.saveAllergy)
	clin.PUT("/allergies/:cid", ct.saveAllergy)
	clin.DELETE("/allergies/:cid", ct.deleteAllergy)
	clin.POST("/medications", ct.saveMedication)
	clin.PUT("/medications/:cid", ct.saveMedication)
	clin.DELETE("/medications/:cid", ct.deleteMedication)
	clin.POST("/preferences", ct.savePreference)
	clin.PUT("/preferences/:cid", ct.savePreference)
	clin.DELETE("/preferences/:cid", ct.deletePreference)
	clin.GET("/labs", ct.labs)
	clin.POST("/labs", ct.addLab)
	clin.DELETE("/labs/:cid", ct.deleteLab)
	clin.GET("/reproductive", ct.reproductive)
	clin.PUT("/reproductive/menarche", ct.setMenarche)
	clin.POST("/reproductive/periods", ct.addPeriod)
	clin.POST("/reproductive/pregnancies", ct.addPregnancy)
	clin.POST("/reproductive/pregnancies/:cid/end", ct.endPregnancy)
	clin.GET("/notes", ct.notes)
	clin.POST("/notes", ct.addNote)
	clin.DELETE("/notes/:cid", ct.deleteNote)

	// Documentos legales vigentes (lo necesitan ambos roles).
	v1.GET("/consent-documents", auth.Authenticate(ct.auth), ct.activeConsents)

	// Rol paciente: el paciente se resuelve SIEMPRE desde la sesión, nunca desde la URL.
	me := v1.Group("/me", auth.Authenticate(ct.auth), auth.RequireRole("patient"), auth.CSRF())
	me.GET("/patient", ct.meGet)
	me.GET("/consents", ct.meConsents)
	me.GET("/consents/pending", ct.mePending)
	me.POST("/consents/accept", ct.meAccept)
	me.GET("/measurements", ct.meMeasurements)
	me.POST("/account/delete", ct.meDeleteAccount)
}

// ---------- Middlewares ----------
func (ct *Controller) loadPatient(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No encontrado.")
		return
	}
	if _, err := ct.svc.Get(c.Request.Context(), id); err != nil {
		fail(c, ct.log, err)
		return
	}
	c.Set(idKey, id)
	c.Next()
}

func pid(c *gin.Context) uuid.UUID { return c.MustGet(idKey).(uuid.UUID) }

func (ct *Controller) requireConsent(c *gin.Context) {
	ok, err := ct.svc.ConsentComplete(c.Request.Context(), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	if !ok {
		fail(c, ct.log, ErrConsentPending)
		return
	}
	c.Next()
}

// ---------- DTO ----------
type patientDTO struct {
	ID                  uuid.UUID  `json:"id"`
	UserID              *uuid.UUID `json:"user_id"`
	Status              string     `json:"status"`
	FirstName           string     `json:"first_name"`
	LastName            string     `json:"last_name"`
	BirthDate           string     `json:"birth_date"`
	Sex                 string     `json:"sex"`
	Email               string     `json:"email"`
	Phone               string     `json:"phone"`
	Goal                string     `json:"goal"`
	GoalNotes           string     `json:"goal_notes"`
	ClinicalIndications string     `json:"clinical_indications"`
	MeasurementsVisible bool       `json:"measurements_visible"`
	QuotaOverrideBytes  *int64     `json:"quota_override_bytes"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	DeletedAt           *time.Time `json:"deleted_at"`
	ConsentComplete     *bool      `json:"consent_complete,omitempty"`
}

func toDTO(p db.Patient, consent *bool) patientDTO {
	d := patientDTO{
		ID: p.ID, Status: p.Status, FirstName: p.FirstName, LastName: p.LastName, BirthDate: p.BirthDate.Time.Format("2006-01-02"),
		Sex: p.Sex, Email: p.Email, Phone: p.Phone, Goal: p.Goal, GoalNotes: p.GoalNotes, ClinicalIndications: p.ClinicalIndications,
		MeasurementsVisible: p.MeasurementsVisible, CreatedAt: p.CreatedAt.Time, UpdatedAt: p.UpdatedAt.Time, ConsentComplete: consent,
	}
	if p.UserID.Valid {
		u := p.UserID.UUID
		d.UserID = &u
	}
	if p.QuotaOverrideBytes.Valid {
		q := p.QuotaOverrideBytes.Int64
		d.QuotaOverrideBytes = &q
	}
	if p.DeletedAt.Valid {
		t := p.DeletedAt.Time
		d.DeletedAt = &t
	}
	return d
}

func (ct *Controller) dto(c *gin.Context, p db.Patient) patientDTO {
	ok, _ := ct.svc.ConsentComplete(c.Request.Context(), p.ID)
	return toDTO(p, &ok)
}

func parseDate(s string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", s)
	return t, err == nil
}

func bad(c *gin.Context, fields ValidationError) { fail(c, nil, fields) }

// ---------- Nutrióloga: pacientes ----------
func (ct *Controller) list(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	size, _ := strconv.Atoi(c.Query("page_size"))
	status := c.Query("status")
	if status == "deleted" {
		status = ""
	}
	res, err := ct.svc.List(c.Request.Context(), ListFilter{
		Search: c.Query("search"), Status: status, Goal: c.Query("goal"), OnlyDeleted: c.Query("status") == "deleted", Page: page, PageSize: size,
	})
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	items := make([]patientDTO, 0, len(res.Items))
	for _, r := range res.Items {
		ok := r.ConsentComplete
		items = append(items, toDTO(db.Patient{
			ID: r.ID, UserID: r.UserID, Status: r.Status, FirstName: r.FirstName, LastName: r.LastName, BirthDate: r.BirthDate, Sex: r.Sex, Email: r.Email,
			Phone: r.Phone, Goal: r.Goal, GoalNotes: r.GoalNotes, ClinicalIndications: r.ClinicalIndications, MeasurementsVisible: r.MeasurementsVisible,
			QuotaOverrideBytes: r.QuotaOverrideBytes, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, DeletedAt: r.DeletedAt,
		}, &ok))
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": res.Total, "page": res.Page, "page_size": res.PageSize})
}

type createReq struct {
	FirstName string `json:"first_name" binding:"required,max=80"`
	LastName  string `json:"last_name" binding:"required,max=80"`
	BirthDate string `json:"birth_date" binding:"required"`
	Sex       string `json:"sex" binding:"required,oneof=F M O"`
	Email     string `json:"email" binding:"required,email,max=254"`
	Phone     string `json:"phone" binding:"max=30"`
	Goal      string `json:"goal" binding:"required,oneof=weight_loss muscle_gain maintenance health other"`
	Invite    bool   `json:"invite"`
	// Salud reproductiva, opcional al registrar (solo F u «Otro»); se puede capturar después en el expediente.
	MenarcheAge     *int   `json:"menarche_age"`
	MenarcheUnknown bool   `json:"menarche_unknown"`
	LastPeriodDate  string `json:"last_period_date"`
	PregnancyWeeks  *int   `json:"pregnancy_weeks"`
}

func (ct *Controller) create(c *gin.Context) {
	var in createReq
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"body": "revisa los campos obligatorios"})
		return
	}
	birth, ok := parseDate(in.BirthDate)
	if !ok {
		bad(c, ValidationError{"birth_date": "usa el formato AAAA-MM-DD"})
		return
	}
	errs := ValidationError{}
	repro := Reproductive{MenarcheAge: in.MenarcheAge, MenarcheUnknown: in.MenarcheUnknown, LastPeriod: optDay("last_period_date", in.LastPeriodDate, errs), PregnancyWeeks: in.PregnancyWeeks}
	if len(errs) > 0 {
		bad(c, errs)
		return
	}
	p, err := ct.svc.Create(c.Request.Context(), actor(c), CreateInput{
		FirstName: in.FirstName, LastName: in.LastName, Email: in.Email, Phone: in.Phone, Sex: in.Sex, Goal: in.Goal, BirthDate: birth, Invite: in.Invite, Repro: repro,
	})
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	resp := gin.H{}
	b, _ := json.Marshal(ct.dto(c, p))
	_ = json.Unmarshal(b, &resp)
	if inv, ok := ct.svc.TakeInvitation(p.ID); ok && !inv.Emailed {
		// Sin correo configurado, la nutrióloga comparte el enlace por otro medio. Queda en auditoría.
		ct.svc.RecordInviteLinkShown(c.Request.Context(), actor(c), p.ID)
		resp["invite_link"] = inv.Link
	}
	c.JSON(http.StatusCreated, resp)
}

func (ct *Controller) get(c *gin.Context) {
	p, err := ct.svc.Get(c.Request.Context(), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, ct.dto(c, p))
}

type updateReq struct {
	FirstName           *string `json:"first_name" binding:"omitempty,min=1,max=80"`
	LastName            *string `json:"last_name" binding:"omitempty,min=1,max=80"`
	BirthDate           *string `json:"birth_date"`
	Sex                 *string `json:"sex" binding:"omitempty,oneof=F M O"`
	Email               *string `json:"email" binding:"omitempty,email,max=254"`
	Phone               *string `json:"phone" binding:"omitempty,max=30"`
	Goal                *string `json:"goal" binding:"omitempty,oneof=weight_loss muscle_gain maintenance health other"`
	GoalNotes           *string `json:"goal_notes" binding:"omitempty,max=2000"`
	ClinicalIndications *string `json:"clinical_indications" binding:"omitempty,max=4000"`
	MeasurementsVisible *bool   `json:"measurements_visible"`
	QuotaOverrideBytes  *int64  `json:"quota_override_bytes" binding:"omitempty,min=0"`
}

func (ct *Controller) update(c *gin.Context) {
	var in updateReq
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	u := UpdateInput{FirstName: in.FirstName, LastName: in.LastName, Sex: in.Sex, Email: in.Email, Phone: in.Phone, Goal: in.Goal,
		GoalNotes: in.GoalNotes, MeasurementsVisible: in.MeasurementsVisible, QuotaOverrideBytes: in.QuotaOverrideBytes}
	// Las indicaciones clínicas son parte del expediente clínico: requieren consentimiento completo.
	if in.ClinicalIndications != nil || in.GoalNotes != nil || in.MeasurementsVisible != nil {
		if ok, err := ct.svc.ConsentComplete(c.Request.Context(), pid(c)); err != nil {
			fail(c, ct.log, err)
			return
		} else if !ok {
			fail(c, ct.log, ErrConsentPending)
			return
		}
		u.ClinicalIndications = in.ClinicalIndications
	}
	if in.BirthDate != nil {
		t, ok := parseDate(*in.BirthDate)
		if !ok {
			bad(c, ValidationError{"birth_date": "usa el formato AAAA-MM-DD"})
			return
		}
		u.BirthDate = &t
	}
	p, err := ct.svc.Update(c.Request.Context(), actor(c), pid(c), u)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, ct.dto(c, p))
}

func (ct *Controller) deactivate(c *gin.Context) { ct.setDeleted(c, true) }
func (ct *Controller) restore(c *gin.Context)    { ct.setDeleted(c, false) }

func (ct *Controller) setDeleted(c *gin.Context, deleted bool) {
	p, err := ct.svc.SetDeleted(c.Request.Context(), actor(c), pid(c), deleted)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, ct.dto(c, p))
}

func (ct *Controller) resend(c *gin.Context) {
	inv, err := ct.svc.Resend(c.Request.Context(), actor(c), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	resp := gin.H{"emailed": inv.Emailed}
	if !inv.Emailed {
		ct.svc.RecordInviteLinkShown(c.Request.Context(), actor(c), pid(c))
		resp["invite_link"] = inv.Link
	}
	c.JSON(http.StatusAccepted, resp)
}

// ---------- Consentimientos ----------
type idsReq struct {
	DocumentIDs []uuid.UUID `json:"document_ids" binding:"required,min=1"`
}

func (ct *Controller) consents(c *gin.Context) {
	acc, err := ct.svc.Acceptances(c.Request.Context(), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	pending, err := ct.svc.PendingConsents(c.Request.Context(), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	out := make([]acceptanceDTO, 0, len(acc))
	for _, a := range acc {
		d := acceptanceDTO{ID: a.ID, DocumentID: a.ConsentDocumentID, AcceptedAt: a.AcceptedAt.Time, Method: a.AcceptanceMethod, Type: a.DocumentType, Version: a.Version, Title: a.Title}
		if a.RevokedAt.Valid {
			t := a.RevokedAt.Time
			d.RevokedAt = &t
		}
		out = append(out, d)
	}
	c.JSON(http.StatusOK, gin.H{"acceptances": out, "pending": nz(pending)})
}

// acceptanceDTO no expone la evidencia (IP, navegador) al cliente: queda solo en el servidor.
type acceptanceDTO struct {
	ID         uuid.UUID  `json:"id"`
	DocumentID uuid.UUID  `json:"document_id"`
	AcceptedAt time.Time  `json:"accepted_at"`
	Method     string     `json:"method"`
	RevokedAt  *time.Time `json:"revoked_at"`
	Type       string     `json:"document_type"`
	Version    int32      `json:"version"`
	Title      string     `json:"title"`
}

func (ct *Controller) activeConsents(c *gin.Context) {
	docs, err := ct.svc.ActiveConsents(c.Request.Context())
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": nz(docs)})
}

// logExport deja constancia de una exportación sensible (§15.2, §17.1). El archivo se genera en el cliente.
func (ct *Controller) logExport(c *gin.Context) {
	var in struct {
		Kind string `json:"kind" binding:"required,oneof=measurements report document"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"kind": "tipo de exportación no válido"})
		return
	}
	ct.svc.LogExport(c.Request.Context(), actor(c), pid(c), in.Kind)
	c.Status(http.StatusNoContent)
}

func (ct *Controller) recordConsent(c *gin.Context) {
	var in idsReq
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"document_ids": "indica al menos un documento"})
		return
	}
	if err := ct.svc.RecordInPerson(c.Request.Context(), actor(c), pid(c), in.DocumentIDs); err != nil {
		fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) revokeConsent(c *gin.Context) {
	aid, err := uuid.Parse(c.Param("aid"))
	if err != nil {
		fail(c, ct.log, ErrNotFound)
		return
	}
	if err := ct.svc.RevokeConsent(c.Request.Context(), actor(c), pid(c), aid); err != nil {
		fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---------- Mediciones ----------
type measurementReq struct {
	MeasuredAt string  `json:"measured_at" binding:"required"`
	WeightKg   string  `json:"weight_kg" binding:"required"`
	HeightCm   string  `json:"height_cm" binding:"required"`
	WaistCm    *string `json:"waist_cm"`
	HipCm      *string `json:"hip_cm"`
	BodyFatPct *string `json:"body_fat_pct"`
	Notes      string  `json:"notes" binding:"max=1000"`

	FatMassKg    *string           `json:"fat_mass_kg"`
	MusclePct    *string           `json:"muscle_pct"`
	MuscleMassKg *string           `json:"muscle_mass_kg"`
	VisceralFat  *string           `json:"visceral_fat"`
	BoneKg       *string           `json:"bone_kg"`
	ObesityPct   *string           `json:"obesity_pct"`
	Girths       map[string]string `json:"girths"`
}

func optDec(field string, s *string, errs ValidationError) *decimal.Decimal {
	if s == nil || *s == "" {
		return nil
	}
	d, err := decimal.NewFromString(*s)
	if err != nil {
		errs[field] = "escribe un número válido (con punto decimal)"
		return nil
	}
	return &d
}

func (ct *Controller) addMeasurement(c *gin.Context) {
	var in measurementReq
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"body": "revisa los campos obligatorios"})
		return
	}
	errs := ValidationError{}
	at, ok := parseDate(in.MeasuredAt)
	if !ok {
		errs["measured_at"] = "usa el formato AAAA-MM-DD"
	}
	w, e1 := decimal.NewFromString(in.WeightKg)
	h, e2 := decimal.NewFromString(in.HeightCm)
	if e1 != nil {
		errs["weight_kg"] = "escribe un número válido (con punto decimal)"
	}
	if e2 != nil {
		errs["height_cm"] = "escribe un número válido (con punto decimal)"
	}
	m := MeasurementInput{MeasuredAt: at, WeightKg: w, HeightCm: h, Notes: in.Notes,
		WaistCm: optDec("waist_cm", in.WaistCm, errs), HipCm: optDec("hip_cm", in.HipCm, errs), BodyFatPct: optDec("body_fat_pct", in.BodyFatPct, errs),
		FatMassKg: optDec("fat_mass_kg", in.FatMassKg, errs), MusclePct: optDec("muscle_pct", in.MusclePct, errs), MuscleMassKg: optDec("muscle_mass_kg", in.MuscleMassKg, errs),
		VisceralFat: optDec("visceral_fat", in.VisceralFat, errs), BoneKg: optDec("bone_kg", in.BoneKg, errs), ObesityPct: optDec("obesity_pct", in.ObesityPct, errs)}
	for k, v := range in.Girths {
		if v = strings.TrimSpace(v); v == "" {
			continue
		}
		d, err := decimal.NewFromString(v)
		if err != nil {
			errs["girths."+k] = "escribe un número válido (con punto decimal)"
			continue
		}
		if m.Girths == nil {
			m.Girths = map[string]decimal.Decimal{}
		}
		m.Girths[k] = d
	}
	if len(errs) > 0 {
		bad(c, errs)
		return
	}
	out, err := ct.svc.AddMeasurement(c.Request.Context(), actor(c), pid(c), m)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (ct *Controller) measurements(c *gin.Context) {
	list, err := ct.svc.Measurements(c.Request.Context(), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": nz(list)})
}

// ---------- Clínico ----------
func (ct *Controller) clinical(c *gin.Context) {
	out, err := ct.svc.Clinical(c.Request.Context(), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func itemID(c *gin.Context) (*uuid.UUID, bool) {
	raw := c.Param("cid")
	if raw == "" {
		return nil, true
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, false
	}
	return &id, true
}

// bindSave lee el cuerpo y el id opcional; responde el error por sí mismo.
func bindSave[T any](c *gin.Context, log *slog.Logger) (T, *uuid.UUID, bool) {
	var in T
	id, ok := itemID(c)
	if !ok {
		fail(c, log, ErrNotFound)
		return in, nil, false
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"body": "revisa los campos enviados"})
		return in, nil, false
	}
	return in, id, true
}

func created(c *gin.Context, id *uuid.UUID, v any) {
	if id == nil {
		c.JSON(http.StatusCreated, v)
		return
	}
	c.JSON(http.StatusOK, v)
}

type conditionReq struct{ Name, Details, Status string }

func (ct *Controller) saveCondition(c *gin.Context) {
	in, id, ok := bindSave[struct {
		Name    string `json:"name"`
		Details string `json:"details"`
		Status  string `json:"status"`
	}](c, ct.log)
	if !ok {
		return
	}
	if in.Status == "" {
		in.Status = "active"
	}
	out, err := ct.svc.SaveCondition(c.Request.Context(), actor(c), pid(c), id, ConditionInput{Name: in.Name, Details: in.Details, Status: in.Status})
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	created(c, id, out)
}

func (ct *Controller) saveAllergy(c *gin.Context) {
	in, id, ok := bindSave[struct {
		Allergen string   `json:"allergen"`
		Aliases  []string `json:"aliases"`
		Reaction string   `json:"reaction"`
		Severity string   `json:"severity"`
		Status   string   `json:"status"`
	}](c, ct.log)
	if !ok {
		return
	}
	if in.Status == "" {
		in.Status = "active"
	}
	if in.Severity == "" {
		in.Severity = "moderate"
	}
	out, err := ct.svc.SaveAllergy(c.Request.Context(), actor(c), pid(c), id, AllergyInput{Allergen: in.Allergen, Aliases: in.Aliases, Reaction: in.Reaction, Severity: in.Severity, Status: in.Status})
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	created(c, id, out)
}

func (ct *Controller) saveMedication(c *gin.Context) {
	in, id, ok := bindSave[struct {
		Name      string  `json:"name"`
		Dose      string  `json:"dose"`
		Frequency string  `json:"frequency"`
		Kind      string  `json:"kind"`
		StartDate *string `json:"start_date"`
		EndDate   *string `json:"end_date"`
		Status    string  `json:"status"`
	}](c, ct.log)
	if !ok {
		return
	}
	if in.Status == "" {
		in.Status = "active"
	}
	m := MedicationInput{Name: in.Name, Dose: in.Dose, Frequency: in.Frequency, Kind: in.Kind, Status: in.Status}
	errs := ValidationError{}
	for f, p := range map[string]struct {
		s   *string
		dst **time.Time
	}{"start_date": {in.StartDate, &m.StartDate}, "end_date": {in.EndDate, &m.EndDate}} {
		if p.s != nil && *p.s != "" {
			t, ok := parseDate(*p.s)
			if !ok {
				errs[f] = "usa el formato AAAA-MM-DD"
				continue
			}
			*p.dst = &t
		}
	}
	if len(errs) > 0 {
		bad(c, errs)
		return
	}
	out, err := ct.svc.SaveMedication(c.Request.Context(), actor(c), pid(c), id, m)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	created(c, id, out)
}

func (ct *Controller) savePreference(c *gin.Context) {
	in, id, ok := bindSave[struct {
		FoodName string `json:"food_name"`
		Type     string `json:"preference_type"`
		Notes    string `json:"notes"`
	}](c, ct.log)
	if !ok {
		return
	}
	out, err := ct.svc.SavePreference(c.Request.Context(), actor(c), pid(c), id, PreferenceInput{FoodName: in.FoodName, Type: in.Type, Notes: in.Notes})
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	created(c, id, out)
}

func (ct *Controller) deleteWith(c *gin.Context, run func(ctx *gin.Context, id uuid.UUID) error) {
	id, ok := itemID(c)
	if !ok || id == nil {
		fail(c, ct.log, ErrNotFound)
		return
	}
	if err := run(c, *id); err != nil {
		fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) deleteCondition(c *gin.Context) {
	ct.deleteWith(c, func(g *gin.Context, id uuid.UUID) error {
		return ct.svc.DeleteCondition(g.Request.Context(), actor(g), pid(g), id)
	})
}
func (ct *Controller) deleteAllergy(c *gin.Context) {
	ct.deleteWith(c, func(g *gin.Context, id uuid.UUID) error {
		return ct.svc.DeleteAllergy(g.Request.Context(), actor(g), pid(g), id)
	})
}
func (ct *Controller) deleteMedication(c *gin.Context) {
	ct.deleteWith(c, func(g *gin.Context, id uuid.UUID) error {
		return ct.svc.DeleteMedication(g.Request.Context(), actor(g), pid(g), id)
	})
}
func (ct *Controller) deletePreference(c *gin.Context) {
	ct.deleteWith(c, func(g *gin.Context, id uuid.UUID) error {
		return ct.svc.DeletePreference(g.Request.Context(), actor(g), pid(g), id)
	})
}

// ---------- Notas privadas ----------
func (ct *Controller) notes(c *gin.Context) {
	list, err := ct.svc.Notes(c.Request.Context(), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": nz(list)})
}

func (ct *Controller) addNote(c *gin.Context) {
	var in struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"body": "escribe una nota"})
		return
	}
	n, err := ct.svc.AddNote(c.Request.Context(), actor(c), pid(c), in.Body)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusCreated, n)
}

func (ct *Controller) deleteNote(c *gin.Context) {
	ct.deleteWith(c, func(g *gin.Context, id uuid.UUID) error {
		return ct.svc.DeleteNote(g.Request.Context(), actor(g), pid(g), id)
	})
}

// ---------- Rol paciente (/me) ----------
func (ct *Controller) mePatient(c *gin.Context) (db.Patient, bool) {
	p, err := ct.svc.ForUser(c.Request.Context(), auth.IdentityFrom(c).UserID)
	if err != nil {
		fail(c, ct.log, err)
		return db.Patient{}, false
	}
	return p, true
}

// meGet devuelve solo lo que corresponde a la paciente: sin indicaciones clínicas, notas, cuota ni autoría.
func (ct *Controller) meGet(c *gin.Context) {
	p, ok := ct.mePatient(c)
	if !ok {
		return
	}
	done, err := ct.svc.ConsentComplete(c.Request.Context(), p.ID)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": p.ID, "first_name": p.FirstName, "last_name": p.LastName, "email": p.Email, "goal": p.Goal, "goal_notes": p.GoalNotes,
		"birth_date": p.BirthDate.Time.Format("2006-01-02"), "sex": p.Sex, "phone": p.Phone,
		"measurements_visible": p.MeasurementsVisible, "consent_complete": done,
	})
}

// meConsents devuelve las aceptaciones de la propia paciente (sin la evidencia técnica).
func (ct *Controller) meConsents(c *gin.Context) {
	p, ok := ct.mePatient(c)
	if !ok {
		return
	}
	acc, err := ct.svc.Acceptances(c.Request.Context(), p.ID)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	out := make([]acceptanceDTO, 0, len(acc))
	for _, a := range acc {
		d := acceptanceDTO{ID: a.ID, DocumentID: a.ConsentDocumentID, AcceptedAt: a.AcceptedAt.Time, Method: a.AcceptanceMethod, Type: a.DocumentType, Version: a.Version, Title: a.Title}
		if a.RevokedAt.Valid {
			t := a.RevokedAt.Time
			d.RevokedAt = &t
		}
		out = append(out, d)
	}
	c.JSON(http.StatusOK, gin.H{"acceptances": out})
}

func (ct *Controller) mePending(c *gin.Context) {
	p, ok := ct.mePatient(c)
	if !ok {
		return
	}
	docs, err := ct.svc.PendingConsents(c.Request.Context(), p.ID)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": nz(docs)})
}

func (ct *Controller) meAccept(c *gin.Context) {
	p, ok := ct.mePatient(c)
	if !ok {
		return
	}
	var in idsReq
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"document_ids": "indica al menos un documento"})
		return
	}
	if err := ct.svc.AcceptSelf(c.Request.Context(), actor(c), p.ID, in.DocumentIDs); err != nil {
		fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) meMeasurements(c *gin.Context) {
	p, ok := ct.mePatient(c)
	if !ok {
		return
	}
	done, err := ct.svc.ConsentComplete(c.Request.Context(), p.ID)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	if !done {
		fail(c, ct.log, ErrConsentPending)
		return
	}
	if !p.MeasurementsVisible {
		fail(c, ct.log, ErrNotAvailable)
		return
	}
	list, err := ct.svc.Measurements(c.Request.Context(), p.ID)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": nz(list)})
}

// meDeleteAccount da de baja la cuenta de la propia paciente (derecho de cancelación, LFPDPPP).
// Pide su contraseña, inhabilita el acceso y desactiva el expediente; los datos clínicos NO se borran
// porque deben conservarse (NOM-004-SSA3-2012). Ella puede solicitar a su nutrióloga ejercer los demás derechos ARCO.
func (ct *Controller) meDeleteAccount(c *gin.Context) {
	var in struct {
		Password string `json:"password" binding:"required,max=200"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		shared.AbortWithError(c, http.StatusUnprocessableEntity, "validation_failed", "Escribe tu contraseña para confirmar.")
		return
	}
	p, ok := ct.mePatient(c)
	if !ok {
		return
	}
	id := auth.IdentityFrom(c)
	m := auth.Meta{IP: c.ClientIP(), UserAgent: c.Request.UserAgent(), RequestID: middleware.GetRequestID(c)}
	if err := ct.auth.CheckPassword(c.Request.Context(), id.UserID, in.Password, m); err != nil {
		if errors.Is(err, auth.ErrRateLimited) {
			shared.AbortWithError(c, http.StatusTooManyRequests, "rate_limited", "Demasiados intentos. Inténtalo más tarde.")
			return
		}
		shared.AbortWithError(c, http.StatusForbidden, "invalid_password", "La contraseña no es correcta.")
		return
	}
	a := actor(c)
	if _, err := ct.svc.SetDeleted(c.Request.Context(), a, p.ID, true); err != nil {
		fail(c, ct.log, err)
		return
	}
	ct.svc.rec(c.Request.Context(), a, "patient.self_delete", p.ID, nil)
	if err := ct.auth.DisableAccount(c.Request.Context(), id.UserID, m); err != nil {
		fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}
