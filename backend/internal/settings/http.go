package settings

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

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
	var ve ValidationError
	if errors.As(err, &ve) {
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{
			Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: middleware.GetRequestID(c), Fields: ve}})
		return
	}
	ct.log.ErrorContext(c.Request.Context(), "settings_internal_error", slog.String("request_id", middleware.GetRequestID(c)), slog.Any("error", err))
	shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	// Sin sesión: solo nombre y colores, para la pantalla de ingreso.
	v1.GET("/public/brand", ct.publicBrand)
	// Con sesión (cualquier rol): marca completa para encabezados y datos de contacto.
	v1.GET("/brand", auth.Authenticate(ct.auth), ct.brand)

	g := v1.Group("/settings", auth.Authenticate(ct.auth), auth.RequirePermission("settings:manage"), auth.CSRF())
	g.GET("", ct.get)
	g.PUT("/brand", ct.putBrand)
	g.PUT("/region", ct.putRegion)
	g.PUT("/storage", ct.putStorage)
	g.PUT("/alerts", ct.putAlerts)
	g.GET("/consent-documents", ct.consentList)
	g.POST("/consent-documents", ct.consentPublish)
}

func (ct *Controller) publicBrand(c *gin.Context) {
	b, err := ct.svc.PublicBrand(c.Request.Context())
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

func (ct *Controller) brand(c *gin.Context) {
	all, err := ct.svc.Get(c.Request.Context())
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, all.Brand)
}

func (ct *Controller) get(c *gin.Context) {
	all, err := ct.svc.Get(c.Request.Context())
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, all)
}

func bind[T any](c *gin.Context, ct *Controller) (T, bool) {
	var in T
	if err := c.ShouldBindJSON(&in); err != nil {
		ct.fail(c, ValidationError{"body": "revisa los campos enviados"})
		return in, false
	}
	return in, true
}

func (ct *Controller) putBrand(c *gin.Context) {
	in, ok := bind[Brand](c, ct)
	if !ok {
		return
	}
	out, err := ct.svc.UpdateBrand(c.Request.Context(), actor(c), in)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (ct *Controller) putRegion(c *gin.Context) {
	in, ok := bind[Region](c, ct)
	if !ok {
		return
	}
	out, err := ct.svc.UpdateRegion(c.Request.Context(), actor(c), in)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (ct *Controller) putStorage(c *gin.Context) {
	in, ok := bind[Storage](c, ct)
	if !ok {
		return
	}
	out, err := ct.svc.UpdateStorage(c.Request.Context(), actor(c), in)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (ct *Controller) putAlerts(c *gin.Context) {
	in, ok := bind[Alerts](c, ct)
	if !ok {
		return
	}
	out, err := ct.svc.UpdateAlerts(c.Request.Context(), actor(c), in)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (ct *Controller) consentList(c *gin.Context) {
	l, err := ct.svc.ConsentVersions(c.Request.Context(), c.Query("type"))
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": l})
}

func (ct *Controller) consentPublish(c *gin.Context) {
	in, ok := bind[struct {
		Type    string `json:"type"`
		Title   string `json:"title"`
		Content string `json:"content"`
	}](c, ct)
	if !ok {
		return
	}
	v, err := ct.svc.PublishConsent(c.Request.Context(), actor(c), in.Type, in.Title, in.Content)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}
