package auditlog_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/auditlog"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }

func TestAuditLogIntegration(t *testing.T) {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	auditlog.NewController(pool, as).Register(v1)
	srv := httptest.NewServer(r)
	defer srv.Close()
	ctx := context.Background()

	_, err := as.CreateUser(ctx, "nutri@demo.mx", "Lic. Prueba", "nutritionist", "demo1234")
	require.NoError(t, err)
	nutri := testsupport.NewClient(t, srv.URL)
	nutri.Login("nutri@demo.mx", "demo1234")
	code, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Ana", "last_name": "Pérez", "birth_date": "1990-01-01", "sex": "F", "email": "ana@demo.mx", "goal": "maintenance"})
	require.Equal(t, 201, code, fmt.Sprint(p))

	t.Run("lista los eventos con actor y paginación", func(t *testing.T) {
		code, b := nutri.Do("GET", "/api/v1/audit?page_size=5", nil)
		require.Equal(t, 200, code, fmt.Sprint(b))
		items := b["items"].([]any)
		require.NotEmpty(t, items)
		require.LessOrEqual(t, len(items), 5)
		first := items[0].(map[string]any)
		require.NotEmpty(t, first["action"])
		require.NotEmpty(t, first["actor"])
		require.NotEmpty(t, first["at"])
		require.Greater(t, b["total"], float64(0))
	})

	t.Run("filtra por texto sin interpretar comodines", func(t *testing.T) {
		_, b := nutri.Do("GET", "/api/v1/audit?search=patient", nil)
		require.NotEmpty(t, b["items"])
		_, none := nutri.Do("GET", "/api/v1/audit?search=zzz-no-existe", nil)
		require.Empty(t, none["items"])
		_, wild := nutri.Do("GET", "/api/v1/audit?search=%25", nil)
		require.Empty(t, wild["items"], "el % no es comodín")
	})

	t.Run("solo con permiso audit:read", func(t *testing.T) {
		code, _ := testsupport.NewClient(t, srv.URL).Do("GET", "/api/v1/audit", nil)
		require.Equal(t, 401, code)
		_, err := as.CreateUser(ctx, "pac@demo.mx", "Pac", "patient", "demo1234")
		require.NoError(t, err)
		pc := testsupport.NewClient(t, srv.URL)
		pc.Login("pac@demo.mx", "demo1234")
		code, _ = pc.Do("GET", "/api/v1/audit", nil)
		require.Equal(t, 403, code)
	})
}
