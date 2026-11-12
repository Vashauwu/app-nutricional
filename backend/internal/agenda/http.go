package agenda

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

// PatientOf resuelve el paciente desde la sesión (nunca desde la URL).
type PatientOf func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error)

type Controller struct {
	svc       *Service
	auth      *auth.Service
	patientOf PatientOf
	log       *slog.Logger
}

func NewController(svc *Service, authSvc *auth.Service, patientOf PatientOf, log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: authSvc, patientOf: patientOf, log: log}
}

func actor(c *gin.Context) Actor {
	return Actor{ID: auth.IdentityFrom(c).UserID, RequestID: middleware.GetRequestID(c)}
}

func (ct *Controller) fail(c *gin.Context, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{
			Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: middleware.GetRequestID(c), Fields: ve}})
	case errors.Is(err, ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No encontrado.")
	case errors.Is(err, ErrOverlap):
		shared.AbortWithError(c, http.StatusConflict, "overlap", "Ya hay otra consulta en ese horario.")
	default:
		ct.log.ErrorContext(c.Request.Context(), "agenda_internal_error", slog.String("request_id", middleware.GetRequestID(c)), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
	}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	g := v1.Group("/appointments", auth.Authenticate(ct.auth), auth.RequirePermission("patients:manage"), auth.CSRF())
	g.GET("", ct.list)
	g.POST("", ct.create)
	g.PUT("/:id", ct.update)

	feed := v1.Group("/calendar-feed", auth.Authenticate(ct.auth), auth.RequirePermission("patients:manage"), auth.CSRF())
	feed.GET("", ct.feedInfo)
	feed.POST("/rotate", ct.feedRotate)
	// Sin sesión: lo consulta el servicio de calendario. La protección es el token secreto del enlace (256 bits).
	v1.GET("/calendar/:token/consultas.ics", ct.feedICS)

	me := v1.Group("/me/appointments", auth.Authenticate(ct.auth), auth.RequireRole("patient"), auth.CSRF())
	me.GET("", ct.mine)
}

type req struct {
	PatientID string `json:"patient_id"`
	StartsAt  string `json:"starts_at"`
	EndsAt    string `json:"ends_at"`
	Kind      string `json:"kind"`
	Mode      string `json:"mode"`
	Place     string `json:"place"`
	Notes     string `json:"notes"`
	Status    string `json:"status"`
}

func (r req) input() (Input, ValidationError) {
	errs := ValidationError{}
	in := Input{Kind: r.Kind, Mode: r.Mode, Place: r.Place, Notes: r.Notes, Status: r.Status}
	pid, err := uuid.Parse(r.PatientID)
	if err != nil {
		errs["patient_id"] = "elige un paciente"
	}
	in.PatientID = pid
	if in.StartsAt, err = time.Parse(time.RFC3339, r.StartsAt); err != nil {
		errs["starts_at"] = "usa fecha y hora (ISO 8601)"
	}
	if in.EndsAt, err = time.Parse(time.RFC3339, r.EndsAt); err != nil {
		errs["ends_at"] = "usa fecha y hora (ISO 8601)"
	}
	return in, errs
}

func (ct *Controller) list(c *gin.Context) {
	from, e1 := time.Parse(time.RFC3339, c.Query("from"))
	to, e2 := time.Parse(time.RFC3339, c.Query("to"))
	if e1 != nil || e2 != nil {
		ct.fail(c, ValidationError{"from": "indica el rango con from y to (ISO 8601)"})
		return
	}
	items, err := ct.svc.Range(c.Request.Context(), from, to)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (ct *Controller) create(c *gin.Context) {
	var r req
	if err := c.ShouldBindJSON(&r); err != nil {
		ct.fail(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	in, errs := r.input()
	if len(errs) > 0 {
		ct.fail(c, errs)
		return
	}
	out, err := ct.svc.Create(c.Request.Context(), actor(c), in)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (ct *Controller) update(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		ct.fail(c, ErrNotFound)
		return
	}
	var r req
	if err := c.ShouldBindJSON(&r); err != nil {
		ct.fail(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	in, errs := r.input()
	if len(errs) > 0 {
		ct.fail(c, errs)
		return
	}
	out, err := ct.svc.Update(c.Request.Context(), actor(c), id, in)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (ct *Controller) mine(c *gin.Context) {
	p, err := ct.patientOf(c, auth.IdentityFrom(c).UserID)
	if err != nil {
		shared.AbortWithError(c, http.StatusForbidden, "not_available", "No disponible.")
		return
	}
	items, err := ct.svc.ForPatient(c.Request.Context(), p)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (ct *Controller) feedInfo(c *gin.Context) {
	tok, err := ct.svc.FeedToken(c.Request.Context(), auth.IdentityFrom(c).UserID)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": feedPath(tok)})
}

func (ct *Controller) feedRotate(c *gin.Context) {
	tok, err := ct.svc.RotateFeed(c.Request.Context(), actor(c), true)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": feedPath(tok)})
}

func feedPath(token string) string { return "/api/v1/calendar/" + token + "/consultas.ics" }

func (ct *Controller) feedICS(c *gin.Context) {
	data, err := ct.svc.Feed(context.WithoutCancel(c.Request.Context()), c.Param("token"))
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Robots-Tag", "noindex, nofollow")
	c.Data(http.StatusOK, "text/calendar; charset=utf-8", data)
}
