package auth

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

const (
	accessCookie  = "nutri_access"
	refreshCookie = "nutri_refresh"
	// XSRFCookie lo lee Angular (no es HttpOnly) y lo devuelve en X-XSRF-TOKEN (§5.1).
	XSRFCookie  = "XSRF-TOKEN"
	XSRFHeader  = "X-XSRF-TOKEN"
	identityKey = "identity"
)

type Controller struct {
	svc          *Service
	cfg          config.Config
	resetLimiter *Limiter
}

func NewController(svc *Service, cfg config.Config) *Controller {
	return &Controller{svc: svc, cfg: cfg, resetLimiter: NewLimiter(5, 15*time.Minute)}
}

func meta(c *gin.Context) Meta {
	return Meta{IP: c.ClientIP(), UserAgent: c.Request.UserAgent(), RequestID: middleware.GetRequestID(c)}
}

// Register monta /auth bajo el grupo /api/v1.
func (ct *Controller) Register(v1 *gin.RouterGroup) {
	g := v1.Group("/auth")
	g.POST("/login", middleware.RateLimit(30, 15*time.Minute), ct.login)
	g.POST("/password/forgot", middleware.RateLimit(10, 15*time.Minute), ct.forgot)
	g.POST("/password/reset", middleware.RateLimit(20, 15*time.Minute), ct.reset)
	g.POST("/refresh", CSRF(), ct.refresh)
	g.POST("/logout", CSRF(), ct.logout)

	secured := g.Group("", Authenticate(ct.svc))
	secured.GET("/me", ct.me)
	secured.GET("/sessions", ct.sessions)
	secured.DELETE("/sessions/:id", CSRF(), ct.revokeSession)
	secured.POST("/sessions/revoke-others", CSRF(), ct.revokeOthers)
}

// ---------- Cookies ----------
func (ct *Controller) setCookie(c *gin.Context, name, value, path string, exp time.Time, httpOnly bool) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: name, Value: value, Path: path, Expires: exp, MaxAge: int(time.Until(exp).Seconds()),
		HttpOnly: httpOnly, Secure: ct.cfg.CookieSecure, SameSite: http.SameSiteStrictMode,
	})
}

func (ct *Controller) clearCookies(c *gin.Context) {
	past := time.Unix(0, 0)
	for _, ck := range []struct {
		n, p string
		h    bool
	}{{accessCookie, "/", true}, {refreshCookie, "/api/v1/auth", true}, {XSRFCookie, "/", false}} {
		http.SetCookie(c.Writer, &http.Cookie{Name: ck.n, Value: "", Path: ck.p, Expires: past, MaxAge: -1, HttpOnly: ck.h, Secure: ct.cfg.CookieSecure, SameSite: http.SameSiteStrictMode})
	}
}

func (ct *Controller) writeTokens(c *gin.Context, t *Tokens) error {
	xsrf, _, err := NewOpaqueToken()
	if err != nil {
		return err
	}
	ct.setCookie(c, accessCookie, t.Access, "/", t.RefreshExp, true) // el JWT caduca solo; la cookie vive lo que la sesión
	ct.setCookie(c, refreshCookie, t.Refresh, "/api/v1/auth", t.RefreshExp, true)
	ct.setCookie(c, XSRFCookie, xsrf, "/", t.RefreshExp, false)
	return nil
}

// ---------- Handlers ----------
type loginReq struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func (ct *Controller) login(c *gin.Context) {
	var in loginReq
	if err := c.ShouldBindJSON(&in); err != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Escribe tu correo y contraseña.")
		return
	}
	t, err := ct.svc.Login(c.Request.Context(), in.Email, in.Password, meta(c))
	switch {
	case errors.Is(err, ErrRateLimited):
		c.Header("Retry-After", "900")
		shared.AbortWithError(c, http.StatusTooManyRequests, "rate_limited", ErrRateLimited.Error())
		return
	case errors.Is(err, ErrInvalidCredentials):
		shared.AbortWithError(c, http.StatusUnauthorized, "invalid_credentials", ErrInvalidCredentials.Error())
		return
	case err != nil:
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo iniciar sesión.")
		return
	}
	if err := ct.writeTokens(c, t); err != nil {
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo iniciar sesión.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": t.Identity, "access_expires_at": t.AccessExp})
}

func (ct *Controller) refresh(c *gin.Context) {
	raw, _ := c.Cookie(refreshCookie)
	t, err := ct.svc.Refresh(c.Request.Context(), raw, meta(c))
	if err != nil {
		if errors.Is(err, ErrSessionInvalid) {
			ct.clearCookies(c)
			shared.AbortWithError(c, http.StatusUnauthorized, "session_expired", "Tu sesión terminó. Inicia sesión de nuevo.")
			return
		}
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo renovar la sesión.")
		return
	}
	if err := ct.writeTokens(c, t); err != nil {
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo renovar la sesión.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": t.Identity, "access_expires_at": t.AccessExp})
}

func (ct *Controller) logout(c *gin.Context) {
	raw, _ := c.Cookie(refreshCookie)
	ct.svc.LogoutByRefresh(c.Request.Context(), raw, meta(c))
	ct.clearCookies(c)
	c.Status(http.StatusNoContent)
}

func (ct *Controller) me(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"user": IdentityFrom(c)}) }

type sessionDTO struct {
	ID         uuid.UUID `json:"id"`
	Device     string    `json:"device"`
	UserAgent  string    `json:"user_agent"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
	Current    bool      `json:"current"`
}

func (ct *Controller) sessions(c *gin.Context) {
	id := IdentityFrom(c)
	list, err := ct.svc.ListSessions(c.Request.Context(), id.UserID)
	if err != nil {
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudieron consultar las sesiones.")
		return
	}
	out := make([]sessionDTO, 0, len(list))
	for _, s := range list {
		out = append(out, sessionDTO{ID: s.ID, Device: s.DeviceLabel, UserAgent: s.UserAgent, CreatedAt: s.CreatedAt.Time, LastSeenAt: s.LastSeenAt.Time, Current: s.ID == id.SessionID})
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

func (ct *Controller) revokeSession(c *gin.Context) {
	id := IdentityFrom(c)
	sid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "Sesión no encontrada.")
		return
	}
	if err := ct.svc.RevokeSession(c.Request.Context(), id.UserID, sid, meta(c)); err != nil {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "Sesión no encontrada.")
		return
	}
	if sid == id.SessionID {
		ct.clearCookies(c)
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) revokeOthers(c *gin.Context) {
	id := IdentityFrom(c)
	n, err := ct.svc.RevokeOthers(c.Request.Context(), id.UserID, id.SessionID, meta(c))
	if err != nil {
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudieron cerrar las sesiones.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"revoked": n})
}

type forgotReq struct {
	Email string `json:"email" binding:"required"`
}

// forgot responde siempre 202 con el mismo cuerpo, exista o no la cuenta (§5.2).
func (ct *Controller) forgot(c *gin.Context) {
	var in forgotReq
	if err := c.ShouldBindJSON(&in); err != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Escribe tu correo.")
		return
	}
	key := c.ClientIP() + "|" + in.Email
	if ct.resetLimiter.Allowed(key) {
		ct.resetLimiter.Fail(key)
		_ = ct.svc.RequestPasswordReset(c.Request.Context(), in.Email, meta(c))
	}
	c.JSON(http.StatusAccepted, gin.H{"message": "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña."})
}

type resetReq struct {
	Token    string `json:"token" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func (ct *Controller) reset(c *gin.Context) {
	var in resetReq
	if err := c.ShouldBindJSON(&in); err != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Datos incompletos.")
		return
	}
	err := ct.svc.ResetPassword(c.Request.Context(), in.Token, in.Password, meta(c))
	switch {
	case errors.Is(err, ErrWeakPassword):
		shared.AbortWithError(c, http.StatusUnprocessableEntity, "weak_password", ErrWeakPassword.Error())
	case errors.Is(err, ErrBadResetToken):
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_reset_token", ErrBadResetToken.Error())
	case err != nil:
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo cambiar la contraseña.")
	default:
		ct.clearCookies(c)
		c.Status(http.StatusNoContent)
	}
}

// ---------- Middlewares reutilizables por los demás módulos ----------

// Authenticate exige un access token válido y una sesión vigente.
func Authenticate(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := c.Cookie(accessCookie)
		if err != nil || raw == "" {
			shared.AbortWithError(c, http.StatusUnauthorized, "unauthenticated", "Inicia sesión para continuar.")
			return
		}
		id, err := svc.Authenticate(c.Request.Context(), raw)
		if err != nil {
			if errors.Is(err, ErrSessionInvalid) {
				shared.AbortWithError(c, http.StatusUnauthorized, "unauthenticated", "Tu sesión terminó. Inicia sesión de nuevo.")
				return
			}
			shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "No se pudo validar la sesión.")
			return
		}
		c.Set(identityKey, id)
		c.Next()
	}
}

// IdentityFrom devuelve la identidad autenticada (nil si no pasó por Authenticate).
func IdentityFrom(c *gin.Context) *Identity {
	v, ok := c.Get(identityKey)
	if !ok {
		return nil
	}
	id, _ := v.(*Identity)
	return id
}

// RequireRole autoriza por rol. Debe ir después de Authenticate.
func RequireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if id := IdentityFrom(c); id == nil || id.Role != role {
			shared.AbortWithError(c, http.StatusForbidden, "forbidden", "No tienes permiso para esta operación.")
			return
		}
		c.Next()
	}
}

// RequirePermission autoriza por permiso (RBAC por rol; preparado para permisos por usuario, §2.2).
func RequirePermission(code string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := IdentityFrom(c)
		if id != nil {
			for _, p := range id.Permissions {
				if p == code {
					c.Next()
					return
				}
			}
		}
		shared.AbortWithError(c, http.StatusForbidden, "forbidden", "No tienes permiso para esta operación.")
	}
}

// CSRF aplica doble envío de cookie en métodos que modifican estado.
func CSRF() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}
		ck, err := c.Cookie(XSRFCookie)
		h := c.GetHeader(XSRFHeader)
		if err != nil || ck == "" || subtle.ConstantTimeCompare([]byte(ck), []byte(h)) != 1 {
			shared.AbortWithError(c, http.StatusForbidden, "csrf_failed", "Solicitud no verificada. Recarga la página e inténtalo de nuevo.")
			return
		}
		c.Next()
	}
}
