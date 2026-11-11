package auth_test

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type silentMail struct{}

func (silentMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (silentMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (silentMail) SendInvitation(context.Context, string, string) error    { return nil }

func TestSetPasswordByEmail(t *testing.T) {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute}
	svc := auth.NewService(pool, cfg, silentMail{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	auth.NewController(svc, cfg).Register(r.Group("/api/v1"))
	srv := httptest.NewServer(r)
	defer srv.Close()
	ctx := context.Background()

	_, err := svc.CreateUser(ctx, "ana@demo.mx", "Ana", "nutritionist", "Vieja12345")
	require.NoError(t, err)

	open := testsupport.NewClient(t, srv.URL)
	open.Login("ana@demo.mx", "Vieja12345")
	code, _ := open.Do("GET", "/api/v1/auth/me", nil)
	require.Equal(t, 200, code, "sesión abierta antes del cambio")

	t.Run("rechaza contraseñas débiles y cuentas inexistentes", func(t *testing.T) {
		require.ErrorIs(t, svc.SetPasswordByEmail(ctx, "ana@demo.mx", "corta"), auth.ErrWeakPassword)
		require.ErrorIs(t, svc.SetPasswordByEmail(ctx, "nadie@demo.mx", "Nueva12345"), auth.ErrNotFound)
		require.Error(t, svc.SetPasswordByEmail(ctx, "no-es-correo", "Nueva12345"))
	})

	t.Run("cambia la contraseña y cierra las sesiones abiertas", func(t *testing.T) {
		require.NoError(t, svc.SetPasswordByEmail(ctx, "Ana@Demo.mx", "Nueva12345"), "el correo no distingue mayúsculas")

		code, _ := open.Do("GET", "/api/v1/auth/me", nil)
		require.Equal(t, 401, code, "la sesión anterior deja de servir")

		old := testsupport.NewClient(t, srv.URL)
		code, _ = old.Do("POST", "/api/v1/auth/login", map[string]string{"email": "ana@demo.mx", "password": "Vieja12345"})
		require.Equal(t, 401, code, "la contraseña anterior ya no entra")

		fresh := testsupport.NewClient(t, srv.URL)
		fresh.Login("ana@demo.mx", "Nueva12345")
		code, _ = fresh.Do("GET", "/api/v1/auth/me", nil)
		require.Equal(t, 200, code)
	})

	t.Run("queda en la bitácora de auditoría", func(t *testing.T) {
		var n int
		require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE action = 'auth.password_set_by_admin'`).Scan(&n))
		require.Equal(t, 1, n)
	})
}
