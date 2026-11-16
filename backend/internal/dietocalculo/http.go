package dietocalculo

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

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

func actor(c *gin.Context) Actor {
	return Actor{ID: auth.IdentityFrom(c).UserID, RequestID: middleware.GetRequestID(c)}
}

func (ct *Controller) fail(c *gin.Context, err error) {
	var fe FieldErrors
	switch {
	case errors.As(err, &fe):
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{
			Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: middleware.GetRequestID(c), Fields: map[string]string(fe)}})
	case errors.Is(err, ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No encontrado.")
	default:
		ct.log.ErrorContext(c.Request.Context(), "dietocalculo_internal_error", slog.String("request_id", middleware.GetRequestID(c)), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
	}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	g := v1.Group("/diet-calculations", auth.Authenticate(ct.auth), auth.RequirePermission("patients:manage"), auth.CSRF())
	g.POST("/compute", ct.compute)
	g.GET("", ct.list)
	g.POST("", ct.create)
	g.GET("/:id", ct.get)
	g.PUT("/:id", ct.update)
	g.DELETE("/:id", ct.remove)
}

type saveReq struct {
	Name      string `json:"name"`
	PatientID string `json:"patient_id"`
	Inputs    Inputs `json:"inputs"`
}

func (r saveReq) input() (SaveInput, error) {
	in := SaveInput{Name: r.Name, Inputs: r.Inputs}
	if r.PatientID != "" {
		id, err := uuid.Parse(r.PatientID)
		if err != nil {
			return in, FieldErrors{"patient_id": "elige un paciente válido"}
		}
		in.PatientID = &id
	}
	return in, nil
}

// compute no guarda nada: devuelve el resultado canónico del motor para las entradas dadas.
func (ct *Controller) compute(c *gin.Context) {
	var in Inputs
	if err := c.ShouldBindJSON(&in); err != nil {
		ct.fail(c, FieldErrors{"body": "revisa los campos enviados"})
		return
	}
	if e := in.Normalize(); e != nil {
		ct.fail(c, e)
		return
	}
	c.JSON(http.StatusOK, Compute(in))
}

func (ct *Controller) list(c *gin.Context) {
	f := ListFilter{Q: c.Query("q"), OnlyUnlinked: c.Query("unlinked") == "true"}
	if p := c.Query("patient_id"); p != "" {
		id, err := uuid.Parse(p)
		if err != nil {
			ct.fail(c, FieldErrors{"patient_id": "paciente no válido"})
			return
		}
		f.PatientID = &id
	}
	items, err := ct.svc.List(c.Request.Context(), f)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (ct *Controller) create(c *gin.Context) {
	var r saveReq
	if err := c.ShouldBindJSON(&r); err != nil {
		ct.fail(c, FieldErrors{"body": "revisa los campos enviados"})
		return
	}
	in, err := r.input()
	if err != nil {
		ct.fail(c, err)
		return
	}
	out, err := ct.svc.Create(c.Request.Context(), actor(c), in)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (ct *Controller) get(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		ct.fail(c, ErrNotFound)
		return
	}
	out, err := ct.svc.Get(c.Request.Context(), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (ct *Controller) update(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		ct.fail(c, ErrNotFound)
		return
	}
	var r saveReq
	if err := c.ShouldBindJSON(&r); err != nil {
		ct.fail(c, FieldErrors{"body": "revisa los campos enviados"})
		return
	}
	in, err := r.input()
	if err != nil {
		ct.fail(c, err)
		return
	}
	out, err := ct.svc.Update(c.Request.Context(), actor(c), id, in)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (ct *Controller) remove(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		ct.fail(c, ErrNotFound)
		return
	}
	if err := ct.svc.Delete(c.Request.Context(), actor(c), id); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
