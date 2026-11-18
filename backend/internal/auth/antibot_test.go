package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIsDisposableEmail(t *testing.T) {
	for email, want := range map[string]bool{
		"alguien@mailinator.com": true, "alguien@sub.yopmail.com": true, "ALGUIEN@Guerrillamail.COM": true,
		"nutri@gmail.com": false, "nutri@clinica.mx": false, "sin-arroba": false, "x@notmailinator.com": false,
	} {
		require.Equal(t, want, IsDisposableEmail(email), email)
	}
}

func TestTurnstileVerifier(t *testing.T) {
	var gotSecret, gotResp, gotIP string
	ok := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		gotSecret, gotResp, gotIP = r.Form.Get("secret"), r.Form.Get("response"), r.Form.Get("remoteip")
		if ok {
			_, _ = w.Write([]byte(`{"success":true}`))
		} else {
			_, _ = w.Write([]byte(`{"success":false,"error-codes":["invalid-input-response"]}`))
		}
	}))
	defer srv.Close()
	v := NewTurnstileVerifier("secreto")
	v.URL = srv.URL

	require.NoError(t, v.Verify(context.Background(), "token-bueno", "1.2.3.4"))
	require.Equal(t, []string{"secreto", "token-bueno", "1.2.3.4"}, []string{gotSecret, gotResp, gotIP})

	require.ErrorIs(t, v.Verify(context.Background(), "", ""), ErrCaptcha, "sin token ni se consulta")
	ok = false
	require.ErrorIs(t, v.Verify(context.Background(), "token-malo", ""), ErrCaptcha)

	// Falla cerrado: si el verificador no responde, no se abre la cuenta.
	srv.Close()
	require.Error(t, v.Verify(context.Background(), "token", ""))
}

type fakeCaptcha struct{ ok bool }

func (f fakeCaptcha) Verify(_ context.Context, token, _ string) error {
	if f.ok && token == "bueno" {
		return nil
	}
	return ErrCaptcha
}

func TestSignupAntibots(t *testing.T) {
	e := startEnv(t)
	e.svc.cfg.SignupEnabled = true
	e.svc.cfg.SignupRequireEmailVerification = true
	e.svc.cfg.TurnstileSiteKey = "clave-publica"
	e.svc.cfg.SMAEEnabled = false
	e.svc.SetCaptcha(fakeCaptcha{ok: true})

	t.Run("las opciones publican la clave del captcha y el estado del SMAE", func(t *testing.T) {
		res, body := e.client(t).do("GET", "/api/v1/auth/options", nil, false)
		require.Equal(t, 200, res.StatusCode)
		require.Equal(t, "clave-publica", body["captcha_site_key"])
		require.Equal(t, false, body["smae_enabled"])
	})

	t.Run("sin captcha válido no se crea la cuenta", func(t *testing.T) {
		c := e.client(t)
		res, body := c.do("POST", "/api/v1/auth/signup", signupBody("robot@gmail.com"), false)
		require.Equal(t, 422, res.StatusCode)
		require.Contains(t, body["error"].(map[string]any)["fields"], "captcha")
		b := signupBody("robot@gmail.com")
		b["captcha"] = "malo"
		res, _ = c.do("POST", "/api/v1/auth/signup", b, false)
		require.Equal(t, 422, res.StatusCode)
		var n int
		require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE email = 'robot@gmail.com'`).Scan(&n))
		require.Equal(t, 0, n)
	})

	t.Run("con captcha válido se crea", func(t *testing.T) {
		b := signupBody("humana@gmail.com")
		b["captcha"] = "bueno"
		res, _ := e.client(t).do("POST", "/api/v1/auth/signup", b, false)
		require.Equal(t, 202, res.StatusCode)
	})

	t.Run("correos temporales se rechazan", func(t *testing.T) {
		b := signupBody("falso@mailinator.com")
		b["captcha"] = "bueno"
		res, body := e.client(t).do("POST", "/api/v1/auth/signup", b, false)
		require.Equal(t, 422, res.StatusCode)
		require.Contains(t, body["error"].(map[string]any)["fields"], "email")
	})

	t.Run("límite por correo", func(t *testing.T) {
		c := e.client(t)
		b := signupBody("insistente@gmail.com")
		b["captcha"] = "bueno"
		for i := 0; i < 3; i++ {
			res, _ := c.do("POST", "/api/v1/auth/signup", b, false)
			require.Equal(t, 202, res.StatusCode, "intento %d", i)
		}
		res, body := c.do("POST", "/api/v1/auth/signup", b, false)
		require.Equal(t, 429, res.StatusCode)
		require.Equal(t, "rate_limited", errCode(body))
	})

	t.Run("la bitácora guarda la versión de términos", func(t *testing.T) {
		var meta string
		require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT metadata::text FROM audit_logs WHERE action = 'auth.signup' ORDER BY occurred_at DESC LIMIT 1`).Scan(&meta))
		require.Contains(t, meta, TermsVersion)
	})
}
