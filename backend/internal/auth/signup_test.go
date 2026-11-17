package auth

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func signupBody(email string) map[string]any {
	return map[string]any{"name": "Lic. Prueba", "email": email, "password": "clave-segura-1", "accept_terms": true}
}

func TestSignup(t *testing.T) {
	e := startEnv(t)
	e.svc.cfg.SignupEnabled = true
	e.svc.cfg.SignupRequireEmailVerification = true

	t.Run("con verificación: la cuenta queda pendiente hasta confirmar el correo", func(t *testing.T) {
		c := e.client(t)
		res, body := c.do("POST", "/api/v1/auth/signup", signupBody("Nueva@Gmail.com"), false)
		require.Equal(t, 202, res.StatusCode)
		require.Equal(t, false, body["verified"])

		res, body = c.do("POST", "/api/v1/auth/login", map[string]string{"email": "nueva@gmail.com", "password": "clave-segura-1"}, false)
		require.Equal(t, 403, res.StatusCode)
		require.Equal(t, "email_not_verified", errCode(body))

		e.mailer.mu.Lock()
		require.Len(t, e.mailer.verify, 1)
		link := e.mailer.verify[0]
		e.mailer.mu.Unlock()
		require.Contains(t, link, "http://app.test/verificar/")
		token := link[len("http://app.test/verificar/"):]

		res, _ = c.do("POST", "/api/v1/auth/verify", map[string]string{"token": token}, false)
		require.Equal(t, 204, res.StatusCode)
		res, _ = c.do("POST", "/api/v1/auth/verify", map[string]string{"token": token}, false)
		require.Equal(t, 400, res.StatusCode, "el enlace sirve una sola vez")

		res, body = c.do("POST", "/api/v1/auth/login", map[string]string{"email": "nueva@gmail.com", "password": "clave-segura-1"}, false)
		require.Equal(t, 200, res.StatusCode)
		user := body["user"].(map[string]any)
		require.Equal(t, "nutritionist", user["role"])
		require.NotContains(t, user["permissions"], "smae:manage", "el catálogo global no es de las cuentas nuevas")
	})

	t.Run("un correo repetido responde igual y no crea otra cuenta", func(t *testing.T) {
		c := e.client(t)
		res, body := c.do("POST", "/api/v1/auth/signup", signupBody("nueva@gmail.com"), false)
		require.Equal(t, 202, res.StatusCode)
		require.Equal(t, false, body["verified"])
		var n int
		require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT count(*) FROM users WHERE email = 'nueva@gmail.com'`).Scan(&n))
		require.Equal(t, 1, n)
	})

	t.Run("cada cuenta nueva abre su propia consulta con plan gratuito", func(t *testing.T) {
		var practices, free int
		require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT count(DISTINCT practice_id) FROM users WHERE email = 'nueva@gmail.com'`).Scan(&practices))
		require.Equal(t, 1, practices)
		require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT count(*) FROM subscriptions s JOIN users u ON u.practice_id = s.practice_id WHERE u.email = 'nueva@gmail.com' AND s.plan = 'free'`).Scan(&free))
		require.Equal(t, 1, free)
	})

	t.Run("exige términos, correo y contraseña válidos", func(t *testing.T) {
		c := e.client(t)
		b := signupBody("otra@gmail.com")
		b["accept_terms"] = false
		b["password"] = "123"
		res, body := c.do("POST", "/api/v1/auth/signup", b, false)
		require.Equal(t, 422, res.StatusCode)
		fields := body["error"].(map[string]any)["fields"].(map[string]any)
		require.Contains(t, fields, "accept_terms")
		require.Contains(t, fields, "password")
	})

	t.Run("sin verificación (solo pruebas): activa al instante y avisa del correo repetido", func(t *testing.T) {
		e.svc.cfg.SignupRequireEmailVerification = false
		defer func() { e.svc.cfg.SignupRequireEmailVerification = true }()
		c := e.client(t)
		res, body := c.do("POST", "/api/v1/auth/signup", signupBody("directa@gmail.com"), false)
		require.Equal(t, 202, res.StatusCode)
		require.Equal(t, true, body["verified"])
		res, _ = c.do("POST", "/api/v1/auth/login", map[string]string{"email": "directa@gmail.com", "password": "clave-segura-1"}, false)
		require.Equal(t, 200, res.StatusCode)
		res, body = c.do("POST", "/api/v1/auth/signup", signupBody("directa@gmail.com"), false)
		require.Equal(t, 409, res.StatusCode)
		require.Equal(t, "email_taken", errCode(body))
	})

	t.Run("cerrado: no se puede registrar", func(t *testing.T) {
		e.svc.cfg.SignupEnabled = false
		defer func() { e.svc.cfg.SignupEnabled = true }()
		c := e.client(t)
		res, body := c.do("POST", "/api/v1/auth/signup", signupBody("cerrada@gmail.com"), false)
		require.Equal(t, 403, res.StatusCode)
		require.Equal(t, "signup_closed", errCode(body))
		res, body = c.do("GET", "/api/v1/auth/options", nil, false)
		require.Equal(t, 200, res.StatusCode)
		require.Equal(t, false, body["enabled"])
	})
}
