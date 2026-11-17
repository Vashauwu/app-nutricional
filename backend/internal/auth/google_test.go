package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

const testClientID = "cliente-prueba.apps.googleusercontent.com"

// fakeGoogle simula a Google: devuelve los datos que se le indiquen o falla.
type fakeGoogle map[string]GoogleClaims

func (f fakeGoogle) Verify(_ context.Context, raw string) (GoogleClaims, error) {
	if c, ok := f[raw]; ok {
		return c, nil
	}
	return GoogleClaims{}, ErrGoogleToken
}

func TestGoogleVerifier(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "k1", "kty": "RSA", "alg": "RS256",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	defer srv.Close()
	v := NewGoogleVerifier(testClientID)
	v.jwksURL = srv.URL

	sign := func(mut func(c *googleIDClaims), signer *rsa.PrivateKey) string {
		c := &googleIDClaims{Email: "Dra@Gmail.com", EmailVerified: true, Name: "Dra. Prueba", RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "https://accounts.google.com", Audience: jwt.ClaimStrings{testClientID}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), Subject: "123"}}
		if mut != nil {
			mut(c)
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
		tok.Header["kid"] = "k1"
		s, err := tok.SignedString(signer)
		require.NoError(t, err)
		return s
	}
	ctx := context.Background()

	got, err := v.Verify(ctx, sign(nil, key))
	require.NoError(t, err)
	require.Equal(t, "Dra@Gmail.com", got.Email)

	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	for name, tok := range map[string]string{
		"firma de otra llave":  sign(nil, other),
		"otra audiencia":       sign(func(c *googleIDClaims) { c.Audience = jwt.ClaimStrings{"otro-cliente"} }, key),
		"vencido":              sign(func(c *googleIDClaims) { c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour)) }, key),
		"otro emisor":          sign(func(c *googleIDClaims) { c.Issuer = "https://evil.example" }, key),
		"correo sin verificar": sign(func(c *googleIDClaims) { c.EmailVerified = false }, key),
		"sin correo":           sign(func(c *googleIDClaims) { c.Email = "" }, key),
		"basura":               "no-es-un-jwt",
	} {
		_, err := v.Verify(ctx, tok)
		require.ErrorIs(t, err, ErrGoogleToken, name)
	}
}

func TestGoogleSignIn(t *testing.T) {
	e := startEnv(t)
	e.svc.cfg.SignupEnabled = true
	e.svc.cfg.GoogleClientID = testClientID
	e.svc.SetGoogleVerifier(fakeGoogle{
		"nuevo":     {Email: "Nueva.Dra@gmail.com", Name: "Dra. Nueva"},
		"paciente":  {Email: "paciente@gmail.com", Name: "Pac"},
		"pendiente": {Email: "pendiente@gmail.com", Name: "Pend"},
	})
	post := func(cred string, terms bool) (*http.Response, map[string]any) {
		return e.client(t).do("POST", "/api/v1/auth/google", map[string]any{"credential": cred, "accept_terms": terms}, false)
	}

	t.Run("las opciones publican el ID de cliente", func(t *testing.T) {
		_, body := e.client(t).do("GET", "/api/v1/auth/options", nil, false)
		require.Equal(t, testClientID, body["google_client_id"])
	})

	t.Run("cuenta nueva sin aceptar términos: no se crea", func(t *testing.T) {
		res, body := post("nuevo", false)
		require.Equal(t, 409, res.StatusCode)
		require.Equal(t, "terms_required", errCode(body))
		var n int
		require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT count(*) FROM users WHERE email = 'nueva.dra@gmail.com'`).Scan(&n))
		require.Equal(t, 0, n)
	})

	t.Run("cuenta nueva aceptando términos: abre consulta gratuita y sesión", func(t *testing.T) {
		res, body := post("nuevo", true)
		require.Equal(t, 200, res.StatusCode)
		require.Equal(t, true, body["created"])
		user := body["user"].(map[string]any)
		require.Equal(t, "nutritionist", user["role"])
		require.NotContains(t, user["permissions"], "smae:manage")
		var free int
		require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT count(*) FROM subscriptions s JOIN users u ON u.practice_id = s.practice_id WHERE u.email = 'nueva.dra@gmail.com' AND s.plan = 'free'`).Scan(&free))
		require.Equal(t, 1, free)
	})

	t.Run("la segunda vez solo ingresa, sin duplicar la cuenta", func(t *testing.T) {
		res, body := post("nuevo", false)
		require.Equal(t, 200, res.StatusCode)
		require.Equal(t, false, body["created"])
		var n int
		require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT count(*) FROM users WHERE email = 'nueva.dra@gmail.com'`).Scan(&n))
		require.Equal(t, 1, n)
	})

	t.Run("una cuenta de paciente no entra por Google", func(t *testing.T) {
		e.user(t, "paciente@gmail.com", "patient")
		res, body := post("paciente", true)
		require.Equal(t, 403, res.StatusCode)
		require.Equal(t, "google_not_allowed", errCode(body))
	})

	t.Run("un registro pendiente de confirmar se activa", func(t *testing.T) {
		_, err := e.svc.createUser(e.ctx, "pendiente@gmail.com", "Pend", "nutritionist", "clave-segura-1", "invited")
		require.NoError(t, err)
		res, _ := post("pendiente", false)
		require.Equal(t, 200, res.StatusCode)
		var st string
		require.NoError(t, e.pool.QueryRow(t.Context(), `SELECT status FROM users WHERE email = 'pendiente@gmail.com'`).Scan(&st))
		require.Equal(t, "active", st)
	})

	t.Run("token inválido y registro cerrado", func(t *testing.T) {
		res, body := post("falso", true)
		require.Equal(t, 401, res.StatusCode)
		require.Equal(t, "google_invalid", errCode(body))
		e.svc.cfg.SignupEnabled = false
		defer func() { e.svc.cfg.SignupEnabled = true }()
		e.svc.google.(fakeGoogle)["otra"] = GoogleClaims{Email: "otra@gmail.com", Name: "Otra"}
		res, body = post("otra", true)
		require.Equal(t, 403, res.StatusCode)
		require.Equal(t, "signup_closed", errCode(body))
	})

	t.Run("sin configurar: no existe", func(t *testing.T) {
		e2 := startEnv(t)
		res, body := e2.client(t).do("POST", "/api/v1/auth/google", map[string]any{"credential": "x"}, false)
		require.Equal(t, 404, res.StatusCode)
		require.Equal(t, "google_disabled", errCode(body))
	})
}
