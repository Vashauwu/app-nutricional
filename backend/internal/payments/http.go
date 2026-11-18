package payments

import (
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/nutri/app-nutricional/backend/internal/auth"
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
	g := v1.Group("/billing", auth.Authenticate(ct.auth), auth.RequirePermission("settings:manage"))
	g.GET("/payments", ct.info)
	w := g.Group("", auth.CSRF())
	w.POST("/checkout", ct.checkout)
	w.POST("/change-plan", ct.changePlan)
	w.POST("/cancel", ct.cancel)
	w.POST("/card", ct.card)
	// El proveedor avisa sin sesión: la firma del evento es lo que lo autentica.
	v1.POST("/webhooks/billing", ct.webhook)
}

func (ct *Controller) actor(c *gin.Context) Actor {
	id := auth.IdentityFrom(c)
	return Actor{ID: id.UserID, Email: id.Email, Name: id.Name}
}

func (ct *Controller) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrCardDeclined):
		shared.AbortWithError(c, http.StatusPaymentRequired, "card_declined", "Tu tarjeta fue rechazada. Revisa los datos o prueba con otra tarjeta.")
	case errors.Is(err, ErrInvalid):
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", err.Error()+".")
	case errors.Is(err, ErrAlreadySubscribed), errors.Is(err, ErrNoSubscription), errors.Is(err, ErrComped):
		shared.AbortWithError(c, http.StatusConflict, "billing_conflict", capitalize(err.Error())+".")
	default:
		ct.log.ErrorContext(c.Request.Context(), "billing_error", slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo completar la operación de cobro. Inténtalo de nuevo.")
	}
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return string(s[0]-32) + s[1:]
}

func (ct *Controller) info(c *gin.Context) {
	i, err := ct.svc.Info(c.Request.Context())
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, i)
}

type checkoutReq struct {
	Plan      string `json:"plan"`
	Period    string `json:"period"`
	CardToken string `json:"card_token"`
}

func (ct *Controller) checkout(c *gin.Context) {
	var in checkoutReq
	if c.ShouldBindJSON(&in) != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Completa los datos del plan y la tarjeta.")
		return
	}
	if err := ct.svc.Checkout(c.Request.Context(), ct.actor(c), CheckoutInput{Plan: in.Plan, Period: in.Period, CardToken: in.CardToken}); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) changePlan(c *gin.Context) {
	var in checkoutReq
	if c.ShouldBindJSON(&in) != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Elige un plan.")
		return
	}
	if err := ct.svc.ChangePlan(c.Request.Context(), ct.actor(c), in.Plan, in.Period); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) cancel(c *gin.Context) {
	if err := ct.svc.Cancel(c.Request.Context(), ct.actor(c)); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) card(c *gin.Context) {
	var in struct {
		CardToken string `json:"card_token"`
	}
	if c.ShouldBindJSON(&in) != nil || in.CardToken == "" {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Falta la tarjeta.")
		return
	}
	if err := ct.svc.UpdateCard(c.Request.Context(), ct.actor(c), in.CardToken); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) webhook(c *gin.Context) {
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20))
	if err != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Cuerpo inválido.")
		return
	}
	ev, err := ct.svc.prov.ParseEvent(c.Request.Header, body)
	if errors.Is(err, ErrBadSignature) {
		shared.AbortWithError(c, http.StatusUnauthorized, "bad_signature", "Firma inválida.")
		return
	}
	if err != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Evento inválido.")
		return
	}
	switch err := ct.svc.HandleEvent(c.Request.Context(), ev); {
	case errors.Is(err, ErrUnknownEvent):
		// 200: el proveedor no debe reintentar un evento de una suscripción que no conocemos.
		c.JSON(http.StatusOK, gin.H{"ignored": true})
	case err != nil:
		ct.log.ErrorContext(c.Request.Context(), "billing_webhook_failed", slog.String("event", ev.ID), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo procesar el evento.") // el proveedor reintenta
	default:
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}
