package tenant_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/agenda"
	"github.com/nutri/app-nutricional/backend/internal/auditlog"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dietocalculo"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/mealplans"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/settings"
	"github.com/nutri/app-nutricional/backend/internal/smae"
	"github.com/nutri/app-nutricional/backend/internal/smae/sample"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }
func (noMail) SendVerification(context.Context, string, string) error  { return nil }

const tz = "America/Mexico_City"

// Dos consultas (A y B) con la API completa: B intenta leer y escribir cada cosa de A por todos los caminos HTTP.
func TestTwoPracticesCannotSeeEachOther(t *testing.T) {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute, Timezone: tz}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	cat := smae.NewService(pool, log)
	dsh := dishes.NewService(pool, cat, log)
	dsh.SetClinical(ps)
	plans := mealplans.NewService(pool, ps, tz, log)
	set := settings.NewService(pool, log)
	ag := agenda.NewService(pool, log)
	patientOf := func(c *gin.Context, uid uuid.UUID) (uuid.UUID, error) {
		p, err := ps.ForUser(c.Request.Context(), uid)
		return p.ID, err
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	smae.NewController(cat, as, log).Register(v1)
	dishes.NewController(dsh, as, log).Register(v1)
	mealplans.NewController(plans, as, dsh, patientOf, log).Register(v1)
	settings.NewController(set, as, log).Register(v1)
	agenda.NewController(ag, as, patientOf, log).Register(v1)
	dietocalculo.NewController(dietocalculo.NewService(pool, log), as, log).Register(v1)
	auditlog.NewController(pool, as).Register(v1)
	srv := httptest.NewServer(r)
	defer srv.Close()

	// El catálogo SMAE es compartido: lo importa la plataforma una vez.
	plat := testsupport.NewPractice(t, pool)
	rep, err := cat.ImportEdition(plat, smae.Actor{}, sample.Catalog())
	require.NoError(t, err)
	_, err = dsh.ActivateEdition(plat, dishes.Actor{}, rep.Edition.ID)
	require.NoError(t, err)

	// Cada nutrióloga abre SU consulta (sin consulta en el contexto, CreateUser crea una nueva).
	bg := context.Background()
	_, err = as.CreateUser(bg, "a@demo.mx", "Lic. A", "nutritionist", "demo1234")
	require.NoError(t, err)
	_, err = as.CreateUser(bg, "b@demo.mx", "Lic. B", "nutritionist", "demo1234")
	require.NoError(t, err)
	testsupport.GrantPlatformAdmin(t, pool, "a@demo.mx")
	A, B := testsupport.NewClient(t, srv.URL), testsupport.NewClient(t, srv.URL)
	A.Login("a@demo.mx", "demo1234")
	B.Login("b@demo.mx", "demo1234")

	patient := func(c *testsupport.Client, email string) string {
		code, p := c.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Pac", "last_name": email, "birth_date": "1990-01-01", "sex": "F", "email": email, "goal": "maintenance"})
		require.Equal(t, 201, code, fmt.Sprint(p))
		return p["id"].(string)
	}
	consent := func(c *testsupport.Client, id string) {
		_, cs := c.Do("GET", "/api/v1/patients/"+id+"/consents", nil)
		var ids []string
		for _, d := range cs["pending"].([]any) {
			ids = append(ids, d.(map[string]any)["id"].(string))
		}
		code, _ := c.Do("POST", "/api/v1/patients/"+id+"/consents/record", map[string]any{"document_ids": ids})
		require.Equal(t, 204, code)
	}
	patA := patient(A, "paciente@demo.mx")
	consent(A, patA)
	patB := patient(B, "paciente@demo.mx") // mismo correo en otra consulta: permitido

	start := time.Now().Add(48 * time.Hour).Truncate(time.Hour)
	iso := func(t time.Time) string { return t.UTC().Format(time.RFC3339) }
	foodID := func(c *testsupport.Client) string {
		_, b := c.Do("GET", "/api/v1/smae/foods?limit=3&search="+url.QueryEscape("pechuga"), nil)
		return b["items"].([]any)[0].(map[string]any)["id"].(string)
	}
	_ = patB

	// ---- Lo que crea A ----
	code, dish := A.Do("POST", "/api/v1/dishes", map[string]any{"name": "Pollo de A", "category": "Comida", "recipe_mode": "structured", "servings": "1", "steps": []string{"a"},
		"ingredients": []map[string]any{{"food_kind": "smae", "food_id": foodID(A), "quantity": "100", "unit": "g"}}})
	require.Equal(t, 201, code, fmt.Sprint(dish))
	dishA := dish["id"].(string)
	code, plan := A.Do("POST", "/api/v1/plans", map[string]any{"patient_id": patA, "name": "Plan de A", "start_date": start.Format("2006-01-02"), "end_date": start.AddDate(0, 0, 3).Format("2006-01-02")})
	require.Equal(t, 201, code, fmt.Sprint(plan))
	planA := plan["id"].(string)
	code, ap := A.Do("POST", "/api/v1/appointments", map[string]any{"patient_id": patA, "starts_at": iso(start), "ends_at": iso(start.Add(45 * time.Minute)), "place": "Consultorio de A", "notes": "n"})
	require.Equal(t, 201, code, fmt.Sprint(ap))
	inputs := map[string]any{"sex": "F", "age": 27, "weight_kg": 55, "height_cm": 173, "activity": "light", "formula": "mifflin", "goal": "maintain",
		"thermic": false, "athlete": false, "hospitalized": false, "macros": map[string]any{"carbs_pct": 55, "lipids_pct": 25, "protein_pct": 20}}
	code, dc := A.Do("POST", "/api/v1/diet-calculations", map[string]any{"name": "Dieta de A", "inputs": inputs})
	require.Equal(t, 201, code, fmt.Sprint(dc))
	dietA := dc["id"].(string)
	code, _ = A.Do("PUT", "/api/v1/settings/brand", map[string]any{"business_name": "Clínica A", "primary": "#2c5a78", "secondary": "#ddd6f2"})
	require.Equal(t, 200, code)

	t.Run("pacientes", func(t *testing.T) {
		code, _ := B.Do("GET", "/api/v1/patients/"+patA, nil)
		require.Equal(t, 404, code)
		code, _ = B.Do("PUT", "/api/v1/patients/"+patA, map[string]any{"first_name": "Hack"})
		require.Contains(t, []int{404, 422}, code)
		_, b := B.Do("GET", "/api/v1/patients", nil)
		for _, it := range b["items"].([]any) {
			require.NotEqual(t, patA, it.(map[string]any)["id"], "B no lista a los pacientes de A")
		}
		require.Len(t, b["items"], 1)
		code, _ = B.Do("GET", "/api/v1/patients/"+patA+"/consents", nil)
		require.Equal(t, 404, code)
	})

	t.Run("platillos", func(t *testing.T) {
		code, _ := B.Do("GET", "/api/v1/dishes/"+dishA, nil)
		require.Equal(t, 404, code)
		_, b := B.Do("GET", "/api/v1/dishes", nil)
		require.Empty(t, b["items"], "B no ve los platillos de A")
	})

	t.Run("planes", func(t *testing.T) {
		code, _ := B.Do("GET", "/api/v1/plans/"+planA, nil)
		require.Equal(t, 404, code)
		_, b := B.Do("GET", "/api/v1/plans", nil)
		require.Empty(t, b["items"])
		code, _ = B.Do("POST", "/api/v1/plans", map[string]any{"patient_id": patA, "name": "Intruso", "start_date": start.Format("2006-01-02"), "end_date": start.AddDate(0, 0, 2).Format("2006-01-02")})
		require.Contains(t, []int{404, 422}, code, "B no puede crear un plan para un paciente de A")
		code, _ = B.Do("DELETE", "/api/v1/plans/"+planA, nil)
		require.Equal(t, 404, code)
	})

	t.Run("agenda y calendario público", func(t *testing.T) {
		_, b := B.Do("GET", "/api/v1/appointments?from="+iso(start.Add(-time.Hour))+"&to="+iso(start.Add(24*time.Hour)), nil)
		require.Empty(t, b["items"], "B no ve las consultas de A")
		code, _ := B.Do("POST", "/api/v1/appointments", map[string]any{"patient_id": patA, "starts_at": iso(start), "ends_at": iso(start.Add(30 * time.Minute)), "place": "x"})
		require.Contains(t, []int{404, 422}, code, "B no agenda con un paciente de A")
		// El .ics de cada una trae solo sus consultas (el enlace es público: el token decide la consulta).
		_, fa := A.Do("GET", "/api/v1/calendar-feed", nil)
		_, fb := B.Do("GET", "/api/v1/calendar-feed", nil)
		anon := testsupport.NewClient(t, srv.URL)
		codeA, _, rawA := anon.GetRaw(fa["path"].(string))
		codeB, _, rawB := anon.GetRaw(fb["path"].(string))
		require.Equal(t, 200, codeA)
		require.Equal(t, 200, codeB)
		require.Contains(t, string(rawA), "Consultorio de A")
		require.NotContains(t, string(rawB), "Consultorio de A")
	})

	t.Run("dietocálculo", func(t *testing.T) {
		code, _ := B.Do("GET", "/api/v1/diet-calculations/"+dietA, nil)
		require.Equal(t, 404, code)
		_, b := B.Do("GET", "/api/v1/diet-calculations", nil)
		require.Empty(t, b["items"])
		code, _ = B.Do("PUT", "/api/v1/diet-calculations/"+dietA, map[string]any{"name": "Hack", "inputs": inputs})
		require.Equal(t, 404, code)
	})

	t.Run("configuración y marca", func(t *testing.T) {
		_, b := B.Do("GET", "/api/v1/settings", nil)
		require.NotEqual(t, "Clínica A", b["brand"].(map[string]any)["business_name"], "B no ve la marca de A")
		_, own := A.Do("GET", "/api/v1/settings", nil)
		require.Equal(t, "Clínica A", own["brand"].(map[string]any)["business_name"])
		code, _ := B.Do("PUT", "/api/v1/settings/profile", map[string]any{"full_name": "B", "modality": "online", "onboarding_done": true})
		require.Equal(t, 200, code)
		_, ownA := A.Do("GET", "/api/v1/settings", nil)
		require.Equal(t, false, ownA["profile"].(map[string]any)["onboarding_done"], "el perfil de B no cambia el de A")
		// La pantalla de ingreso nunca muestra la marca de una consulta.
		_, pub := testsupport.NewClient(t, srv.URL).Do("GET", "/api/v1/public/brand", nil)
		require.Equal(t, "Nutrición Integral", pub["business_name"])
	})

	t.Run("auditoría", func(t *testing.T) {
		_, b := B.Do("GET", "/api/v1/audit?page_size=100", nil)
		for _, it := range b["items"].([]any) {
			require.NotContains(t, fmt.Sprint(it), "Lic. A", "B no ve eventos de A")
		}
	})

	t.Run("una paciente solo entra a la consulta de su nutrióloga", func(t *testing.T) {
		ctxA := testsupport.CtxOf(t, pool, "a@demo.mx")
		uid, err := as.CreateUser(ctxA, "pac.a@demo.mx", "Pac A", "patient", "demo1234")
		require.NoError(t, err)
		_, err = pool.Exec(ctxA, `UPDATE patients SET user_id = $1 WHERE id = $2`, uid, patA)
		require.NoError(t, err)
		pc := testsupport.NewClient(t, srv.URL)
		pc.Login("pac.a@demo.mx", "demo1234")
		code, _ := pc.Do("GET", "/api/v1/patients/"+patA, nil)
		require.Equal(t, 403, code, "una paciente no usa las rutas de la nutrióloga")
		code, _ = pc.Do("GET", "/api/v1/plans/"+planA, nil)
		require.Equal(t, 403, code)
	})
}
