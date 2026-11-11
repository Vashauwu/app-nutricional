// Package patients implementa pacientes, expediente, mediciones y consentimientos (MVP_SPEC §3, §4).
package patients

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/nutrition_engine/calculator"
)

var (
	ErrNotFound       = errors.New("no encontrado")
	ErrEmailTaken     = errors.New("ya existe un paciente con este correo")
	ErrAccountExists  = errors.New("ya existe una cuenta con este correo (de otra persona o del equipo)")
	ErrNotAdult       = errors.New("el MVP atiende solo a personas adultas (18 años o más)")
	ErrConsentPending = errors.New("el expediente clínico está restringido hasta que se acepten el aviso de privacidad y el consentimiento informado")
	ErrNotAvailable   = errors.New("esta información no está disponible")
)

// ValidationError agrupa errores por campo para responder 422 con detalle.
type ValidationError map[string]string

func (v ValidationError) Error() string { return "datos inválidos" }

// Inviter envía la invitación a quien debe crear su contraseña (lo implementa auth.Service).
type Inviter interface {
	Invite(ctx context.Context, userID uuid.UUID) (auth.Invitation, error)
}

type Service struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	inviter Inviter
	// Resultado de la última invitación creada, para mostrarla una vez a la nutrióloga si no hubo correo.
	lastInvite sync.Map
	audit      audit.Recorder
	log        *slog.Logger
	now        func() time.Time
}

func NewService(pool *pgxpool.Pool, inviter Inviter, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{pool: pool, q: q, inviter: inviter, audit: audit.Recorder{Q: q, Log: log}, log: log, now: time.Now}
}

type Actor struct {
	ID        uuid.UUID
	RequestID string
	IP        string
	UA        string
}

func (s *Service) rec(ctx context.Context, a Actor, action string, patient uuid.UUID, meta map[string]any) {
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: action, ResourceType: "patient", ResourceID: patient, RequestID: a.RequestID, Metadata: meta})
}

// ---------- Datos de entrada ----------
type CreateInput struct {
	FirstName, LastName, Email, Phone, Sex, Goal string
	BirthDate                                    time.Time
	Invite                                       bool
}

type UpdateInput struct {
	FirstName, LastName, Email, Phone, Sex, Goal *string
	BirthDate                                    *time.Time
	GoalNotes, ClinicalIndications               *string
	MeasurementsVisible                          *bool
	// QuotaOverrideBytes: puntero a 0 la elimina (vuelve a la cuota base).
	QuotaOverrideBytes *int64
}

func isAdult(birth, now time.Time) bool {
	return !birth.After(now.AddDate(-18, 0, 0))
}

func pgDate(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func (s *Service) Create(ctx context.Context, a Actor, in CreateInput) (db.Patient, error) {
	if !isAdult(in.BirthDate, s.now()) {
		return db.Patient{}, ErrNotAdult
	}
	email := normEmail(in.Email)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Patient{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if taken, err := q.PatientEmailTaken(ctx, db.PatientEmailTakenParams{Email: email, ID: uuid.Nil}); err != nil {
		return db.Patient{}, err
	} else if taken {
		return db.Patient{}, ErrEmailTaken
	}
	userID := uuid.NullUUID{}
	status := "active"
	if in.Invite {
		// Cuenta invitada con contraseña inutilizable hasta que la persona cree la suya.
		junk := make([]byte, 24)
		_, _ = rand.Read(junk)
		hash, err := auth.HashPassword(uuid.NewString() + string(junk))
		if err != nil {
			return db.Patient{}, err
		}
		u, err := q.CreateUser(ctx, db.CreateUserParams{Email: email, PasswordHash: hash, Status: "invited", DisplayName: strings.TrimSpace(in.FirstName + " " + in.LastName)})
		if err != nil {
			if strings.Contains(err.Error(), "users_email_key") {
				return db.Patient{}, ErrEmailTaken
			}
			return db.Patient{}, err
		}
		if err := q.AssignRoleByCode(ctx, db.AssignRoleByCodeParams{UserID: u.ID, Code: "patient"}); err != nil {
			return db.Patient{}, err
		}
		userID = uuid.NullUUID{UUID: u.ID, Valid: true}
		status = "invited"
	}
	p, err := q.CreatePatient(ctx, db.CreatePatientParams{
		UserID: userID, Status: status, FirstName: strings.TrimSpace(in.FirstName), LastName: strings.TrimSpace(in.LastName),
		BirthDate: pgDate(in.BirthDate), Sex: in.Sex, Email: email, Phone: strings.TrimSpace(in.Phone), Goal: in.Goal, CreatedBy: a.ID,
	})
	if err != nil {
		return db.Patient{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Patient{}, err
	}
	s.rec(ctx, a, "patient.create", p.ID, map[string]any{"invite": in.Invite})
	if in.Invite && userID.Valid {
		inv, err := s.inviter.Invite(ctx, userID.UUID)
		if err != nil {
			s.log.ErrorContext(ctx, "invitation_failed", slog.Any("error", err))
		} else {
			s.lastInvite.Store(p.ID, inv)
		}
	}
	return p, nil
}

// TakeInvitation entrega (una sola vez) el resultado de la última invitación creada para el paciente.
func (s *Service) TakeInvitation(id uuid.UUID) (auth.Invitation, bool) {
	v, ok := s.lastInvite.LoadAndDelete(id)
	if !ok {
		return auth.Invitation{}, false
	}
	return v.(auth.Invitation), true
}

// Resend invita al paciente a usar la app y devuelve el resultado:
//   - con invitación pendiente: reenvía el enlace;
//   - registrado a mano (sin cuenta): crea su cuenta, lo deja «invitado» y envía el enlace;
//   - con cuenta ya activa o desactivado: se rechaza.
func (s *Service) Resend(ctx context.Context, a Actor, id uuid.UUID) (auth.Invitation, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return auth.Invitation{}, err
	}
	switch {
	case p.DeletedAt.Valid:
		return auth.Invitation{}, ValidationError{"status": "el paciente está desactivado; restáuralo antes de invitarlo"}
	case p.UserID.Valid && p.Status == "invited":
		s.rec(ctx, a, "patient.invitation_resent", id, nil)
		return s.inviter.Invite(ctx, p.UserID.UUID)
	case p.UserID.Valid:
		return auth.Invitation{}, ValidationError{"status": "este paciente ya activó su cuenta"}
	}
	return s.inviteManual(ctx, a, p)
}

// inviteManual crea la cuenta de un paciente registrado a mano. Los consentimientos NO cambian: si la nutrióloga ya
// los registró en persona, el paciente entra directo a la app; si no, la app se los pide al ingresar.
func (s *Service) inviteManual(ctx context.Context, a Actor, p db.Patient) (auth.Invitation, error) {
	junk := make([]byte, 24)
	_, _ = rand.Read(junk)
	hash, err := auth.HashPassword(uuid.NewString() + string(junk))
	if err != nil {
		return auth.Invitation{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.Invitation{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	u, err := q.CreateUser(ctx, db.CreateUserParams{Email: p.Email, PasswordHash: hash, Status: "invited", DisplayName: strings.TrimSpace(p.FirstName + " " + p.LastName)})
	if err != nil {
		if strings.Contains(err.Error(), "users_email_key") {
			return auth.Invitation{}, ErrAccountExists
		}
		return auth.Invitation{}, err
	}
	if err := q.AssignRoleByCode(ctx, db.AssignRoleByCodeParams{UserID: u.ID, Code: "patient"}); err != nil {
		return auth.Invitation{}, err
	}
	if err := q.LinkPatientUser(ctx, db.LinkPatientUserParams{ID: p.ID, UserID: uuid.NullUUID{UUID: u.ID, Valid: true}}); err != nil {
		return auth.Invitation{}, err
	}
	if err := q.SetPatientInvited(ctx, p.ID); err != nil {
		return auth.Invitation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.Invitation{}, err
	}
	s.rec(ctx, a, "patient.invited", p.ID, nil)
	return s.inviter.Invite(ctx, u.ID)
}

// RecordInviteLinkShown deja constancia de que la nutrióloga vio el enlace (no hubo correo): quien activa la cuenta
// con él podría no ser la paciente, y eso debe poder auditarse.
func (s *Service) RecordInviteLinkShown(ctx context.Context, a Actor, id uuid.UUID) {
	s.rec(ctx, a, "patient.invitation_link_shown", id, nil)
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (db.Patient, error) {
	p, err := s.q.GetPatient(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Patient{}, ErrNotFound
	}
	return p, err
}

// ForUser resuelve el paciente de la cuenta autenticada. Es la ÚNICA vía de acceso del rol paciente:
// nunca se acepta un identificador de paciente enviado por el cliente (aislamiento, §2.2).
func (s *Service) ForUser(ctx context.Context, userID uuid.UUID) (db.Patient, error) {
	p, err := s.q.GetPatientByUserID(ctx, uuid.NullUUID{UUID: userID, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Patient{}, ErrNotFound
	}
	return p, err
}

type ListFilter struct {
	Search, Status, Goal string
	OnlyDeleted          bool
	Page, PageSize       int
}

type ListResult struct {
	Items    []db.ListPatientsRow
	Total    int64
	Page     int
	PageSize int
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(s))
}

func (s *Service) List(ctx context.Context, f ListFilter) (ListResult, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PageSize < 1 || f.PageSize > 100 {
		f.PageSize = 20
	}
	rows, err := s.q.ListPatients(ctx, db.ListPatientsParams{
		OnlyDeleted: f.OnlyDeleted, Status: f.Status, Goal: f.Goal, Search: escapeLike(f.Search),
		PageLimit: int32(f.PageSize), PageOffset: int32((f.Page - 1) * f.PageSize),
	})
	if err != nil {
		return ListResult{}, err
	}
	var total int64
	if len(rows) > 0 {
		total = rows[0].Total
	}
	return ListResult{Items: rows, Total: total, Page: f.Page, PageSize: f.PageSize}, nil
}

func (s *Service) Update(ctx context.Context, a Actor, id uuid.UUID, in UpdateInput) (db.Patient, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return db.Patient{}, err
	}
	changed := []string{}
	set := func(field string, dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
			changed = append(changed, field)
		}
	}
	set("first_name", &p.FirstName, in.FirstName)
	set("last_name", &p.LastName, in.LastName)
	set("phone", &p.Phone, in.Phone)
	set("sex", &p.Sex, in.Sex)
	set("goal", &p.Goal, in.Goal)
	set("goal_notes", &p.GoalNotes, in.GoalNotes)
	set("clinical_indications", &p.ClinicalIndications, in.ClinicalIndications)
	if in.Email != nil {
		e := normEmail(*in.Email)
		if e != p.Email {
			taken, err := s.q.PatientEmailTaken(ctx, db.PatientEmailTakenParams{Email: e, ID: id})
			if err != nil {
				return db.Patient{}, err
			}
			if taken {
				return db.Patient{}, ErrEmailTaken
			}
			p.Email = e
			changed = append(changed, "email")
		}
	}
	if in.BirthDate != nil {
		if !isAdult(*in.BirthDate, s.now()) {
			return db.Patient{}, ErrNotAdult
		}
		p.BirthDate = pgDate(*in.BirthDate)
		changed = append(changed, "birth_date")
	}
	if in.MeasurementsVisible != nil {
		p.MeasurementsVisible = *in.MeasurementsVisible
		changed = append(changed, "measurements_visible")
	}
	if in.QuotaOverrideBytes != nil {
		if *in.QuotaOverrideBytes == 0 {
			p.QuotaOverrideBytes = pgtype.Int8{}
		} else {
			p.QuotaOverrideBytes = pgtype.Int8{Int64: *in.QuotaOverrideBytes, Valid: true}
		}
		changed = append(changed, "quota_override_bytes")
	}
	out, err := s.q.UpdatePatient(ctx, db.UpdatePatientParams{
		ID: id, FirstName: p.FirstName, LastName: p.LastName, BirthDate: p.BirthDate, Sex: p.Sex, Email: p.Email, Phone: p.Phone,
		Goal: p.Goal, GoalNotes: p.GoalNotes, ClinicalIndications: p.ClinicalIndications, MeasurementsVisible: p.MeasurementsVisible,
		QuotaOverrideBytes: p.QuotaOverrideBytes,
	})
	if err != nil {
		return db.Patient{}, err
	}
	// Solo se registran los NOMBRES de los campos cambiados, no su contenido clínico.
	s.rec(ctx, a, "patient.update", id, map[string]any{"fields": changed})
	return out, nil
}

// SetDeleted desactiva (eliminación lógica) o restaura; el historial se conserva (§17.2).
func (s *Service) SetDeleted(ctx context.Context, a Actor, id uuid.UUID, deleted bool) (db.Patient, error) {
	if _, err := s.Get(ctx, id); err != nil {
		return db.Patient{}, err
	}
	if !deleted {
		// Restaurar no puede chocar con otro paciente activo que ya use el correo.
		p, _ := s.Get(ctx, id)
		if taken, err := s.q.PatientEmailTaken(ctx, db.PatientEmailTakenParams{Email: p.Email, ID: id}); err == nil && taken {
			return db.Patient{}, ErrEmailTaken
		}
	}
	p, err := s.q.SetPatientDeleted(ctx, db.SetPatientDeletedParams{ID: id, Deleted: deleted})
	if err != nil {
		return db.Patient{}, err
	}
	action := "patient.restore"
	if deleted {
		action = "patient.deactivate"
	}
	s.rec(ctx, a, action, id, nil)
	return p, nil
}

// ---------- Consentimientos (§4.1) ----------
func (s *Service) ConsentComplete(ctx context.Context, id uuid.UUID) (bool, error) {
	pending, err := s.q.ListPendingConsentDocuments(ctx, id)
	return len(pending) == 0, err
}

func (s *Service) PendingConsents(ctx context.Context, id uuid.UUID) ([]db.ConsentDocument, error) {
	return s.q.ListPendingConsentDocuments(ctx, id)
}

func (s *Service) Acceptances(ctx context.Context, id uuid.UUID) ([]db.ListAcceptancesRow, error) {
	return s.q.ListAcceptances(ctx, id)
}

// accept registra aceptaciones. Solo se admiten documentos vigentes y pendientes de ese paciente.
func (s *Service) accept(ctx context.Context, a Actor, patient uuid.UUID, docIDs []uuid.UUID, method string, evidence []byte) error {
	pending, err := s.q.ListPendingConsentDocuments(ctx, patient)
	if err != nil {
		return err
	}
	allowed := map[uuid.UUID]bool{}
	for _, d := range pending {
		allowed[d.ID] = true
	}
	if len(docIDs) == 0 {
		return ValidationError{"document_ids": "indica al menos un documento"}
	}
	for _, id := range docIDs {
		if !allowed[id] {
			return ValidationError{"document_ids": "alguno de los documentos no está vigente o ya fue aceptado"}
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	for _, id := range docIDs {
		if _, err := q.InsertAcceptance(ctx, db.InsertAcceptanceParams{PatientID: patient, ConsentDocumentID: id, AcceptanceMethod: method, EvidenceMetadata: evidence}); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.rec(ctx, a, "consent.accepted", patient, map[string]any{"method": method, "documents": len(docIDs)})
	return nil
}

// AcceptSelf la paciente acepta desde su cuenta: queda IP y navegador como evidencia.
func (s *Service) AcceptSelf(ctx context.Context, a Actor, patient uuid.UUID, docIDs []uuid.UUID) error {
	return s.accept(ctx, a, patient, docIDs, "web_checkbox", evidenceJSON(map[string]string{"ip": a.IP, "user_agent": a.UA}))
}

// RecordInPerson la nutrióloga registra una aceptación presencial.
func (s *Service) RecordInPerson(ctx context.Context, a Actor, patient uuid.UUID, docIDs []uuid.UUID) error {
	if _, err := s.Get(ctx, patient); err != nil {
		return err
	}
	return s.accept(ctx, a, patient, docIDs, "in_person", evidenceJSON(map[string]string{"recorded_by": a.ID.String()}))
}

func (s *Service) RevokeConsent(ctx context.Context, a Actor, patient, acceptance uuid.UUID) error {
	n, err := s.q.RevokeAcceptance(ctx, db.RevokeAcceptanceParams{ID: acceptance, PatientID: patient})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.rec(ctx, a, "consent.revoked", patient, nil)
	return nil
}

// ---------- Mediciones (§3.2) ----------
type MeasurementInput struct {
	MeasuredAt                 time.Time
	WeightKg, HeightCm         decimal.Decimal
	WaistCm, HipCm, BodyFatPct *decimal.Decimal
	Notes                      string
	// Composición corporal (de una báscula de bioimpedancia) y perímetros. Todo opcional.
	FatMassKg, MusclePct, MuscleMassKg, VisceralFat, BoneKg, ObesityPct *decimal.Decimal
	Girths                                                              map[string]decimal.Decimal
}

// GirthKeys son los perímetros (cm) que se aceptan además de cintura y cadera. L = izquierdo, R = derecho.
var GirthKeys = []string{
	"shoulders", "chest", "abdomen",
	"bicep_relaxed_l", "bicep_relaxed_r", "bicep_flexed_l", "bicep_flexed_r",
	"forearm_relaxed_l", "forearm_relaxed_r", "forearm_flexed_l", "forearm_flexed_r",
	"wrist_l", "wrist_r",
	"thigh_relaxed_l", "thigh_relaxed_r", "thigh_flexed_l", "thigh_flexed_r",
	"calf_relaxed_l", "calf_relaxed_r", "calf_flexed_l", "calf_flexed_r",
}

var (
	minW, maxW = decimal.NewFromInt(20), decimal.NewFromInt(400)
	minH, maxH = decimal.NewFromInt(100), decimal.NewFromInt(250)
)

// BMI = peso / talla² con la política decimal del motor (división a 16 decimales, Round Half Even) y 2 decimales almacenados.
func BMI(weightKg, heightCm decimal.Decimal) (decimal.Decimal, error) {
	m, err := calculator.Div(heightCm, decimal.NewFromInt(100))
	if err != nil {
		return decimal.Zero, err
	}
	b, err := calculator.Div(weightKg, m.Mul(m))
	if err != nil {
		return decimal.Zero, err
	}
	return b.RoundBank(2), nil
}

func (s *Service) AddMeasurement(ctx context.Context, a Actor, patient uuid.UUID, in MeasurementInput) (db.PatientMeasurement, error) {
	errs := ValidationError{}
	if in.WeightKg.LessThan(minW) || in.WeightKg.GreaterThan(maxW) {
		errs["weight_kg"] = "el peso debe estar entre 20 y 400 kg"
	}
	if in.HeightCm.LessThan(minH) || in.HeightCm.GreaterThan(maxH) {
		errs["height_cm"] = "la talla debe estar entre 100 y 250 cm"
	}
	if in.MeasuredAt.After(s.now().Add(24 * time.Hour)) {
		errs["measured_at"] = "la fecha no puede ser futura"
	}
	if in.BodyFatPct != nil && (in.BodyFatPct.IsNegative() || in.BodyFatPct.GreaterThan(decimal.NewFromInt(100))) {
		errs["body_fat_pct"] = "el porcentaje debe estar entre 0 y 100"
	}
	for k, v := range map[string]*decimal.Decimal{"waist_cm": in.WaistCm, "hip_cm": in.HipCm, "fat_mass_kg": in.FatMassKg, "muscle_mass_kg": in.MuscleMassKg, "bone_kg": in.BoneKg} {
		if v != nil && !v.IsPositive() {
			errs[k] = "debe ser mayor a cero"
		}
	}
	if in.MusclePct != nil && (in.MusclePct.IsNegative() || in.MusclePct.GreaterThan(decimal.NewFromInt(100))) {
		errs["muscle_pct"] = "el porcentaje debe estar entre 0 y 100"
	}
	for k, v := range map[string]*decimal.Decimal{"visceral_fat": in.VisceralFat, "obesity_pct": in.ObesityPct} {
		if v != nil && v.IsNegative() {
			errs[k] = "no puede ser negativo"
		}
	}
	valid := map[string]bool{}
	for _, k := range GirthKeys {
		valid[k] = true
	}
	for k, v := range in.Girths {
		if !valid[k] {
			errs["girths"] = "perímetro desconocido: " + k
		} else if !v.IsPositive() || v.GreaterThan(decimal.NewFromInt(300)) {
			errs["girths."+k] = "debe estar entre 0 y 300 cm"
		}
	}
	if len(errs) > 0 {
		return db.PatientMeasurement{}, errs
	}
	bmi, err := BMI(in.WeightKg, in.HeightCm)
	if err != nil {
		return db.PatientMeasurement{}, err
	}
	girths := map[string]string{}
	for k, v := range in.Girths {
		girths[k] = v.String()
	}
	girthsJSON, err := json.Marshal(girths)
	if err != nil {
		return db.PatientMeasurement{}, err
	}
	m, err := s.q.InsertMeasurement(ctx, db.InsertMeasurementParams{
		PatientID: patient, MeasuredAt: pgDate(in.MeasuredAt), WeightKg: in.WeightKg, HeightCm: in.HeightCm, Bmi: bmi,
		WaistCm: nd(in.WaistCm), HipCm: nd(in.HipCm), BodyFatPct: nd(in.BodyFatPct), Notes: in.Notes, CreatedBy: a.ID,
		FatMassKg: nd(in.FatMassKg), MusclePct: nd(in.MusclePct), MuscleMassKg: nd(in.MuscleMassKg), VisceralFat: nd(in.VisceralFat),
		BoneKg: nd(in.BoneKg), ObesityPct: nd(in.ObesityPct), Girths: girthsJSON,
	})
	if err != nil {
		return db.PatientMeasurement{}, err
	}
	s.rec(ctx, a, "measurement.create", patient, map[string]any{"measurement_id": m.ID})
	return m, nil
}

func nd(d *decimal.Decimal) decimal.NullDecimal {
	if d == nil {
		return decimal.NullDecimal{}
	}
	return decimal.NullDecimal{Decimal: *d, Valid: true}
}

func (s *Service) Measurements(ctx context.Context, patient uuid.UUID) ([]db.PatientMeasurement, error) {
	return s.q.ListMeasurements(ctx, patient)
}

// ---------- Notas privadas (§2.2) ----------
func (s *Service) Notes(ctx context.Context, patient uuid.UUID) ([]db.PatientNote, error) {
	return s.q.ListNotes(ctx, patient)
}

func (s *Service) AddNote(ctx context.Context, a Actor, patient uuid.UUID, body string) (db.PatientNote, error) {
	body = strings.TrimSpace(body)
	if body == "" || len(body) > 4000 {
		return db.PatientNote{}, ValidationError{"body": "escribe una nota de hasta 4000 caracteres"}
	}
	n, err := s.q.InsertNote(ctx, db.InsertNoteParams{PatientID: patient, AuthorUserID: a.ID, Body: body})
	if err == nil {
		s.rec(ctx, a, "note.create", patient, map[string]any{"note_id": n.ID})
	}
	return n, err
}

func (s *Service) DeleteNote(ctx context.Context, a Actor, patient, note uuid.UUID) error {
	n, err := s.q.SoftDeleteNote(ctx, db.SoftDeleteNoteParams{ID: note, PatientID: patient})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.rec(ctx, a, "note.delete", patient, map[string]any{"note_id": note})
	return nil
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (s *Service) ActiveConsents(ctx context.Context) ([]db.ConsentDocument, error) {
	return s.q.ListActiveConsentDocuments(ctx)
}

func (s *Service) LogExport(ctx context.Context, a Actor, patient uuid.UUID, kind string) {
	s.rec(ctx, a, "export."+kind, patient, nil)
}
