package platform

import (
	"embed"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/payments"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

//go:embed console/*
var consoleFS embed.FS

type Controller struct {
	svc  *Service
	auth *auth.Service
	log  *slog.Logger
}

func NewController(svc *Service, a *auth.Service, log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: a, log: log}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	g := v1.Group("/platform", auth.Authenticate(ct.auth), auth.RequirePermission("platform:accounts"))
	// La consola se sirve desde el binario de la API (no dentro del paquete de la aplicación pública) y con la misma
	// protección que la API: sin sesión de plataforma no se entrega ni el HTML.
	g.GET("/console", ct.asset("console/index.html", "text/html; charset=utf-8"))
	g.GET("/console.js", ct.asset("console/console.js", "text/javascript; charset=utf-8"))
	g.GET("/console.css", ct.asset("console/console.css", "text/css; charset=utf-8"))
	g.GET("/overview", ct.overview)
	g.GET("/accounts", ct.list)
	g.GET("/accounts/:id", ct.account)
	g.GET("/actions", ct.actions)
	g.GET("/activity", ct.activity)
	w := g.Group("", auth.CSRF())
	w.POST("/accounts/:id/suspend", ct.suspend)
	w.POST("/accounts/:id/reactivate", ct.reactivate)
	w.POST("/accounts/:id/actions", ct.request)
	w.POST("/actions/:id/decision", ct.decide)
}

func (ct *Controller) asset(path, ctype string) gin.HandlerFunc {
	return func(c *gin.Context) {
		b, err := consoleFS.ReadFile(path)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		c.Header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(http.StatusOK, ctype, b)
	}
}

func (ct *Controller) actor(c *gin.Context) Actor {
	id := auth.IdentityFrom(c)
	return Actor{ID: id.UserID, Email: id.Email}
}

func (ct *Controller) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No existe.")
	case errors.Is(err, ErrInvalid):
		shared.AbortWithError(c, http.StatusUnprocessableEntity, "invalid_request", capitalize(err.Error())+".")
	case errors.Is(err, ErrSelfApproval):
		shared.AbortWithError(c, http.StatusForbidden, "self_approval", capitalize(ErrSelfApproval.Error())+".")
	case errors.Is(err, ErrAlreadyDecided):
		shared.AbortWithError(c, http.StatusConflict, "already_decided", capitalize(ErrAlreadyDecided.Error())+".")
	default:
		ct.log.ErrorContext(c.Request.Context(), "platform_error", slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo completar la operación.")
	}
}

func capitalize(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	if r[0] >= 'a' && r[0] <= 'z' {
		r[0] -= 32
	}
	return string(r)
}

func uid(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No existe.")
		return uuid.Nil, false
	}
	return id, true
}

func (ct *Controller) overview(c *gin.Context) {
	o, err := ct.svc.Overview(c.Request.Context())
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, o)
}

func (ct *Controller) list(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	p, err := ct.svc.ListAccounts(c.Request.Context(), ListQuery{Search: c.Query("q"), Plan: c.Query("plan"), Status: c.Query("status"), Sort: c.Query("sort"), Desc: c.Query("dir") == "desc", Limit: limit, Offset: offset})
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (ct *Controller) account(c *gin.Context) {
	id, ok := uid(c)
	if !ok {
		return
	}
	d, err := ct.svc.Account(c.Request.Context(), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

func (ct *Controller) actions(c *gin.Context) {
	a, err := ct.svc.Actions(c.Request.Context(), c.Query("status"), uuid.Nil)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": a})
}

// activity: bitácora global. Fechas en formato AAAA-MM-DD (hora de la Ciudad de México); «hasta» incluye el día indicado.
func (ct *Controller) activity(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	q := ActivityQuery{Search: c.Query("q"), Category: c.Query("category"), Limit: limit, Offset: offset}
	if v := c.Query("practice"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			shared.AbortWithError(c, http.StatusUnprocessableEntity, "invalid_request", "La consulta indicada no es válida.")
			return
		}
		q.Practice = id
	}
	loc, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		loc = time.UTC
	}
	if v := c.Query("from"); v != "" {
		t, err := time.ParseInLocation("2006-01-02", v, loc)
		if err != nil {
			shared.AbortWithError(c, http.StatusUnprocessableEntity, "invalid_request", "La fecha «desde» no es válida.")
			return
		}
		q.Since = t
	}
	if v := c.Query("to"); v != "" {
		t, err := time.ParseInLocation("2006-01-02", v, loc)
		if err != nil {
			shared.AbortWithError(c, http.StatusUnprocessableEntity, "invalid_request", "La fecha «hasta» no es válida.")
			return
		}
		q.Until = t.AddDate(0, 0, 1)
	}
	p, err := ct.svc.Activity(c.Request.Context(), q)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, p)
}

type reasonReq struct {
	Reason string `json:"reason"`
}

func (ct *Controller) suspend(c *gin.Context) {
	id, ok := uid(c)
	if !ok {
		return
	}
	var in reasonReq
	_ = c.ShouldBindJSON(&in)
	if err := ct.svc.Suspend(c.Request.Context(), ct.actor(c), id, in.Reason); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) reactivate(c *gin.Context) {
	id, ok := uid(c)
	if !ok {
		return
	}
	if err := ct.svc.Reactivate(c.Request.Context(), ct.actor(c), id); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type actionReq struct {
	Kind   string `json:"kind"`
	Params Params `json:"params"`
	Reason string `json:"reason"`
}

func (ct *Controller) request(c *gin.Context) {
	id, ok := uid(c)
	if !ok {
		return
	}
	var in actionReq
	if c.ShouldBindJSON(&in) != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Completa la solicitud.")
		return
	}
	a, err := ct.svc.Request(c.Request.Context(), ct.actor(c), id, in.Kind, in.Params, in.Reason)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (ct *Controller) decide(c *gin.Context) {
	id, ok := uid(c)
	if !ok {
		return
	}
	var in struct {
		Approve bool   `json:"approve"`
		Note    string `json:"note"`
	}
	if c.ShouldBindJSON(&in) != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Indica si apruebas o rechazas.")
		return
	}
	a, err := ct.svc.Decide(c.Request.Context(), ct.actor(c), id, in.Approve, in.Note)
	if err != nil {
		// Un reembolso con el cobro desactivado u otro error de ejecución ya quedó guardado como «failed» dentro de Decide.
		if errors.Is(err, payments.ErrInvalid) {
			shared.AbortWithError(c, http.StatusUnprocessableEntity, "invalid_request", capitalize(err.Error())+".")
			return
		}
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}
