package mealplans

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

type Controller struct {
	svc      *Service
	auth     *auth.Service
	dishes   DishReader
	resolver func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error)
	log      *slog.Logger
}

func NewController(svc *Service, authSvc *auth.Service, dr DishReader, resolver func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error), log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: authSvc, dishes: dr, resolver: resolver, log: log}
}

func actor(c *gin.Context) Actor {
	return Actor{ID: auth.IdentityFrom(c).UserID, RequestID: middleware.GetRequestID(c)}
}

func (ct *Controller) fail(c *gin.Context, err error) {
	var ve ValidationError
	var ce ConflictError
	var dv dishes.ValidationError
	switch {
	case errors.As(err, &ce):
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{
			"error":   shared.ErrorDetail{Code: "conflict", Message: "El plan fue modificado por otra persona o sesión. Elige cómo continuar.", RequestID: middleware.GetRequestID(c)},
			"current": ce.Current,
		})
	case errors.As(err, &ve):
		ct.validation(c, ve)
	case errors.As(err, &dv):
		ct.validation(c, ValidationError(dv))
	case errors.Is(err, ErrNotFound), errors.Is(err, dishes.ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No encontrado.")
	case errors.Is(err, ErrReadOnly):
		shared.AbortWithError(c, http.StatusConflict, "plan_readonly", ErrReadOnly.Error()+".")
	case errors.Is(err, ErrBadTransition):
		shared.AbortWithError(c, http.StatusConflict, "bad_transition", ErrBadTransition.Error()+".")
	case errors.Is(err, ErrEmptyPlan):
		shared.AbortWithError(c, http.StatusUnprocessableEntity, "empty_plan", ErrEmptyPlan.Error()+": agrega al menos uno antes de publicar.")
	case errors.Is(err, ErrConsentPending):
		shared.AbortWithError(c, http.StatusLocked, "consent_pending", ErrConsentPending.Error()+".")
	default:
		ct.log.ErrorContext(c.Request.Context(), "mealplans_internal_error", slog.String("request_id", middleware.GetRequestID(c)), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
	}
}

func (ct *Controller) validation(c *gin.Context, f ValidationError) {
	c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{
		Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: middleware.GetRequestID(c), Fields: f}})
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	g := v1.Group("", auth.Authenticate(ct.auth), auth.RequirePermission("mealplans:manage"), auth.CSRF())
	g.GET("/plans", ct.list)
	g.POST("/plans", ct.create)
	g.GET("/plans/:id", ct.get)
	g.PUT("/plans/:id", ct.save)
	g.DELETE("/plans/:id", ct.remove)
	for _, action := range []string{"publish", "unpublish", "finalize", "archive", "restore"} {
		g.POST("/plans/:id/"+action, ct.transition(action))
	}
	g.POST("/plans/:id/substitute", ct.substitute)
	g.GET("/plans/:id/history", ct.history)
	g.GET("/plans/:id/revisions/:rev", ct.revision)
	g.POST("/plans/:id/template", ct.saveTemplate)
	g.GET("/plan-templates", ct.templates)
	g.POST("/plan-templates/:id/duplicate", ct.dupTemplate)
	g.DELETE("/plan-templates/:id", ct.delTemplate)

	me := v1.Group("/me", auth.Authenticate(ct.auth), auth.RequireRole("patient"), auth.CSRF())
	me.GET("/plan", ct.mePlan)
	me.GET("/dishes/:id/versions/:version", ct.meDish)
}

func pid(c *gin.Context, key string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(key))
	return id, err == nil
}

func qInt(c *gin.Context, k string) int {
	n, _ := strconv.Atoi(c.Query(k))
	return n
}

func (ct *Controller) list(c *gin.Context) {
	var patient uuid.UUID
	if raw := c.Query("patient_id"); raw != "" {
		p, err := uuid.Parse(raw)
		if err != nil {
			ct.validation(c, ValidationError{"patient_id": "identificador inválido"})
			return
		}
		patient = p
	}
	res, err := ct.svc.List(c.Request.Context(), ListQuery{Search: c.Query("search"), Status: c.Query("status"), PatientID: patient, From: c.Query("from"), To: c.Query("to"), Page: qInt(c, "page"), PageSize: qInt(c, "page_size")})
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

type createReq struct {
	PatientID    uuid.UUID `json:"patient_id"`
	Name         string    `json:"name"`
	StartDate    string    `json:"start_date"`
	EndDate      string    `json:"end_date"`
	Targets      *Targets  `json:"targets"`
	TemplateID   uuid.UUID `json:"template_id"`
	CopyFromPlan uuid.UUID `json:"copy_from_plan_id"`
}

func (ct *Controller) create(c *gin.Context) {
	var in createReq
	if err := c.ShouldBindJSON(&in); err != nil {
		ct.validation(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	v, err := ct.svc.Create(c.Request.Context(), actor(c), CreateInput{PatientID: in.PatientID, Name: in.Name, Start: in.StartDate, End: in.EndDate, Targets: in.Targets, TemplateID: in.TemplateID, CopyFromPlan: in.CopyFromPlan})
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (ct *Controller) get(c *gin.Context) {
	id, ok := pid(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	v, err := ct.svc.Get(c.Request.Context(), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

type saveReq struct {
	ExpectedRevision int32 `json:"expected_revision"`
	Document
}

func (ct *Controller) save(c *gin.Context) {
	id, ok := pid(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<20)
	var in saveReq
	if err := c.ShouldBindJSON(&in); err != nil {
		ct.validation(c, ValidationError{"body": "el plan enviado no tiene un formato válido (los identificadores deben ser UUID y los números, decimales)"})
		return
	}
	if in.ExpectedRevision < 1 {
		ct.validation(c, ValidationError{"expected_revision": "indica la revisión que estás editando"})
		return
	}
	v, err := ct.svc.Save(c.Request.Context(), actor(c), id, in.ExpectedRevision, in.Document)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (ct *Controller) remove(c *gin.Context) {
	id, ok := pid(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	if err := ct.svc.Delete(c.Request.Context(), actor(c), id); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) transition(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := pid(c, "id")
		if !ok {
			ct.fail(c, ErrNotFound)
			return
		}
		var in struct {
			Summary string `json:"summary"`
		}
		_ = c.ShouldBindJSON(&in)
		v, err := ct.svc.Transition(c.Request.Context(), actor(c), id, action, in.Summary)
		if err != nil {
			ct.fail(c, err)
			return
		}
		c.JSON(http.StatusOK, v)
	}
}

func (ct *Controller) substitute(c *gin.Context) {
	id, ok := pid(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	var in struct {
		ItemID      uuid.UUID `json:"item_id"`
		DishID      uuid.UUID `json:"dish_id"`
		DishVersion int32     `json:"dish_version"`
		Reason      string    `json:"reason"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ct.validation(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	v, err := ct.svc.Substitute(c.Request.Context(), actor(c), id, SubstituteInput{ItemID: in.ItemID, DishID: in.DishID, DishVersion: in.DishVersion, Reason: in.Reason})
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (ct *Controller) history(c *gin.Context) {
	id, ok := pid(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	h, err := ct.svc.History(c.Request.Context(), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, h)
}

func (ct *Controller) revision(c *gin.Context) {
	id, ok := pid(c, "id")
	rev, err := strconv.Atoi(c.Param("rev"))
	if !ok || err != nil {
		ct.fail(c, ErrNotFound)
		return
	}
	d, err2 := ct.svc.RevisionView(c.Request.Context(), id, int32(rev))
	if err2 != nil {
		ct.fail(c, err2)
		return
	}
	c.JSON(http.StatusOK, d)
}

func (ct *Controller) saveTemplate(c *gin.Context) {
	id, ok := pid(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Scope       string `json:"scope"`
		From        string `json:"from_date"`
		To          string `json:"to_date"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ct.validation(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	t, err := ct.svc.SaveTemplate(c.Request.Context(), actor(c), id, TemplateInput{Name: in.Name, Description: in.Description, Scope: in.Scope, From: in.From, To: in.To})
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, t)
}

func (ct *Controller) templates(c *gin.Context) {
	var patient uuid.UUID
	if raw := c.Query("patient_id"); raw != "" {
		p, err := uuid.Parse(raw)
		if err != nil {
			ct.validation(c, ValidationError{"patient_id": "identificador inválido"})
			return
		}
		patient = p
	}
	l, err := ct.svc.Templates(c.Request.Context(), patient)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": l})
}

func (ct *Controller) dupTemplate(c *gin.Context) {
	id, ok := pid(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	t, err := ct.svc.DuplicateTemplate(c.Request.Context(), actor(c), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, t)
}

func (ct *Controller) delTemplate(c *gin.Context) {
	id, ok := pid(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	if err := ct.svc.DeleteTemplate(c.Request.Context(), actor(c), id); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---------- Rol paciente: el paciente se resuelve SIEMPRE desde la sesión ----------
func (ct *Controller) mePatientID(c *gin.Context) (uuid.UUID, bool) {
	id, err := ct.resolver(c, auth.IdentityFrom(c).UserID)
	if err != nil {
		switch {
		case errors.Is(err, ErrConsentPending):
			ct.fail(c, err)
		default:
			ct.fail(c, ErrNotFound)
		}
		return uuid.Nil, false
	}
	return id, true
}

func (ct *Controller) mePlan(c *gin.Context) {
	patient, ok := ct.mePatientID(c)
	if !ok {
		return
	}
	p, err := ct.svc.PatientPlan(c.Request.Context(), patient)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (ct *Controller) meDish(c *gin.Context) {
	patient, ok := ct.mePatientID(c)
	if !ok {
		return
	}
	dish, ok1 := pid(c, "id")
	ver, err := strconv.Atoi(c.Param("version"))
	if !ok1 || err != nil {
		ct.fail(c, ErrNotFound)
		return
	}
	d, err := ct.svc.PatientDish(c.Request.Context(), ct.dishes, patient, dish, int32(ver))
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}
