package reports

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/settings"
	"github.com/nutri/app-nutricional/backend/internal/shared"
	"github.com/nutri/app-nutricional/backend/internal/tracking"
)

type Controller struct {
	svc      *Service
	auth     *auth.Service
	settings *settings.Service
	log      *slog.Logger
}

func NewController(svc *Service, a *auth.Service, st *settings.Service, log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: a, settings: st, log: log}
}

func (ct *Controller) fail(c *gin.Context, err error) {
	rid := middleware.GetRequestID(c)
	var ve ValidationError
	var tv tracking.ValidationError
	var fields map[string]string
	switch {
	case errors.As(err, &ve):
		fields = ve
	case errors.As(err, &tv):
		fields = tv
	}
	switch {
	case fields != nil:
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: rid, Fields: fields}})
	case errors.Is(err, ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No se encontró el recurso.")
	default:
		ct.log.ErrorContext(c.Request.Context(), "reports_internal_error", slog.String("request_id", rid), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
	}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	g := v1.Group("", auth.Authenticate(ct.auth), auth.RequirePermission("reports:read"))
	g.GET("/exports/patients", ct.patients)
	g.GET("/exports/patients/:id/measurements", ct.measurements)
	g.GET("/exports/patients/:id/tracking", ct.tracking)
	g.GET("/reports/patients/:id/summary.pdf", ct.summaryPDF)
}

func actor(c *gin.Context) Actor {
	return Actor{ID: auth.IdentityFrom(c).UserID, RequestID: middleware.GetRequestID(c)}
}

func (ct *Controller) send(c *gin.Context, t Table, resource uuid.UUID, kind string) {
	format := c.DefaultQuery("format", "csv")
	data, mime, err := ct.svc.Export(c.Request.Context(), actor(c), t, format, resource, kind)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-%s.%s"`, kind, time.Now().Format("20060102"), format))
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, mime, data)
}

func patientID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No se encontró el recurso.")
		return uuid.Nil, false
	}
	return id, true
}

func dateQ(c *gin.Context, name string) (*time.Time, error) {
	s := c.Query(name)
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, ValidationError{name: "usa el formato AAAA-MM-DD"}
	}
	return &t, nil
}

func (ct *Controller) patients(c *gin.Context) {
	t, err := ct.svc.PatientsTable(c.Request.Context())
	if err != nil {
		ct.fail(c, err)
		return
	}
	ct.send(c, t, uuid.Nil, "pacientes")
}

func (ct *Controller) measurements(c *gin.Context) {
	id, ok := patientID(c)
	if !ok {
		return
	}
	t, err := ct.svc.MeasurementsTable(c.Request.Context(), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	ct.send(c, t, id, "mediciones")
}

func (ct *Controller) tracking(c *gin.Context) {
	id, ok := patientID(c)
	if !ok {
		return
	}
	from, err := dateQ(c, "from")
	if err != nil {
		ct.fail(c, err)
		return
	}
	to, err := dateQ(c, "to")
	if err != nil {
		ct.fail(c, err)
		return
	}
	t, err := ct.svc.TrackingTable(c.Request.Context(), id, from, to)
	if err != nil {
		ct.fail(c, err)
		return
	}
	ct.send(c, t, id, "seguimiento")
}

func (ct *Controller) summaryPDF(c *gin.Context) {
	id, ok := patientID(c)
	if !ok {
		return
	}
	from, err := dateQ(c, "from")
	if err != nil {
		ct.fail(c, err)
		return
	}
	to, err := dateQ(c, "to")
	if err != nil {
		ct.fail(c, err)
		return
	}
	clinic := "Consulta de nutrición"
	if all, err := ct.settings.Get(c.Request.Context()); err == nil && all.Brand.BusinessName != "" {
		clinic = all.Brand.BusinessName
	}
	data, err := ct.svc.SummaryPDF(c.Request.Context(), actor(c), id, from, to, clinic)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="reporte-%s.pdf"`, time.Now().Format("20060102")))
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/pdf", data)
}
