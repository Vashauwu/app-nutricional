package mealplans_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/mealplans"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/smae"
	"github.com/nutri/app-nutricional/backend/internal/smae/sample"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }

type env struct {
	pool *pgxpool.Pool
	srv  *httptest.Server
	auth *auth.Service
}

func start(t *testing.T) *env {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute, AppBaseURL: "http://app.test", Timezone: "America/Mexico_City"}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	cat := smae.NewService(pool, log)
	dsh := dishes.NewService(pool, cat, log)
	dsh.SetClinical(ps)
	plans := mealplans.NewService(pool, ps, cfg.Timezone, log)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	smae.NewController(cat, as, log).Register(v1)
	dishes.NewController(dsh, as, log).Register(v1)
	mealplans.NewController(plans, as, dsh, func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error) {
		p, err := ps.ForUser(c.Request.Context(), userID)
		if err != nil {
			return uuid.Nil, err
		}
		if ok, _ := ps.ConsentComplete(c.Request.Context(), p.ID); !ok {
			return uuid.Nil, mealplans.ErrConsentPending
		}
		return p.ID, nil
	}, log).Register(v1)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	rep, err := cat.ImportEdition(context.Background(), smae.Actor{}, sample.Catalog())
	require.NoError(t, err)
	_, err = dsh.ActivateEdition(context.Background(), dishes.Actor{}, rep.Edition.ID)
	require.NoError(t, err)
	return &env{pool: pool, srv: srv, auth: as}
}

func (e *env) staff(t *testing.T) *testsupport.Client {
	_, err := e.auth.CreateUser(context.Background(), fmt.Sprintf("nutri%s@demo.mx", uuid.NewString()[:6]), "Lic. Prueba", "nutritionist", "demo1234")
	require.NoError(t, err)
	return nil
}

func (e *env) login(t *testing.T, email, role string) *testsupport.Client {
	_, err := e.auth.CreateUser(context.Background(), email, "Usuario", role, "demo1234")
	require.NoError(t, err)
	c := testsupport.NewClient(t, e.srv.URL)
	c.Login(email, "demo1234")
	return c
}

func foodID(t *testing.T, c *testsupport.Client, q string) string {
	_, b := c.Do("GET", "/api/v1/smae/foods?limit=3&search="+url.QueryEscape(q), nil)
	return b["items"].([]any)[0].(map[string]any)["id"].(string)
}

func newDish(t *testing.T, c *testsupport.Client, name string, foodQ, qty, unit string) string {
	code, d := c.Do("POST", "/api/v1/dishes", map[string]any{"name": name, "category": "Comida", "recipe_mode": "structured", "servings": "1", "steps": []string{"a"},
		"ingredients": []map[string]any{{"food_kind": "smae", "food_id": foodID(t, c, foodQ), "quantity": qty, "unit": unit}}})
	require.Equal(t, 201, code, fmt.Sprint(d))
	return d["id"].(string)
}

// newPatient crea un paciente con consentimientos completos; linkUser le asigna una cuenta de acceso.
func newPatient(t *testing.T, e *env, c *testsupport.Client, email string, consent bool) string {
	code, p := c.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Pac", "last_name": email, "birth_date": "1990-01-01", "sex": "F", "email": email, "goal": "maintenance"})
	require.Equal(t, 201, code, fmt.Sprint(p))
	id := p["id"].(string)
	if consent {
		_, cs := c.Do("GET", "/api/v1/patients/"+id+"/consents", nil)
		var ids []string
		for _, d := range cs["pending"].([]any) {
			ids = append(ids, d.(map[string]any)["id"].(string))
		}
		code, _ = c.Do("POST", "/api/v1/patients/"+id+"/consents/record", map[string]any{"document_ids": ids})
		require.Equal(t, 204, code)
	}
	return id
}

func linkAccount(t *testing.T, e *env, patientID, email string) *testsupport.Client {
	uid, err := e.auth.CreateUser(context.Background(), email, "Paciente", "patient", "demo1234")
	require.NoError(t, err)
	_, err = e.pool.Exec(context.Background(), `UPDATE patients SET user_id = $1 WHERE id = $2`, uid, patientID)
	require.NoError(t, err)
	c := testsupport.NewClient(t, e.srv.URL)
	c.Login(email, "demo1234")
	return c
}

func day(date string, slots ...map[string]any) map[string]any {
	return map[string]any{"date": date, "notes": "", "slots": slots}
}
func slot(id, name string, items ...map[string]any) map[string]any {
	return map[string]any{"id": id, "name": name, "items": items}
}
func item(id, dish string, version int, servings string) map[string]any {
	return map[string]any{"id": id, "dish_id": dish, "dish_version": version, "servings": servings, "instructions": ""}
}

func save(t *testing.T, c *testsupport.Client, planID string, rev any, doc map[string]any) (int, map[string]any) {
	body := map[string]any{"expected_revision": rev}
	for k, v := range doc {
		body[k] = v
	}
	return c.Do("PUT", "/api/v1/plans/"+planID, body)
}

func docOf(v map[string]any) map[string]any {
	// Convierte la vista de un plan en el documento que espera el guardado.
	days := []any{}
	for _, d := range v["days"].([]any) {
		dm := d.(map[string]any)
		slots := []any{}
		for _, s := range dm["slots"].([]any) {
			sm := s.(map[string]any)
			items := []any{}
			for _, it := range sm["items"].([]any) {
				im := it.(map[string]any)
				items = append(items, map[string]any{"id": im["id"], "dish_id": im["dish_id"], "dish_version": im["dish_version"], "servings": im["servings"], "instructions": im["instructions"]})
			}
			slots = append(slots, map[string]any{"id": sm["id"], "name": sm["name"], "items": items})
		}
		days = append(days, map[string]any{"date": dm["date"], "notes": dm["notes"], "slots": slots})
	}
	return map[string]any{"name": v["name"], "targets": v["targets"], "days": days}
}

func firstSlot(v map[string]any, dayIdx, slotIdx int) map[string]any {
	return v["days"].([]any)[dayIdx].(map[string]any)["slots"].([]any)[slotIdx].(map[string]any)
}

func createPlan(t *testing.T, c *testsupport.Client, patient, name, start, end string) map[string]any {
	code, v := c.Do("POST", "/api/v1/plans", map[string]any{"patient_id": patient, "name": name, "start_date": start, "end_date": end})
	require.Equal(t, 201, code, fmt.Sprint(v))
	return v
}

func TestMealPlansIntegration(t *testing.T) {
	e := start(t)
	ctx := context.Background()
	nutri := e.login(t, "nutri@demo.mx", "nutritionist")
	pollo := newDish(t, nutri, "Pollo", "pechuga", "100", "g") // 165 kcal
	arroz := newDish(t, nutri, "Arroz", "arroz", "1", "taza")  // 208 kcal
	atun := newDish(t, nutri, "Atún", "atun", "1", "lata")     // 162.4 kcal
	pa := newPatient(t, e, nutri, "ana@demo.mx", true)
	// Mismo huso que el servicio (cfg.Timezone): entre las 18:00 y las 24:00 (hora de México)
	// el día en UTC ya es el siguiente y el plan «de hoy» dejaba de ser el vigente.
	mx, _ := time.LoadLocation("America/Mexico_City")
	today := time.Now().In(mx).Format("2006-01-02")
	in := func(d int) string { return time.Now().In(mx).AddDate(0, 0, d).Format("2006-01-02") }

	t.Run("crear exige consentimiento y valida fechas", func(t *testing.T) {
		locked := newPatient(t, e, nutri, "lock@demo.mx", false)
		code, b := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": locked, "name": "X", "start_date": in(1), "end_date": in(7)})
		require.Equal(t, 423, code)
		require.Equal(t, "consent_pending", testsupport.ErrCode(b))
		for name, body := range map[string]map[string]any{
			"fin antes del inicio": {"patient_id": pa, "name": "X", "start_date": in(7), "end_date": in(1)},
			"más de 120 días":      {"patient_id": pa, "name": "X", "start_date": in(1), "end_date": in(200)},
			"sin nombre":           {"patient_id": pa, "name": " ", "start_date": in(1), "end_date": in(7)},
			"paciente inexistente": {"patient_id": uuid.NewString(), "name": "X", "start_date": in(1), "end_date": in(7)},
			"fecha mal formada":    {"patient_id": pa, "name": "X", "start_date": "10/11/2026", "end_date": in(7)},
		} {
			code, b := nutri.Do("POST", "/api/v1/plans", body)
			require.Equal(t, 422, code, name+" "+fmt.Sprint(b))
		}
		v := createPlan(t, nutri, pa, "Semana 1", in(1), in(7))
		require.Equal(t, "draft", v["status"])
		require.Len(t, v["days"], 7)
		require.Len(t, v["days"].([]any)[0].(map[string]any)["slots"], 5, "tiempos de comida predeterminados")
		require.EqualValues(t, 1, v["revision"])
	})

	t.Run("guardar: totales con política decimal, orden persistente y quitar es lógico", func(t *testing.T) {
		v := createPlan(t, nutri, pa, "Semana totales", in(10), in(12))
		id := v["id"].(string)
		d := docOf(v)
		s0 := d["days"].([]any)[0].(map[string]any)["slots"].([]any)
		it1, it2, it3 := uuid.NewString(), uuid.NewString(), uuid.NewString()
		s0[2].(map[string]any)["items"] = []any{item(it1, pollo, 1, "1.5"), item(it2, arroz, 1, "1"), item(it3, atun, 1, "1")}
		code, saved := save(t, nutri, id, 1, d)
		require.Equal(t, 200, code, fmt.Sprint(saved))
		require.EqualValues(t, 2, saved["revision"])

		slot := firstSlot(saved, 0, 2)
		items := slot["items"].([]any)
		require.Len(t, items, 3)
		require.Equal(t, it1, items[0].(map[string]any)["id"], "el orden y los ids se conservan")
		require.Equal(t, "Pollo", items[0].(map[string]any)["dish_name"])
		require.Equal(t, "247.5", fmt.Sprint(items[0].(map[string]any)["totals"].(map[string]any)["nutrients"].(map[string]any)["energy_kcal"]), "165 × 1.5")
		require.Equal(t, "617.9", fmt.Sprint(saved["days"].([]any)[0].(map[string]any)["totals"].(map[string]any)["nutrients"].(map[string]any)["energy_kcal"]), "247.5 + 208 + 162.4")
		eq := saved["days"].([]any)[0].(map[string]any)["totals"].(map[string]any)["equivalents"].(map[string]any)
		require.Contains(t, eq, "AOA-MB")
		require.Contains(t, eq, "CER-SG")

		// Reordenar y quitar un platillo omitiéndolo.
		d2 := docOf(saved)
		its := d2["days"].([]any)[0].(map[string]any)["slots"].([]any)[2].(map[string]any)["items"].([]any)
		d2["days"].([]any)[0].(map[string]any)["slots"].([]any)[2].(map[string]any)["items"] = []any{its[2], its[0]}
		code, saved2 := save(t, nutri, id, 2, d2)
		require.Equal(t, 200, code)
		got := firstSlot(saved2, 0, 2)["items"].([]any)
		require.Equal(t, it3, got[0].(map[string]any)["id"])
		require.Equal(t, it1, got[1].(map[string]any)["id"])
		var removed int
		require.NoError(t, e.pool.QueryRow(ctx, `SELECT count(*) FROM meal_slot_items WHERE id = $1 AND removed_at IS NOT NULL`, it2).Scan(&removed))
		require.Equal(t, 1, removed, "quitar un platillo es lógico: el historial de seguimiento no se rompe")

		// Extender el periodo con un día nuevo y acortarlo.
		d3 := docOf(saved2)
		d3["days"] = append(d3["days"].([]any), day(in(13)))
		code, saved3 := save(t, nutri, id, 3, d3)
		require.Equal(t, 200, code, fmt.Sprint(saved3))
		require.Equal(t, in(13), saved3["end_date"])
		require.Len(t, saved3["days"], 4)
	})

	t.Run("concurrencia: un guardado con revisión vieja devuelve 409 con la versión vigente", func(t *testing.T) {
		v := createPlan(t, nutri, pa, "Concurrente", in(20), in(21))
		id := v["id"].(string)
		other := e.login(t, "otra@demo.mx", "nutritionist")
		a, b := docOf(v), docOf(v)
		a["name"], b["name"] = "Edición de A", "Edición de B"
		code, _ := save(t, nutri, id, 1, a)
		require.Equal(t, 200, code)
		code, body := save(t, other, id, 1, b)
		require.Equal(t, 409, code)
		require.Equal(t, "conflict", testsupport.ErrCode(body))
		cur := body["current"].(map[string]any)
		require.Equal(t, "Edición de A", cur["name"], "el conflicto trae lo vigente para decidir")
		require.EqualValues(t, 2, cur["revision"])
		code, _ = save(t, other, id, 2, b)
		require.Equal(t, 200, code, "tras resolver, se guarda sobre la revisión vigente")
		_, final := nutri.Do("GET", "/api/v1/plans/"+id, nil)
		require.Equal(t, "Edición de B", final["name"])
	})

	t.Run("concurrencia real: de varios guardados simultáneos solo uno gana por revisión", func(t *testing.T) {
		v := createPlan(t, nutri, pa, "Carrera", in(30), in(30))
		id := v["id"].(string)
		var wg sync.WaitGroup
		results := make([]int, 6)
		for i := range results {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				c := testsupport.NewClient(t, e.srv.URL)
				c.Login("nutri@demo.mx", "demo1234")
				d := docOf(v)
				d["name"] = fmt.Sprintf("Intento %d", i)
				results[i], _ = save(t, c, id, 1, d)
			}(i)
		}
		wg.Wait()
		wins, conflicts := 0, 0
		for _, r := range results {
			switch r {
			case 200:
				wins++
			case 409:
				conflicts++
			}
		}
		require.Equal(t, 1, wins, fmt.Sprint(results))
		require.Equal(t, 5, conflicts)
	})

	t.Run("validación del documento", func(t *testing.T) {
		v := createPlan(t, nutri, pa, "Validar", in(40), in(41))
		id := v["id"].(string)
		base := func() map[string]any { return docOf(v) }
		mut := map[string]func(d map[string]any){
			"fecha repetida": func(d map[string]any) {
				ds := d["days"].([]any)
				ds[1].(map[string]any)["date"] = ds[0].(map[string]any)["date"]
			},
			"tiempo repetido": func(d map[string]any) {
				s := d["days"].([]any)[0].(map[string]any)["slots"].([]any)
				s[1].(map[string]any)["name"] = "Desayuno"
			},
			"porciones cero": func(d map[string]any) {
				d["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{item(uuid.NewString(), pollo, 1, "0")}
			},
			"versión inexistente": func(d map[string]any) {
				d["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{item(uuid.NewString(), pollo, 99, "1")}
			},
			"sin días": func(d map[string]any) { d["days"] = []any{} },
			"objetivo negativo": func(d map[string]any) {
				tg := d["targets"].(map[string]any)
				tg["energy_kcal"] = "-1"
			},
		}
		for name, f := range mut {
			d := base()
			f(d)
			code, b := save(t, nutri, id, 1, d)
			require.Equal(t, 422, code, name+" "+fmt.Sprint(b))
		}
		code, _ := save(t, nutri, id, 0, base())
		require.Equal(t, 422, code, "se exige la revisión esperada")

		// Un elemento que pertenece a otro plan se rechaza (no se pueden "robar" ids).
		other := createPlan(t, nutri, pa, "Otro", in(50), in(50))
		od := docOf(other)
		foreign := uuid.NewString()
		od["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{item(foreign, pollo, 1, "1")}
		code, saved := save(t, nutri, other["id"].(string), 1, od)
		require.Equal(t, 200, code, fmt.Sprint(saved))
		d := base()
		d["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{item(foreign, pollo, 1, "1")}
		code, b := save(t, nutri, id, 1, d)
		require.Equal(t, 422, code, fmt.Sprint(b))
	})

	t.Run("ciclo de vida: publicar, editar publicado, borrador, finalizar, solo lectura y archivo", func(t *testing.T) {
		v := createPlan(t, nutri, pa, "Ciclo", in(60), in(61))
		id := v["id"].(string)
		code, b := nutri.Do("POST", "/api/v1/plans/"+id+"/publish", map[string]any{"summary": "x"})
		require.Equal(t, 422, code)
		require.Equal(t, "empty_plan", testsupport.ErrCode(b), "no se publica un plan vacío")

		d := docOf(v)
		itemID := uuid.NewString()
		d["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{item(itemID, pollo, 1, "1")}
		_, s1 := save(t, nutri, id, 1, d)
		code, pub := nutri.Do("POST", "/api/v1/plans/"+id+"/publish", map[string]any{"summary": "Plan de la semana 1"})
		require.Equal(t, 200, code, fmt.Sprint(pub))
		require.Equal(t, "published", pub["status"])
		code, _ = nutri.Do("POST", "/api/v1/plans/"+id+"/publish", nil)
		require.Equal(t, 409, code, "publicar dos veces no es una transición válida")

		// Editar un plan publicado deja revisiones inmutables de lo visible.
		d2 := docOf(pub)
		d2["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{item(itemID, pollo, 1, "2")}
		code, s2 := save(t, nutri, id, int(pub["revision"].(float64)), d2)
		require.Equal(t, 200, code, fmt.Sprint(s2))
		_, h := nutri.Do("GET", "/api/v1/plans/"+id+"/history", nil)
		require.Len(t, h["publications"], 1)
		require.GreaterOrEqual(t, len(h["revisions"].([]any)), 2)
		_, err := e.pool.Exec(ctx, `UPDATE meal_plan_revisions SET snapshot = '{}'::jsonb`)
		require.ErrorContains(t, err, "solo insercion")
		_, err = e.pool.Exec(ctx, `DELETE FROM meal_plan_publications`)
		require.ErrorContains(t, err, "solo insercion")

		// Reconstrucción exacta de lo que vio la paciente antes de la edición.
		pubRev := int(h["publications"].([]any)[0].(map[string]any)["revision"].(float64))
		code, rv := nutri.Do("GET", fmt.Sprintf("/api/v1/plans/%s/revisions/%d", id, pubRev), nil)
		require.Equal(t, 200, code, fmt.Sprint(rv))
		old := rv["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"].([]any)[0].(map[string]any)
		require.Equal(t, "1", fmt.Sprint(old["servings"]), "la revisión conserva las porciones de entonces")
		_ = s1

		code, ub := nutri.Do("POST", "/api/v1/plans/"+id+"/unpublish", nil)
		require.Equal(t, 200, code)
		require.Equal(t, "draft", ub["status"])
		nutri.Do("POST", "/api/v1/plans/"+id+"/publish", nil)
		code, fin := nutri.Do("POST", "/api/v1/plans/"+id+"/finalize", nil)
		require.Equal(t, 200, code)
		require.Equal(t, true, fin["read_only"])
		code, b = save(t, nutri, id, int(fin["revision"].(float64)), docOf(fin))
		require.Equal(t, 409, code)
		require.Equal(t, "plan_readonly", testsupport.ErrCode(b))
		code, _ = nutri.Do("DELETE", "/api/v1/plans/"+id, nil)
		require.Equal(t, 409, code, "solo se eliminan borradores")
		code, _ = nutri.Do("POST", "/api/v1/plans/"+id+"/archive", nil)
		require.Equal(t, 200, code)
		code, r := nutri.Do("POST", "/api/v1/plans/"+id+"/restore", nil)
		require.Equal(t, 200, code)
		require.Equal(t, "finished", r["status"])

		dv := createPlan(t, nutri, pa, "Borrador desechable", in(70), in(70))
		code, _ = nutri.Do("DELETE", "/api/v1/plans/"+dv["id"].(string), nil)
		require.Equal(t, 204, code)
		code, _ = nutri.Do("GET", "/api/v1/plans/"+dv["id"].(string), nil)
		require.Equal(t, 404, code)
		var kept int
		require.NoError(t, e.pool.QueryRow(ctx, `SELECT count(*) FROM meal_plans WHERE id = $1 AND deleted_at IS NOT NULL`, dv["id"]).Scan(&kept))
		require.Equal(t, 1, kept, "eliminación lógica")
	})

	t.Run("al terminar el periodo el plan pasa a finalizado automáticamente", func(t *testing.T) {
		v := createPlan(t, nutri, pa, "Pasado", in(-5), in(-3))
		id := v["id"].(string)
		d := docOf(v)
		d["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{item(uuid.NewString(), pollo, 1, "1")}
		save(t, nutri, id, 1, d)
		code, _ := nutri.Do("POST", "/api/v1/plans/"+id+"/publish", nil)
		require.Equal(t, 200, code)
		_, got := nutri.Do("GET", "/api/v1/plans/"+id, nil)
		require.Equal(t, "finished", got["status"])
		_, h := nutri.Do("GET", "/api/v1/plans/"+id+"/history", nil)
		found := false
		for _, ev := range h["events"].([]any) {
			if ev.(map[string]any)["type"] == "finished" {
				found = true
			}
		}
		require.True(t, found)
	})

	t.Run("sustitución en plan publicado: cambia al instante y conserva historial", func(t *testing.T) {
		v := createPlan(t, nutri, pa, "Sustituir", in(80), in(80))
		id := v["id"].(string)
		d := docOf(v)
		old := uuid.NewString()
		d["days"].([]any)[0].(map[string]any)["slots"].([]any)[2].(map[string]any)["items"] = []any{item(old, pollo, 1, "1")}
		save(t, nutri, id, 1, d)
		nutri.Do("POST", "/api/v1/plans/"+id+"/publish", nil)
		_, cur := nutri.Do("GET", "/api/v1/plans/"+id, nil)

		code, sub := nutri.Do("POST", "/api/v1/plans/"+id+"/substitute", map[string]any{"item_id": old, "dish_id": atun, "reason": "No hay pollo"})
		require.Equal(t, 200, code, fmt.Sprint(sub))
		it := firstSlot(sub, 0, 2)["items"].([]any)[0].(map[string]any)
		require.Equal(t, "Atún", it["dish_name"])
		require.NotEqual(t, old, it["id"], "el elemento nuevo conserva el historial del anterior")
		require.Greater(t, sub["revision"], cur["revision"])
		var removed int
		require.NoError(t, e.pool.QueryRow(ctx, `SELECT count(*) FROM meal_slot_items WHERE id = $1 AND removed_at IS NOT NULL`, old).Scan(&removed))
		require.Equal(t, 1, removed)
		_, h := nutri.Do("GET", "/api/v1/plans/"+id+"/history", nil)
		first := h["events"].([]any)[0].(map[string]any)
		require.Equal(t, "substitution", first["type"])
		require.Contains(t, first["summary"], "Pollo v1 → Atún v1")
		require.Contains(t, first["summary"], "No hay pollo")

		code, _ = nutri.Do("POST", "/api/v1/plans/"+id+"/substitute", map[string]any{"item_id": uuid.NewString(), "dish_id": atun})
		require.Equal(t, 404, code)
		code, _ = nutri.Do("POST", "/api/v1/plans/"+id+"/substitute", map[string]any{"item_id": it["id"], "dish_id": uuid.NewString()})
		require.Equal(t, 422, code)
	})

	t.Run("plantillas y copias son independientes del origen", func(t *testing.T) {
		v := createPlan(t, nutri, pa, "Origen", in(90), in(92))
		id := v["id"].(string)
		d := docOf(v)
		d["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{item(uuid.NewString(), pollo, 1, "1")}
		d["days"].([]any)[1].(map[string]any)["slots"].([]any)[2].(map[string]any)["items"] = []any{item(uuid.NewString(), arroz, 1, "2")}
		_, src := save(t, nutri, id, 1, d)

		code, tpl := nutri.Do("POST", "/api/v1/plans/"+id+"/template", map[string]any{"name": "Mi semana", "scope": "global", "from_date": in(90), "to_date": in(91)})
		require.Equal(t, 201, code, fmt.Sprint(tpl))
		require.EqualValues(t, 2, tpl["days"])
		code, _ = nutri.Do("POST", "/api/v1/plans/"+id+"/template", map[string]any{"name": "", "scope": "global", "from_date": in(90), "to_date": in(91)})
		require.Equal(t, 422, code)
		code, _ = nutri.Do("POST", "/api/v1/plans/"+id+"/template", map[string]any{"name": "Fuera", "scope": "global", "from_date": in(300), "to_date": in(301)})
		require.Equal(t, 422, code, "el rango debe contener días del plan")

		code, fromTpl := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "Desde plantilla", "start_date": in(100), "end_date": in(102), "template_id": tpl["id"]})
		require.Equal(t, 201, code, fmt.Sprint(fromTpl))
		require.Len(t, firstSlot(fromTpl, 0, 0)["items"], 1)
		require.Len(t, firstSlot(fromTpl, 1, 2)["items"], 1)
		require.Len(t, firstSlot(fromTpl, 2, 0)["items"], 1, "la plantilla de 2 días se repite cíclicamente")
		require.NotEqual(t, firstSlot(src, 0, 0)["items"].([]any)[0].(map[string]any)["id"], firstSlot(fromTpl, 0, 0)["items"].([]any)[0].(map[string]any)["id"], "ids nuevos: copia independiente")

		// Editar el plan de origen no cambia el creado desde la plantilla, ni borrar la plantilla lo afecta.
		d2 := docOf(src)
		d2["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{}
		save(t, nutri, id, int(src["revision"].(float64)), d2)
		code, _ = nutri.Do("DELETE", "/api/v1/plan-templates/"+tpl["id"].(string), nil)
		require.Equal(t, 204, code)
		_, again := nutri.Do("GET", "/api/v1/plans/"+fromTpl["id"].(string), nil)
		require.Len(t, firstSlot(again, 0, 0)["items"], 1)
		code, _ = nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "X", "start_date": in(100), "end_date": in(101), "template_id": tpl["id"]})
		require.Equal(t, 422, code, "una plantilla eliminada ya no se puede usar")

		// Duplicar un plan (el "siguiente periodo"): copia con fechas desplazadas.
		code, cp := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "Siguiente", "start_date": in(110), "end_date": in(112), "copy_from_plan_id": fromTpl["id"]})
		require.Equal(t, 201, code, fmt.Sprint(cp))
		require.Len(t, firstSlot(cp, 0, 0)["items"], 1)
		require.Equal(t, in(110), cp["days"].([]any)[0].(map[string]any)["date"])
		_, h := nutri.Do("GET", "/api/v1/plans/"+cp["id"].(string)+"/history", nil)
		require.Equal(t, "duplicated", h["events"].([]any)[0].(map[string]any)["type"])

		// Una plantilla específica de otro paciente no se puede usar.
		pb := newPatient(t, e, nutri, "bea@demo.mx", true)
		code, ptpl := nutri.Do("POST", "/api/v1/plans/"+id+"/template", map[string]any{"name": "Solo Ana", "scope": "patient", "from_date": in(90), "to_date": in(91)})
		require.Equal(t, 201, code)
		code, _ = nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pb, "name": "X", "start_date": in(100), "end_date": in(101), "template_id": ptpl["id"]})
		require.Equal(t, 422, code)
		_, tl := nutri.Do("GET", "/api/v1/plan-templates?patient_id="+pb, nil)
		for _, x := range tl["items"].([]any) {
			require.NotEqual(t, "Solo Ana", x.(map[string]any)["name"])
		}
	})

	t.Run("listado con filtros y paginación", func(t *testing.T) {
		_, all := nutri.Do("GET", "/api/v1/plans?page_size=2", nil)
		require.Len(t, all["items"], 2)
		require.Greater(t, all["total"], float64(2))
		_, f := nutri.Do("GET", "/api/v1/plans?status=draft&search=intento", nil)
		require.EqualValues(t, 1, f["total"])
		_, f = nutri.Do("GET", "/api/v1/plans?patient_id="+uuid.NewString(), nil)
		require.EqualValues(t, 0, f["total"])
		_, f = nutri.Do("GET", "/api/v1/plans?from="+in(95)+"&to="+in(99), nil)
		for _, x := range f["items"].([]any) {
			require.LessOrEqual(t, x.(map[string]any)["start_date"], in(99))
		}
	})

	t.Run("la paciente solo ve SU plan publicado y los platillos de ese plan", func(t *testing.T) {
		pc := linkAccount(t, e, pa, "ana.login@demo.mx")
		pbID := newPatient(t, e, nutri, "carla@demo.mx", true)
		other := linkAccount(t, e, pbID, "carla.login@demo.mx")

		code, _ := pc.Do("GET", "/api/v1/me/plan", nil)
		require.Equal(t, 200, code, "sin plan dentro de su periodo se muestra el publicado más reciente")

		v := createPlan(t, nutri, pa, "Plan visible", today, in(2))
		id := v["id"].(string)
		d := docOf(v)
		d["days"].([]any)[0].(map[string]any)["slots"].([]any)[0].(map[string]any)["items"] = []any{item(uuid.NewString(), pollo, 1, "1")}
		d["days"].([]any)[0].(map[string]any)["notes"] = "Toma agua"
		save(t, nutri, id, 1, d)
		code, vis := pc.Do("GET", "/api/v1/me/plan", nil)
		require.Equal(t, 200, code)
		require.NotEqual(t, "Plan visible", vis["name"], "un borrador no es visible para la paciente")
		nutri.Do("POST", "/api/v1/plans/"+id+"/publish", nil)

		code, mine := pc.Do("GET", "/api/v1/me/plan", nil)
		require.Equal(t, 200, code, fmt.Sprint(mine))
		require.Equal(t, "Plan visible", mine["name"])
		require.NotContains(t, mine, "targets", "los objetivos internos no se exponen")
		require.Equal(t, "Toma agua", mine["days"].([]any)[0].(map[string]any)["notes"])
		code, _ = other.Do("GET", "/api/v1/me/plan", nil)
		require.Equal(t, 404, code, "otra paciente no ve el plan de Ana")

		code, dish := pc.Do("GET", "/api/v1/me/dishes/"+pollo+"/versions/1", nil)
		require.Equal(t, 200, code, fmt.Sprint(dish))
		require.Equal(t, "Pollo", dish["name"])
		require.NotContains(t, dish, "versions")
		require.NotContains(t, dish, "change_reason")
		code, _ = pc.Do("GET", "/api/v1/me/dishes/"+arroz+"/versions/1", nil)
		require.Equal(t, 404, code, "un platillo que no está en su plan no es visible")
		code, _ = other.Do("GET", "/api/v1/me/dishes/"+pollo+"/versions/1", nil)
		require.Equal(t, 404, code, "otra paciente no puede ver el platillo de Ana")

		// Rutas de la nutrióloga: prohibidas para la paciente.
		for _, path := range []string{"/api/v1/plans", "/api/v1/plans/" + id, "/api/v1/plans/" + id + "/history"} {
			code, b := pc.Do("GET", path, nil)
			require.Equal(t, 403, code, path)
			require.Equal(t, "forbidden", testsupport.ErrCode(b))
		}
		code, _ = pc.Do("PUT", "/api/v1/plans/"+id, map[string]any{"expected_revision": 1})
		require.Equal(t, 403, code)

		// Sin consentimiento completo la paciente no accede a su plan.
		pcID := newPatient(t, e, nutri, "dani@demo.mx", false)
		dani := linkAccount(t, e, pcID, "dani.login@demo.mx")
		code, b := dani.Do("GET", "/api/v1/me/plan", nil)
		require.Equal(t, 423, code, fmt.Sprint(b))

		// Uso del platillo en planes activos.
		_, u := nutri.Do("GET", "/api/v1/dishes/"+pollo+"/usage", nil)
		require.Greater(t, u["plans"], float64(0))
	})

	t.Run("auditoría de planes sin datos personales", func(t *testing.T) {
		rows, err := e.pool.Query(ctx, `SELECT action, metadata::text FROM audit_logs WHERE resource_type IN ('meal_plan','template')`)
		require.NoError(t, err)
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			var a, m string
			require.NoError(t, rows.Scan(&a, &m))
			seen[a] = true
			require.NotContains(t, m, "@demo.mx")
		}
		for _, want := range []string{"plan.create", "plan.save", "plan.publish", "plan.substitution", "plan.finalize", "plan.delete", "template.create"} {
			require.True(t, seen[want], want)
		}
	})
}
