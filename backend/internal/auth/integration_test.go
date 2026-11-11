package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
)

// Pruebas de integración con PostgreSQL real (§22). Se omiten si Docker no está disponible.

type captureMailer struct {
	mu      sync.Mutex
	links   []string
	changed int
}

func (m *captureMailer) SendPasswordReset(_ context.Context, _ string, link string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.links = append(m.links, link)
	return nil
}
func (m *captureMailer) SendInvitation(context.Context, string, string) error { return nil }
func (m *captureMailer) SendPasswordChanged(context.Context, string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.changed++
	return nil
}
func (m *captureMailer) last() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.links) == 0 {
		return ""
	}
	return m.links[len(m.links)-1]
}
func (m *captureMailer) count() int { m.mu.Lock(); defer m.mu.Unlock(); return len(m.links) }

type env struct {
	pool   *pgxpool.Pool
	svc    *Service
	srv    *httptest.Server
	mailer *captureMailer
}

func startEnv(t *testing.T) *env {
	t.Helper()
	testcontainers.SkipIfProviderIsNotHealthy(t)
	ctx := context.Background()
	ctr, err := postgres.Run(ctx, "postgres:17-alpine",
		postgres.WithDatabase("nutri"), postgres.WithUsername("nutri"), postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(90*time.Second)))
	require.NoError(t, err)
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(ctr) })
	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	files, err := filepath.Glob(filepath.Join("..", "..", "migrations", "*.up.sql"))
	require.NoError(t, err)
	sort.Strings(files)
	require.NotEmpty(t, files)
	for _, f := range files {
		sql, err := os.ReadFile(f)
		require.NoError(t, err)
		_, err = pool.Exec(ctx, string(sql))
		require.NoError(t, err, f)
	}

	cfg := config.Config{
		JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour,
		PasswordResetTTL: 30 * time.Minute, CookieSecure: false, AppBaseURL: "http://app.test",
	}
	mailer := &captureMailer{}
	svc := NewService(pool, cfg, mailer, slog.New(slog.NewTextHandler(io.Discard, nil)))

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	NewController(svc, cfg).Register(v1)
	v1.GET("/_t/nutri", Authenticate(svc), RequireRole("nutritionist"), func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	v1.GET("/_t/perm", Authenticate(svc), RequirePermission("patients:manage"), func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return &env{pool: pool, svc: svc, srv: srv, mailer: mailer}
}

type client struct {
	t   *testing.T
	e   *env
	hc  *http.Client
	url *url.URL
}

func (e *env) client(t *testing.T) *client {
	jar, _ := cookiejar.New(nil)
	u, _ := url.Parse(e.srv.URL)
	return &client{t: t, e: e, hc: &http.Client{Jar: jar}, url: u}
}

func (c *client) cookie(name string) string {
	// El jar filtra por ruta: se consulta la de /api/v1/auth para ver también el refresh token.
	u := *c.url
	u.Path = "/api/v1/auth/x"
	for _, ck := range c.hc.Jar.Cookies(&u) {
		if ck.Name == name {
			return ck.Value
		}
	}
	return ""
}

func (c *client) do(method, path string, body any, csrf bool) (*http.Response, map[string]any) {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.e.srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0")
	if csrf {
		req.Header.Set(XSRFHeader, c.cookie(XSRFCookie))
	}
	res, err := c.hc.Do(req)
	require.NoError(c.t, err)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res, out
}

func (e *env) user(t *testing.T, email, role string) {
	t.Helper()
	_, err := e.svc.CreateUser(context.Background(), email, "Usuario "+role, role, "demo1234")
	require.NoError(t, err)
}

func errCode(b map[string]any) string {
	m, _ := b["error"].(map[string]any)
	s, _ := m["code"].(string)
	return s
}

func TestAuthIntegration(t *testing.T) {
	e := startEnv(t)

	t.Run("login emite cookies seguras y datos del usuario sin exponer tokens en el cuerpo", func(t *testing.T) {
		e.user(t, "nutri1@demo.mx", "nutritionist")
		c := e.client(t)
		res, body := c.do("POST", "/api/v1/auth/login", map[string]string{"email": "  NUTRI1@demo.mx ", "password": "demo1234"}, false)
		require.Equal(t, 200, res.StatusCode)
		user := body["user"].(map[string]any)
		require.Equal(t, "nutritionist", user["role"])
		require.Contains(t, user["permissions"], "patients:manage")
		require.NotContains(t, string(mustJSON(body)), "access_token")
		flags := map[string]*http.Cookie{}
		for _, ck := range res.Cookies() {
			flags[ck.Name] = ck
		}
		require.True(t, flags[accessCookie].HttpOnly)
		require.True(t, flags[refreshCookie].HttpOnly)
		require.Equal(t, "/api/v1/auth", flags[refreshCookie].Path)
		require.False(t, flags[XSRFCookie].HttpOnly, "Angular debe poder leer la cookie XSRF")
		require.Equal(t, http.SameSiteStrictMode, flags[accessCookie].SameSite)
	})

	t.Run("credenciales inválidas y cuenta inexistente son indistinguibles", func(t *testing.T) {
		e.user(t, "nutri2@demo.mx", "nutritionist")
		c := e.client(t)
		r1, b1 := c.do("POST", "/api/v1/auth/login", map[string]string{"email": "nutri2@demo.mx", "password": "mala-clave1"}, false)
		r2, b2 := c.do("POST", "/api/v1/auth/login", map[string]string{"email": "nadie@demo.mx", "password": "mala-clave1"}, false)
		require.Equal(t, 401, r1.StatusCode)
		require.Equal(t, 401, r2.StatusCode)
		require.Equal(t, errCode(b1), errCode(b2))
		require.Equal(t, b1["error"].(map[string]any)["message"], b2["error"].(map[string]any)["message"])
	})

	t.Run("me exige sesión", func(t *testing.T) {
		e.user(t, "nutri3@demo.mx", "nutritionist")
		c := e.client(t)
		res, _ := c.do("GET", "/api/v1/auth/me", nil, false)
		require.Equal(t, 401, res.StatusCode)
		c.do("POST", "/api/v1/auth/login", map[string]string{"email": "nutri3@demo.mx", "password": "demo1234"}, false)
		res, body := c.do("GET", "/api/v1/auth/me", nil, false)
		require.Equal(t, 200, res.StatusCode)
		require.Equal(t, "nutri3@demo.mx", body["user"].(map[string]any)["email"])
	})

	t.Run("CSRF: las operaciones que modifican estado exigen el encabezado", func(t *testing.T) {
		e.user(t, "nutri4@demo.mx", "nutritionist")
		c := e.client(t)
		c.do("POST", "/api/v1/auth/login", map[string]string{"email": "nutri4@demo.mx", "password": "demo1234"}, false)
		res, body := c.do("POST", "/api/v1/auth/logout", nil, false)
		require.Equal(t, 403, res.StatusCode)
		require.Equal(t, "csrf_failed", errCode(body))
		res, _ = c.do("POST", "/api/v1/auth/logout", nil, true)
		require.Equal(t, 204, res.StatusCode)
		res, _ = c.do("GET", "/api/v1/auth/me", nil, false)
		require.Equal(t, 401, res.StatusCode, "tras cerrar sesión el access token deja de servir de inmediato")
	})

	t.Run("refresh rota el token y reutilizar uno viejo revoca la sesión", func(t *testing.T) {
		e.user(t, "nutri5@demo.mx", "nutritionist")
		c := e.client(t)
		c.do("POST", "/api/v1/auth/login", map[string]string{"email": "nutri5@demo.mx", "password": "demo1234"}, false)
		r1 := c.cookie(refreshCookie)
		res, _ := c.do("POST", "/api/v1/auth/refresh", nil, true)
		require.Equal(t, 200, res.StatusCode)
		r2 := c.cookie(refreshCookie)
		require.NotEqual(t, r1, r2, "el refresh token debe rotar")

		// Dentro de la ventana de gracia no se revoca (dos pestañas a la vez).
		_, err := e.svc.Refresh(context.Background(), r1, Meta{})
		require.ErrorIs(t, err, ErrSessionInvalid)
		res, _ = c.do("GET", "/api/v1/auth/me", nil, false)
		require.Equal(t, 200, res.StatusCode, "la sesión sigue viva dentro de la gracia")

		// Fuera de la ventana: robo presunto → se revoca la sesión completa.
		e.svc.now = func() time.Time { return time.Now().Add(time.Minute) }
		t.Cleanup(func() { e.svc.now = time.Now })
		_, err = e.svc.Refresh(context.Background(), r1, Meta{})
		require.ErrorIs(t, err, ErrSessionInvalid)
		_, err = e.svc.Refresh(context.Background(), r2, Meta{})
		require.ErrorIs(t, err, ErrSessionInvalid, "el token legítimo también queda invalidado")
		var n int
		require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action='auth.refresh_reuse'`).Scan(&n))
		require.Equal(t, 1, n)
	})

	t.Run("en la base solo se guarda el hash del refresh token", func(t *testing.T) {
		e.user(t, "nutri6@demo.mx", "nutritionist")
		c := e.client(t)
		c.do("POST", "/api/v1/auth/login", map[string]string{"email": "nutri6@demo.mx", "password": "demo1234"}, false)
		raw := c.cookie(refreshCookie)
		var found int
		require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM user_sessions WHERE refresh_token_hash = $1`, []byte(raw)).Scan(&found))
		require.Zero(t, found)
		require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM user_sessions WHERE refresh_token_hash = $1`, HashToken(raw)).Scan(&found))
		require.Equal(t, 1, found)
	})

	t.Run("sesiones: listar, cerrar otra y cerrar todas las demás", func(t *testing.T) {
		e.user(t, "nutri7@demo.mx", "nutritionist")
		a, b := e.client(t), e.client(t)
		a.do("POST", "/api/v1/auth/login", map[string]string{"email": "nutri7@demo.mx", "password": "demo1234"}, false)
		b.do("POST", "/api/v1/auth/login", map[string]string{"email": "nutri7@demo.mx", "password": "demo1234"}, false)
		_, body := a.do("GET", "/api/v1/auth/sessions", nil, false)
		items := body["items"].([]any)
		require.Len(t, items, 2)
		current := 0
		for _, it := range items {
			if it.(map[string]any)["current"].(bool) {
				current++
			}
		}
		require.Equal(t, 1, current)
		require.Contains(t, items[0].(map[string]any)["device"], "Windows")

		res, body2 := a.do("POST", "/api/v1/auth/sessions/revoke-others", nil, true)
		require.Equal(t, 200, res.StatusCode)
		require.EqualValues(t, 1, body2["revoked"])
		res, _ = b.do("GET", "/api/v1/auth/me", nil, false)
		require.Equal(t, 401, res.StatusCode)
		res, _ = a.do("GET", "/api/v1/auth/me", nil, false)
		require.Equal(t, 200, res.StatusCode)
	})

	t.Run("no se puede cerrar la sesión de otro usuario", func(t *testing.T) {
		e.user(t, "nutri8@demo.mx", "nutritionist")
		e.user(t, "pac8@demo.mx", "patient")
		n, p := e.client(t), e.client(t)
		n.do("POST", "/api/v1/auth/login", map[string]string{"email": "nutri8@demo.mx", "password": "demo1234"}, false)
		p.do("POST", "/api/v1/auth/login", map[string]string{"email": "pac8@demo.mx", "password": "demo1234"}, false)
		_, body := n.do("GET", "/api/v1/auth/sessions", nil, false)
		victim := body["items"].([]any)[0].(map[string]any)["id"].(string)
		res, _ := p.do("DELETE", "/api/v1/auth/sessions/"+victim, nil, true)
		require.Equal(t, 404, res.StatusCode)
		res, _ = n.do("GET", "/api/v1/auth/me", nil, false)
		require.Equal(t, 200, res.StatusCode)
	})

	t.Run("recuperación: respuesta genérica, un solo uso, cierra sesiones y avisa", func(t *testing.T) {
		e.user(t, "reset@demo.mx", "patient")
		sess := e.client(t)
		sess.do("POST", "/api/v1/auth/login", map[string]string{"email": "reset@demo.mx", "password": "demo1234"}, false)

		c := e.client(t)
		before := e.mailer.count()
		r1, b1 := c.do("POST", "/api/v1/auth/password/forgot", map[string]string{"email": "reset@demo.mx"}, false)
		r2, b2 := c.do("POST", "/api/v1/auth/password/forgot", map[string]string{"email": "fantasma@demo.mx"}, false)
		require.Equal(t, 202, r1.StatusCode)
		require.Equal(t, 202, r2.StatusCode)
		require.Equal(t, b1, b2, "no revela si la cuenta existe")
		require.Equal(t, before+1, e.mailer.count(), "solo se envía correo a cuentas reales")

		link := e.mailer.last()
		require.True(t, strings.HasPrefix(link, "http://app.test/restablecer/"))
		token := strings.TrimPrefix(link, "http://app.test/restablecer/")

		res, body := c.do("POST", "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "debil"}, false)
		require.Equal(t, 422, res.StatusCode)
		require.Equal(t, "weak_password", errCode(body))

		res, _ = c.do("POST", "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "NuevaClave2026"}, false)
		require.Equal(t, 204, res.StatusCode)
		res, body = c.do("POST", "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "OtraClave2026"}, false)
		require.Equal(t, 400, res.StatusCode, "el token es de un solo uso")
		require.Equal(t, "invalid_reset_token", errCode(body))
		require.Equal(t, 1, e.mailer.changed)

		res, _ = sess.do("GET", "/api/v1/auth/me", nil, false)
		require.Equal(t, 401, res.StatusCode, "las sesiones previas se cierran")
		res, _ = c.do("POST", "/api/v1/auth/login", map[string]string{"email": "reset@demo.mx", "password": "demo1234"}, false)
		require.Equal(t, 401, res.StatusCode)
		res, _ = c.do("POST", "/api/v1/auth/login", map[string]string{"email": "reset@demo.mx", "password": "NuevaClave2026"}, false)
		require.Equal(t, 200, res.StatusCode)
	})

	t.Run("un enlace de recuperación vencido no funciona", func(t *testing.T) {
		e.user(t, "vence@demo.mx", "patient")
		c := e.client(t)
		c.do("POST", "/api/v1/auth/password/forgot", map[string]string{"email": "vence@demo.mx"}, false)
		token := strings.TrimPrefix(e.mailer.last(), "http://app.test/restablecer/")
		_, err := e.pool.Exec(context.Background(), `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute'`)
		require.NoError(t, err)
		res, body := c.do("POST", "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "NuevaClave2026"}, false)
		require.Equal(t, 400, res.StatusCode)
		require.Equal(t, "invalid_reset_token", errCode(body))
	})

	t.Run("RBAC: cada rol solo entra a lo suyo", func(t *testing.T) {
		e.user(t, "n9@demo.mx", "nutritionist")
		e.user(t, "p9@demo.mx", "patient")
		anon, n, p := e.client(t), e.client(t), e.client(t)
		n.do("POST", "/api/v1/auth/login", map[string]string{"email": "n9@demo.mx", "password": "demo1234"}, false)
		p.do("POST", "/api/v1/auth/login", map[string]string{"email": "p9@demo.mx", "password": "demo1234"}, false)
		for path, want := range map[string][3]int{"/api/v1/_t/nutri": {401, 200, 403}, "/api/v1/_t/perm": {401, 200, 403}} {
			r, _ := anon.do("GET", path, nil, false)
			require.Equal(t, want[0], r.StatusCode, path)
			r, _ = n.do("GET", path, nil, false)
			require.Equal(t, want[1], r.StatusCode, path)
			r, body := p.do("GET", path, nil, false)
			require.Equal(t, want[2], r.StatusCode, path)
			require.Equal(t, "forbidden", errCode(body))
		}
	})

	t.Run("cuentas deshabilitadas no inician sesión", func(t *testing.T) {
		e.user(t, "off@demo.mx", "patient")
		_, err := e.pool.Exec(context.Background(), `UPDATE users SET status='disabled' WHERE email='off@demo.mx'`)
		require.NoError(t, err)
		res, _ := e.client(t).do("POST", "/api/v1/auth/login", map[string]string{"email": "off@demo.mx", "password": "demo1234"}, false)
		require.Equal(t, 401, res.StatusCode)
	})

	t.Run("límite de intentos: bloquea aunque después llegue la clave correcta", func(t *testing.T) {
		e.user(t, "brute@demo.mx", "patient")
		c := e.client(t)
		for i := 0; i < 5; i++ {
			res, _ := c.do("POST", "/api/v1/auth/login", map[string]string{"email": "brute@demo.mx", "password": "incorrecta1"}, false)
			require.Equal(t, 401, res.StatusCode)
		}
		res, body := c.do("POST", "/api/v1/auth/login", map[string]string{"email": "brute@demo.mx", "password": "demo1234"}, false)
		require.Equal(t, 429, res.StatusCode)
		require.Equal(t, "rate_limited", errCode(body))
		require.Equal(t, "900", res.Header.Get("Retry-After"))
	})

	t.Run("la auditoría registra eventos sin secretos", func(t *testing.T) {
		rows, err := e.pool.Query(context.Background(), `SELECT action, metadata::text FROM audit_logs`)
		require.NoError(t, err)
		defer rows.Close()
		actions := map[string]bool{}
		for rows.Next() {
			var a, m string
			require.NoError(t, rows.Scan(&a, &m))
			actions[a] = true
			require.NotContains(t, strings.ToLower(m), "token")
			require.NotContains(t, strings.ToLower(m), "password")
		}
		for _, want := range []string{"auth.login", "auth.login_failed", "auth.login_blocked", "auth.logout", "auth.password_reset"} {
			require.True(t, actions[want], want)
		}
	})
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
