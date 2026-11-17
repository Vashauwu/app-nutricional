package dietocalculo_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dietocalculo"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }
func (noMail) SendVerification(context.Context, string, string) error  { return nil }

func TestDietocalculoAPI(t *testing.T) {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute, Timezone: "America/Mexico_City"}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	dietocalculo.NewController(dietocalculo.NewService(pool, log), as, log).Register(v1)
	srv := httptest.NewServer(r)
	defer srv.Close()
	ctx := testsupport.NewPractice(t, pool)

	_, err := as.CreateUser(ctx, "nutri@demo.mx", "Lic.", "nutritionist", "demo1234")
	require.NoError(t, err)
	_, err = as.CreateUser(ctx, "pac@demo.mx", "Pac", "patient", "demo1234")
	require.NoError(t, err)
	nutri := testsupport.NewClient(t, srv.URL)
	nutri.Login("nutri@demo.mx", "demo1234")
	_, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Ana", "last_name": "Prueba", "birth_date": "1990-01-01", "sex": "F", "email": "ana@demo.mx", "goal": "maintenance"})
	pid := p["id"].(string)

	inputs := map[string]any{"sex": "F", "age": 27, "weight_kg": 55, "height_cm": 173, "activity": "light", "formula": "mifflin", "goal": "maintain",
		"thermic": false, "athlete": false, "hospitalized": false, "macros": map[string]any{"carbs_pct": 55, "lipids_pct": 25, "protein_pct": 20}}

	t.Run("calcular sin guardar", func(t *testing.T) {
		code, b := nutri.Do("POST", "/api/v1/diet-calculations/compute", inputs)
		require.Equal(t, 200, code, fmt.Sprint(b))
		require.EqualValues(t, 1840, b["energy"].(map[string]any)["prescription_kcal"])
		require.NotEmpty(t, b["dietosintetico"].(map[string]any)["rows"])
	})

	var id string
	t.Run("guardar independiente, enlazar y listar", func(t *testing.T) {
		code, b := nutri.Do("POST", "/api/v1/diet-calculations", map[string]any{"name": "Nueva dieta", "inputs": inputs})
		require.Equal(t, 201, code, fmt.Sprint(b))
		id = b["id"].(string)
		require.Nil(t, b["patient_id"])
		require.EqualValues(t, 1840, b["kcal"])

		code, b = nutri.Do("PUT", "/api/v1/diet-calculations/"+id, map[string]any{"name": "Dieta de Ana", "patient_id": pid, "inputs": inputs})
		require.Equal(t, 200, code, fmt.Sprint(b))
		require.Equal(t, pid, b["patient_id"])
		require.Equal(t, "Ana Prueba", b["patient_name"])

		_, b = nutri.Do("GET", "/api/v1/diet-calculations?patient_id="+pid, nil)
		require.Len(t, b["items"], 1)
		_, b = nutri.Do("GET", "/api/v1/diet-calculations?unlinked=true", nil)
		require.Empty(t, b["items"])
		_, b = nutri.Do("GET", "/api/v1/diet-calculations?q=ana", nil)
		require.Len(t, b["items"], 1)
		code, b = nutri.Do("GET", "/api/v1/diet-calculations/"+id, nil)
		require.Equal(t, 200, code)
		require.NotNil(t, b["result"])
	})

	t.Run("guarda platillos y reparto manual", func(t *testing.T) {
		in := map[string]any{}
		for k, v := range inputs {
			in[k] = v
		}
		in["menu"] = map[string]any{"Desayuno": []any{map[string]any{"id": "m1", "kind": "dish", "name": "Avena", "qty": "porción", "qty_n": 1.5, "kcal": 300, "protein_g": 10, "carbs_g": 50, "lipids_g": 6, "fiber_g": 5, "eq": map[string]any{"CER-SG": 2}}}}
		in["dist_override"] = map[string]any{"VER": []any{1, 0, 2, 0, 1}}
		code, b := nutri.Do("PUT", "/api/v1/diet-calculations/"+id, map[string]any{"name": "Dieta de Ana", "patient_id": pid, "inputs": in})
		require.Equal(t, 200, code, fmt.Sprint(b))
		_, b = nutri.Do("GET", "/api/v1/diet-calculations/"+id, nil)
		menu := b["inputs"].(map[string]any)["menu"].(map[string]any)["Desayuno"].([]any)
		require.Len(t, menu, 1)
		require.EqualValues(t, 1.5, menu[0].(map[string]any)["qty_n"])
		require.NotNil(t, b["result"].(map[string]any)["distribution_remaining"])
		in["menu"] = map[string]any{"Desayuno": []any{map[string]any{"id": "m1", "kind": "dish", "name": "x", "qty_n": 0}}}
		code, _ = nutri.Do("PUT", "/api/v1/diet-calculations/"+id, map[string]any{"name": "x", "inputs": in})
		require.Equal(t, 422, code)
	})

	t.Run("validaciones", func(t *testing.T) {
		bad := map[string]any{"sex": "F", "age": 5, "weight_kg": 55, "height_cm": 173, "macros": map[string]any{"carbs_pct": 50, "lipids_pct": 30, "protein_pct": 30}}
		code, b := nutri.Do("POST", "/api/v1/diet-calculations", map[string]any{"name": "", "inputs": bad})
		require.Equal(t, 422, code, fmt.Sprint(b))
		f := testsupport.ErrFields(b)
		require.Contains(t, f, "name")
		require.Contains(t, f, "age")
		require.Contains(t, f, "macros")
		code, _ = nutri.Do("POST", "/api/v1/diet-calculations", map[string]any{"name": "x", "patient_id": uuid.NewString(), "inputs": inputs})
		require.Equal(t, 422, code)
	})

	t.Run("permisos", func(t *testing.T) {
		pat := testsupport.NewClient(t, srv.URL)
		pat.Login("pac@demo.mx", "demo1234")
		code, _ := pat.Do("GET", "/api/v1/diet-calculations", nil)
		require.Equal(t, 403, code)
		anon := testsupport.NewClient(t, srv.URL)
		code, _ = anon.Do("GET", "/api/v1/diet-calculations", nil)
		require.Equal(t, 401, code)
	})

	t.Run("eliminar", func(t *testing.T) {
		code, _ := nutri.Do("DELETE", "/api/v1/diet-calculations/"+id, nil)
		require.Equal(t, 204, code)
		code, _ = nutri.Do("GET", "/api/v1/diet-calculations/"+id, nil)
		require.Equal(t, 404, code)
		code, _ = nutri.Do("DELETE", "/api/v1/diet-calculations/"+id, nil)
		require.Equal(t, 404, code)
	})
}
