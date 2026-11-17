package plans

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/nutri/app-nutricional/backend/internal/audit"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

type Controller struct {
	svc   *Service
	auth  *auth.Service
	audit audit.Recorder
	log   *slog.Logger
}

func NewController(svc *Service, authSvc *auth.Service, log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: authSvc, audit: audit.Recorder{Q: svc.q, Log: log}, log: log}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	g := v1.Group("/billing", auth.Authenticate(ct.auth), auth.RequirePermission("settings:manage"))
	g.GET("", ct.get)
	g.POST("/interest", auth.CSRF(), ct.interest)
}

func (ct *Controller) get(c *gin.Context) {
	s, err := ct.svc.Summary(c.Request.Context())
	if err != nil {
		ct.log.ErrorContext(c.Request.Context(), "billing_failed", slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo cargar la facturación.")
		return
	}
	c.JSON(http.StatusOK, s)
}

type interestReq struct {
	Plan   string `json:"plan" binding:"required"`
	Period string `json:"period"`
}

// interest registra que la persona quiere un plan de pago (el cobro aún no está disponible).
func (ct *Controller) interest(c *gin.Context) {
	var in interestReq
	if err := c.ShouldBindJSON(&in); err != nil || (in.Period != "" && in.Period != "monthly" && in.Period != "annual") {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Elige un plan.")
		return
	}
	p, err := ByCode(in.Plan)
	if err != nil || p.Code == "free" {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Elige un plan de pago.")
		return
	}
	id := auth.IdentityFrom(c)
	ct.audit.Record(c.Request.Context(), audit.Event{Actor: id.UserID, Action: "billing.plan_interest", ResourceType: "subscription", RequestID: middleware.GetRequestID(c),
		Metadata: map[string]any{"plan": p.Code, "period": in.Period}})
	c.JSON(http.StatusAccepted, gin.H{"ok": true})
}

// StatusOf traduce un LimitError a la respuesta HTTP uniforme. Devuelve false si el error es otro.
func StatusOf(c *gin.Context, err error) bool {
	var le *LimitError
	if !errors.As(err, &le) {
		return false
	}
	shared.AbortWithError(c, http.StatusPaymentRequired, "plan_limit_"+le.Code, le.Message)
	return true
}
