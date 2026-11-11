package alerts

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

func NewController(svc *Service, a *auth.Service, log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: a, log: log}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	g := v1.Group("", auth.Authenticate(ct.auth), auth.RequirePermission("mealplans:manage"))
	g.GET("/plans/:id/alerts", ct.forPlan)
	g.GET("/alerts", ct.published)
}

func (ct *Controller) fail(c *gin.Context, err error) {
	if errors.Is(err, ErrNotFound) {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No se encontró el recurso.")
		return
	}
	ct.log.ErrorContext(c.Request.Context(), "alerts_internal_error", slog.String("request_id", middleware.GetRequestID(c)), slog.Any("error", err))
	shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
}

func (ct *Controller) forPlan(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		ct.fail(c, ErrNotFound)
		return
	}
	list, err := ct.svc.ForPlan(c.Request.Context(), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": list})
}

func (ct *Controller) published(c *gin.Context) {
	s, err := ct.svc.Published(c.Request.Context())
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}
