package dashboard_test

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

	"github.com/nutri/app-nutricional/backend/internal/alerts"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dashboard"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/mealplans"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/settings"
	"github.com/nutri/app-nutricional/backend/internal/smae"
	"github.com/nutri/app-nutricional/backend/internal/smae/sample"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
	"github.com/nutri/app-nutricional/backend/internal/tracking"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }

const tz = "America/Mexico_City"

func TestDashboardIntegration(t *testing.T) {
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
	trk := tracking.NewService(pool, nil, tz, log)
	alertsSvc := alerts.NewService(pool, plans, set)
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
	tracking.NewController(trk, as, patientOf, 20<<20, log).Register(v1)
	dashboard.NewController(dashboard.NewService(pool, alertsSvc, trk), as).Register(v1)
	srv := httptest.NewServer(r)
	defer srv.Close()
	ctx := context.Background()

	rep, err := cat.ImportEdition(ctx, smae.Actor{}, sample.Catalog())
	require.NoError(t, err)
	_, err = dsh.ActivateEdition(ctx, dishes.Actor{}, rep.Edition.ID)
	require.NoError(t, err)
	_, err = as.CreateUser(ctx, "nutri@demo.mx", "Lic.", "nutritionist", "demo1234")
	require.NoError(t, err)
	nutri := testsupport.NewClient(t, srv.URL)
	nutri.Login("nutri@demo.mx", "demo1234")

	t.Run("tablero vacío", func(t *testing.T) {
		code, d := nutri.Do("GET", "/api/v1/dashboard", nil)
		require.Equal(t, 200, code, fmt.Sprint(d))
		require.EqualValues(t, 0, d["patients"].(map[string]any)["total"])
		require.Nil(t, d["compliance"].(map[string]any)["pct"], "sin comidas programadas no hay porcentaje")
		require.Empty(t, d["activity"])
		require.Empty(t, d["plans"].(map[string]any)["ending_soon"])
	})

	mk := func(email string, consent bool) string {
		_, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Pac", "last_name": email, "birth_date": "1990-01-01", "sex": "F", "email": email, "goal": "maintenance"})
		id := p["id"].(string)
		if consent {
			_, cs := nutri.Do("GET", "/api/v1/patients/"+id+"/consents", nil)
			var ids []string
			for _, d := range cs["pending"].([]any) {
				ids = append(ids, d.(map[string]any)["id"].(string))
			}
			nutri.Do("POST", "/api/v1/patients/"+id+"/consents/record", map[string]any{"document_ids": ids})
		}
		return id
	}
	pa := mk("ana@demo.mx", true)
	mk("sin@demo.mx", false)
	uid, err := as.CreateUser(ctx, "ana.login@demo.mx", "Ana", "patient", "demo1234")
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE patients SET user_id=$1 WHERE id=$2`, uid, pa)
	require.NoError(t, err)

	_, fb := nutri.Do("GET", "/api/v1/smae/foods?limit=3&search="+url.QueryEscape("pechuga"), nil)
	code, dish := nutri.Do("POST", "/api/v1/dishes", map[string]any{"name": "Pollo", "category": "Comida", "recipe_mode": "structured", "servings": "1", "steps": []string{"a"},
		"ingredients": []map[string]any{{"food_kind": "smae", "food_id": fb["items"].([]any)[0].(map[string]any)["id"], "quantity": "100", "unit": "g"}}})
	require.Equal(t, 201, code)
	loc, _ := time.LoadLocation(tz)
	today := time.Now().In(loc).Format("2006-01-02")
	_, v := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "Plan", "start_date": today, "end_date": today})
	days := v["days"].([]any)[0].(map[string]any)
	itemID := uuid.NewString()
	var slots []any
	for i, s := range days["slots"].([]any) {
		sm := s.(map[string]any)
		items := []any{}
		if i == 0 {
			items = append(items, map[string]any{"id": itemID, "dish_id": dish["id"], "dish_version": 1, "servings": "1", "instructions": ""})
		}
		slots = append(slots, map[string]any{"id": sm["id"], "name": sm["name"], "items": items})
	}
	code, _ = nutri.Do("PUT", "/api/v1/plans/"+v["id"].(string), map[string]any{"expected_revision": 1, "name": "Plan", "targets": v["targets"], "days": []any{map[string]any{"date": today, "notes": "", "slots": slots}}})
	require.Equal(t, 200, code)
	code, _ = nutri.Do("POST", "/api/v1/plans/"+v["id"].(string)+"/publish", map[string]any{"summary": "x"})
	require.Equal(t, 200, code)

	t.Run("cuenta pacientes, planes y cumplimiento sin registros", func(t *testing.T) {
		_, d := nutri.Do("GET", "/api/v1/dashboard", nil)
		pt := d["patients"].(map[string]any)
		require.EqualValues(t, 2, pt["total"])
		require.EqualValues(t, 1, pt["consent_pending"])
		pl := d["plans"].(map[string]any)
		require.EqualValues(t, 1, pl["published"])
		require.Len(t, pl["ending_soon"], 1, "el plan de hoy termina en ≤ 3 días")
		pp := d["compliance"].(map[string]any)["per_patient"].([]any)
		require.Len(t, pp, 1)
		require.EqualValues(t, 1, pp[0].(map[string]any)["planned"])
		require.EqualValues(t, 0, d["compliance"].(map[string]any)["pct"])
		require.Empty(t, d["activity"])
	})

	t.Run("refleja la actividad y el cumplimiento tras el registro de la paciente", func(t *testing.T) {
		ana := testsupport.NewClient(t, srv.URL)
		ana.Login("ana.login@demo.mx", "demo1234")
		code, e := ana.Do("PUT", "/api/v1/me/tracking/items/"+itemID, map[string]any{"status": "done"})
		require.Equal(t, 200, code, fmt.Sprint(e))
		_, d := nutri.Do("GET", "/api/v1/dashboard", nil)
		require.EqualValues(t, 100, d["compliance"].(map[string]any)["pct"])
		require.Len(t, d["activity"], 1)
		require.EqualValues(t, 1, d["to_review"])
		require.Equal(t, "Pollo", d["activity"].([]any)[0].(map[string]any)["dish_name"])
	})

	t.Run("solo la nutrióloga", func(t *testing.T) {
		code, _ := testsupport.NewClient(t, srv.URL).Do("GET", "/api/v1/dashboard", nil)
		require.Equal(t, 401, code)
		ana := testsupport.NewClient(t, srv.URL)
		ana.Login("ana.login@demo.mx", "demo1234")
		code, _ = ana.Do("GET", "/api/v1/dashboard", nil)
		require.Equal(t, 403, code)
	})
}
