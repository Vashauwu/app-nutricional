package alerts_test

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

func TestAlertsIntegration(t *testing.T) {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	cat := smae.NewService(pool, log)
	dsh := dishes.NewService(pool, cat, log)
	dsh.SetClinical(ps)
	plans := mealplans.NewService(pool, ps, "America/Mexico_City", log)
	set := settings.NewService(pool, log)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	smae.NewController(cat, as, log).Register(v1)
	dishes.NewController(dsh, as, log).Register(v1)
	mealplans.NewController(plans, as, dsh, func(c *gin.Context, uid uuid.UUID) (uuid.UUID, error) {
		p, err := ps.ForUser(c.Request.Context(), uid)
		return p.ID, err
	}, log).Register(v1)
	settings.NewController(set, as, log).Register(v1)
	alerts.NewController(alerts.NewService(pool, plans, set), as, log).Register(v1)
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

	_, fb := nutri.Do("GET", "/api/v1/smae/foods?limit=3&search="+url.QueryEscape("pechuga"), nil)
	foodID := fb["items"].([]any)[0].(map[string]any)["id"].(string)
	code, dish := nutri.Do("POST", "/api/v1/dishes", map[string]any{"name": "Pechuga a la plancha", "category": "Comida", "recipe_mode": "structured", "servings": "1", "steps": []string{"a"},
		"ingredients": []map[string]any{{"food_kind": "smae", "food_id": foodID, "quantity": "100", "unit": "g"}}})
	require.Equal(t, 201, code, fmt.Sprint(dish))
	dishID := dish["id"].(string)

	code, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Ana", "last_name": "Pérez", "birth_date": "1990-01-01", "sex": "F", "email": "ana@demo.mx", "goal": "maintenance"})
	require.Equal(t, 201, code)
	pid := p["id"].(string)
	_, cs := nutri.Do("GET", "/api/v1/patients/"+pid+"/consents", nil)
	var ids []string
	for _, d := range cs["pending"].([]any) {
		ids = append(ids, d.(map[string]any)["id"].(string))
	}
	nutri.Do("POST", "/api/v1/patients/"+pid+"/consents/record", map[string]any{"document_ids": ids})

	today := time.Now().Format("2006-01-02")
	code, v := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pid, "name": "Plan", "start_date": today, "end_date": today})
	require.Equal(t, 201, code, fmt.Sprint(v))
	planID := v["id"].(string)
	day := v["days"].([]any)[0].(map[string]any)
	slots := []any{}
	for i, s := range day["slots"].([]any) {
		sm := s.(map[string]any)
		items := []any{}
		if i == 2 {
			items = append(items, map[string]any{"id": uuid.NewString(), "dish_id": dishID, "dish_version": 1, "servings": "1", "instructions": ""})
		}
		slots = append(slots, map[string]any{"id": sm["id"], "name": sm["name"], "items": items})
	}
	var cur map[string]any
	putPlan := func(energy string) {
		_, cur = nutri.Do("GET", "/api/v1/plans/"+planID, nil)
		code, b := nutri.Do("PUT", "/api/v1/plans/"+planID, map[string]any{"expected_revision": cur["revision"], "name": "Plan",
			"targets": map[string]any{"energy_kcal": energy, "protein_g": "0", "carbohydrates_g": "0", "lipids_g": "0", "equivalents": map[string]any{}},
			"days":    []any{map[string]any{"date": today, "notes": "", "slots": slots}}})
		require.Equal(t, 200, code, fmt.Sprint(b))
	}
	list := func() []map[string]any {
		code, b := nutri.Do("GET", "/api/v1/plans/"+planID+"/alerts", nil)
		require.Equal(t, 200, code, fmt.Sprint(b))
		out := []map[string]any{}
		for _, a := range b["items"].([]any) {
			out = append(out, a.(map[string]any))
		}
		return out
	}
	kinds := func(l []map[string]any) map[string]string {
		m := map[string]string{}
		for _, a := range l {
			m[a["kind"].(string)] = a["level"].(string)
		}
		return m
	}

	t.Run("sin objetivos ni datos clínicos no hay alertas", func(t *testing.T) {
		putPlan("0")
		require.Empty(t, list())
	})

	t.Run("desviación de energía: advertencia y crítica según la tolerancia", func(t *testing.T) {
		putPlan("2000") // 165 kcal frente a 2000 → muy por debajo
		l := list()
		require.Equal(t, "critical", kinds(l)["energy"])
		require.Contains(t, l[0]["reason"], "frente a un objetivo de 2000 kcal")
		require.NotEmpty(t, l[0]["source"])
		putPlan("180") // 165 vs 180 = -8.3 % dentro de ±10 %
		require.NotContains(t, kinds(list()), "energy")
		putPlan("200") // -17.5 % → advertencia (entre 10 y 20)
		require.Equal(t, "warning", kinds(list())["energy"])
	})

	t.Run("alergias (con alias y sin acentos), restricciones y reglas clínicas", func(t *testing.T) {
		putPlan("165")
		code, _ := nutri.Do("POST", "/api/v1/patients/"+pid+"/allergies", map[string]any{"allergen": "Gallina", "aliases": []string{"PECHUGA"}, "severity": "severe", "reaction": "Urticaria"})
		require.Equal(t, 201, code)
		code, _ = nutri.Do("POST", "/api/v1/patients/"+pid+"/preferences", map[string]any{"food_name": "plancha", "preference_type": "avoid"})
		require.Equal(t, 201, code)
		code, _ = nutri.Do("POST", "/api/v1/patients/"+pid+"/preferences", map[string]any{"food_name": "plancha", "preference_type": "favorite"})
		require.Equal(t, 201, code)
		code, _ = nutri.Do("POST", "/api/v1/patients/"+pid+"/conditions", map[string]any{"name": "Gota", "details": "ácido úrico alto", "status": "active"})
		require.Equal(t, 201, code)
		code, _ = nutri.Do("PUT", "/api/v1/settings/alerts", map[string]any{"energy_tolerance_pct": "10", "macro_tolerance_pct": "15", "equivalent_tolerance": "1",
			"clinical_rules": []map[string]any{{"keyword": "gota", "triggers": []string{"pechuga"}, "level": "warning", "message": "Revisar purinas con gota", "enabled": true}}})
		require.Equal(t, 200, code)

		l := list()
		k := kinds(l)
		require.Equal(t, "critical", k["allergy"], "el alias PECHUGA coincide con «Pechuga» sin importar mayúsculas")
		require.Equal(t, "warning", k["restriction"])
		require.Equal(t, "warning", k["clinical"])
		require.Equal(t, "critical", l[0]["level"], "las críticas van primero")
		var allergy map[string]any
		for _, a := range l {
			if a["kind"] == "allergy" {
				allergy = a
			}
		}
		require.Contains(t, allergy["reason"], "severa")
		require.Contains(t, allergy["source"], "Urticaria")
		require.Equal(t, pid, allergy["patient_id"])

		// «favorite» no genera alerta: solo hubo UNA de restricción.
		n := 0
		for _, a := range l {
			if a["kind"] == "restriction" {
				n++
			}
		}
		require.Equal(t, 1, n)
	})

	t.Run("alergias resueltas y reglas desactivadas no alertan", func(t *testing.T) {
		_, cl := nutri.Do("GET", "/api/v1/patients/"+pid+"/clinical", nil)
		al := cl["allergies"].([]any)[0].(map[string]any)
		code, _ := nutri.Do("PUT", "/api/v1/patients/"+pid+"/allergies/"+al["id"].(string), map[string]any{"allergen": "Gallina", "aliases": []string{"PECHUGA"}, "severity": "severe", "status": "resolved"})
		require.Equal(t, 200, code)
		require.NotContains(t, kinds(list()), "allergy")
		nutri.Do("PUT", "/api/v1/settings/alerts", map[string]any{"energy_tolerance_pct": "10", "macro_tolerance_pct": "15", "equivalent_tolerance": "1",
			"clinical_rules": []map[string]any{{"keyword": "gota", "triggers": []string{"pechuga"}, "level": "warning", "message": "Revisar purinas con gota", "enabled": false}}})
		require.NotContains(t, kinds(list()), "clinical")
	})

	t.Run("tablero de planes publicados, permisos y errores", func(t *testing.T) {
		code, _ := nutri.Do("POST", "/api/v1/plans/"+planID+"/publish", map[string]any{"summary": "x"})
		require.Equal(t, 200, code, "las alertas no bloquean la publicación")
		code, s := nutri.Do("GET", "/api/v1/alerts", nil)
		require.Equal(t, 200, code, fmt.Sprint(s))
		require.NotNil(t, s["items"])
		code, _ = nutri.Do("GET", "/api/v1/plans/"+uuid.NewString()+"/alerts", nil)
		require.Equal(t, 404, code)
		code, _ = testsupport.NewClient(t, srv.URL).Do("GET", "/api/v1/alerts", nil)
		require.Equal(t, 401, code)
		_, err := as.CreateUser(ctx, "pac@demo.mx", "Pac", "patient", "demo1234")
		require.NoError(t, err)
		pc := testsupport.NewClient(t, srv.URL)
		pc.Login("pac@demo.mx", "demo1234")
		code, _ = pc.Do("GET", "/api/v1/plans/"+planID+"/alerts", nil)
		require.Equal(t, 403, code, "las alertas son internas de la nutrióloga")
	})
}
