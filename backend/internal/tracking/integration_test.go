package tracking_test

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/mealplans"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/settings"
	"github.com/nutri/app-nutricional/backend/internal/smae"
	"github.com/nutri/app-nutricional/backend/internal/smae/sample"
	"github.com/nutri/app-nutricional/backend/internal/storage"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
	"github.com/nutri/app-nutricional/backend/internal/tracking"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }

const tz = "America/Mexico_City"

func photo() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 200, 150))
	for x := 0; x < 200; x++ {
		img.Set(x, x%150, color.RGBA{200, 100, 50, 255})
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func TestTrackingIntegration(t *testing.T) {
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
	store := storage.NewService(pool, storage.NewMemoryStore(), set, ps, "priv", "pub", log)
	trk := tracking.NewService(pool, store, tz, log)

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
	lookup := func(c *gin.Context, uid uuid.UUID) (uuid.UUID, error) {
		p, err := ps.ForUser(c.Request.Context(), uid)
		if err != nil {
			return uuid.Nil, err
		}
		if ok, _ := ps.ConsentComplete(c.Request.Context(), p.ID); !ok {
			return uuid.Nil, tracking.ErrConsentPending
		}
		return p.ID, nil
	}
	storage.NewController(store, as, func(c *gin.Context, uid uuid.UUID) (uuid.UUID, error) {
		p, err := ps.ForUser(c.Request.Context(), uid)
		return p.ID, err
	}, 20<<20, log).Register(v1)
	tracking.NewController(trk, as, lookup, 20<<20, log).Register(v1)
	srv := httptest.NewServer(r)
	defer srv.Close()
	ctx := context.Background()

	rep, err := cat.ImportEdition(ctx, smae.Actor{}, sample.Catalog())
	require.NoError(t, err)
	_, err = dsh.ActivateEdition(ctx, dishes.Actor{}, rep.Edition.ID)
	require.NoError(t, err)

	_, err = as.CreateUser(ctx, "nutri@demo.mx", "Lic. Prueba", "nutritionist", "demo1234")
	require.NoError(t, err)
	nutri := testsupport.NewClient(t, srv.URL)
	nutri.Login("nutri@demo.mx", "demo1234")

	loc, _ := time.LoadLocation(tz)
	now := time.Now().In(loc)
	day := func(n int) string { return now.AddDate(0, 0, n).Format("2006-01-02") }

	_, fb := nutri.Do("GET", "/api/v1/smae/foods?limit=3&search="+url.QueryEscape("pechuga"), nil)
	foodID := fb["items"].([]any)[0].(map[string]any)["id"].(string)
	code, dish := nutri.Do("POST", "/api/v1/dishes", map[string]any{"name": "Pollo", "category": "Comida", "recipe_mode": "structured", "servings": "1", "steps": []string{"a"},
		"ingredients": []map[string]any{{"food_kind": "smae", "food_id": foodID, "quantity": "100", "unit": "g"}}})
	require.Equal(t, 201, code, fmt.Sprint(dish))
	dishID := dish["id"].(string)

	newPatient := func(email string) string {
		_, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Pac", "last_name": email, "birth_date": "1990-01-01", "sex": "F", "email": email, "goal": "maintenance"})
		id := p["id"].(string)
		_, cs := nutri.Do("GET", "/api/v1/patients/"+id+"/consents", nil)
		var ids []string
		for _, d := range cs["pending"].([]any) {
			ids = append(ids, d.(map[string]any)["id"].(string))
		}
		nutri.Do("POST", "/api/v1/patients/"+id+"/consents/record", map[string]any{"document_ids": ids})
		return id
	}
	link := func(pid, email string) *testsupport.Client {
		uid, err := as.CreateUser(ctx, email, "Paciente "+email, "patient", "demo1234")
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `UPDATE patients SET user_id=$1 WHERE id=$2`, uid, pid)
		require.NoError(t, err)
		c := testsupport.NewClient(t, srv.URL)
		c.Login(email, "demo1234")
		return c
	}
	// plan publicado con una comida hoy, otra mañana y una de ayer-no-aplica (el plan inicia hoy)
	publish := func(pid string) (todayItem, futureItem string) {
		code, v := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pid, "name": "Semana", "start_date": day(0), "end_date": day(3)})
		require.Equal(t, 201, code, fmt.Sprint(v))
		days := v["days"].([]any)
		todayItem, futureItem = uuid.NewString(), uuid.NewString()
		mk := func(dayIdx int, itemID string) map[string]any {
			dm := days[dayIdx].(map[string]any)
			slots := []any{}
			for si, s := range dm["slots"].([]any) {
				sm := s.(map[string]any)
				items := []any{}
				if si == 0 {
					items = append(items, map[string]any{"id": itemID, "dish_id": dishID, "dish_version": 1, "servings": "1", "instructions": ""})
				}
				slots = append(slots, map[string]any{"id": sm["id"], "name": sm["name"], "items": items})
			}
			return map[string]any{"date": dm["date"], "notes": "", "slots": slots}
		}
		doc := map[string]any{"expected_revision": 1, "name": "Semana", "targets": v["targets"], "days": []any{mk(0, todayItem), mk(1, futureItem), days[2], days[3]}}
		for i := 2; i <= 3; i++ {
			dm := days[i].(map[string]any)
			slots := []any{}
			for _, s := range dm["slots"].([]any) {
				sm := s.(map[string]any)
				slots = append(slots, map[string]any{"id": sm["id"], "name": sm["name"], "items": []any{}})
			}
			doc["days"].([]any)[i] = map[string]any{"date": dm["date"], "notes": "", "slots": slots}
		}
		code, sv := nutri.Do("PUT", "/api/v1/plans/"+v["id"].(string), doc)
		require.Equal(t, 200, code, fmt.Sprint(sv))
		code, pub := nutri.Do("POST", "/api/v1/plans/"+v["id"].(string)+"/publish", map[string]any{"summary": "x"})
		require.Equal(t, 200, code, fmt.Sprint(pub))
		return
	}

	pa, pb := newPatient("ana@demo.mx"), newPatient("bea@demo.mx")
	ana, bea := link(pa, "ana.login@demo.mx"), link(pb, "bea.login@demo.mx")
	todayA, futureA := publish(pa)
	todayB, _ := publish(pb)
	var entryA string

	t.Run("registrar: queda ligado a la versión del platillo, valida estado y futuro", func(t *testing.T) {
		code, e := ana.Do("PUT", "/api/v1/me/tracking/items/"+todayA, map[string]any{"status": "done", "comment": "Estuvo rico"})
		require.Equal(t, 200, code, fmt.Sprint(e))
		entryA = e["id"].(string)
		require.Equal(t, "done", e["status"])
		require.EqualValues(t, 1, e["dish_version"])
		require.Equal(t, "Pollo", e["dish_name"])
		require.Equal(t, true, e["needs_review"])
		require.Equal(t, "Estuvo rico", e["patient_comment"])

		code, e2 := ana.Do("PUT", "/api/v1/me/tracking/items/"+todayA, map[string]any{"status": "skipped"})
		require.Equal(t, 200, code)
		require.Equal(t, entryA, e2["id"], "cambiar de estado actualiza el mismo registro")
		require.Equal(t, "Estuvo rico", e2["patient_comment"], "sin comentario nuevo se conserva el anterior")

		code, _ = ana.Do("PUT", "/api/v1/me/tracking/items/"+todayA, map[string]any{"status": "quizá"})
		require.Equal(t, 422, code)
		code, b := ana.Do("PUT", "/api/v1/me/tracking/items/"+futureA, map[string]any{"status": "done"})
		require.Equal(t, 422, code, "no se registran comidas futuras "+fmt.Sprint(b))
		code, _ = ana.Do("PUT", "/api/v1/me/tracking/items/"+uuid.NewString(), map[string]any{"status": "done"})
		require.Equal(t, 404, code)
	})

	t.Run("aislamiento: una paciente no toca los registros ni el plan de otra", func(t *testing.T) {
		code, _ := bea.Do("PUT", "/api/v1/me/tracking/items/"+todayA, map[string]any{"status": "done"})
		require.Equal(t, 404, code, "la comida de otra paciente no existe para ella")
		code, _ = bea.Do("POST", "/api/v1/me/tracking/"+entryA+"/comments", map[string]any{"body": "intruso"})
		require.Equal(t, 404, code)
		code, _ = bea.Do("DELETE", "/api/v1/me/tracking/"+entryA, nil)
		require.Equal(t, 404, code)
		code, l := bea.Do("GET", "/api/v1/me/tracking", nil)
		require.Equal(t, 200, code)
		require.Empty(t, l["items"], "no ve registros ajenos")
		code, _ = bea.Do("GET", "/api/v1/tracking", nil)
		require.Equal(t, 403, code, "la bandeja es solo de la nutrióloga")
		_ = todayB
	})

	t.Run("conversación por tiempo de comida y revisión", func(t *testing.T) {
		code, _ := nutri.Do("POST", "/api/v1/tracking/"+entryA+"/comments", map[string]any{"body": "  "})
		require.Equal(t, 422, code)
		code, e := nutri.Do("POST", "/api/v1/tracking/"+entryA+"/comments", map[string]any{"body": "¡Muy bien! Mañana agrega verduras."})
		require.Equal(t, 201, code, fmt.Sprint(e))
		require.Equal(t, false, e["needs_review"], "al responder la nutrióloga se cierra la revisión")
		code, e = ana.Do("POST", "/api/v1/me/tracking/"+entryA+"/comments", map[string]any{"body": "Gracias"})
		require.Equal(t, 201, code)
		require.Equal(t, true, e["needs_review"], "un comentario de la paciente reabre la revisión")
		th := e["thread"].([]any)
		require.Len(t, th, 2)
		require.Equal(t, "nutritionist", th[0].(map[string]any)["author_role"])
		require.Equal(t, "patient", th[1].(map[string]any)["author_role"])
		require.NotEmpty(t, th[0].(map[string]any)["author_name"])

		code, _ = ana.Do("DELETE", "/api/v1/me/tracking/"+entryA, nil)
		require.Equal(t, 422, code, "con conversación ya no se puede quitar el registro")

		code, _ = nutri.Do("POST", "/api/v1/tracking/"+entryA+"/review", nil)
		require.Equal(t, 204, code)
		code, _ = nutri.Do("POST", "/api/v1/tracking/"+uuid.NewString()+"/review", nil)
		require.Equal(t, 404, code)
	})

	t.Run("fotografías: privadas, máximo 3 y visibles solo para su dueña y la nutrióloga", func(t *testing.T) {
		var url string
		for i := 0; i < 3; i++ {
			code, e := ana.Upload("/api/v1/me/tracking/"+entryA+"/photos", "c.png", photo(), map[string]string{"alt": "Mi comida"})
			require.Equal(t, 201, code, fmt.Sprint(e))
			ph := e["photos"].([]any)
			require.Len(t, ph, i+1)
			url = ph[0].(map[string]any)["url"].(string)
		}
		code, b := ana.Upload("/api/v1/me/tracking/"+entryA+"/photos", "c.png", photo(), nil)
		require.Equal(t, 422, code, fmt.Sprint(b))
		code, _ = ana.Upload("/api/v1/me/tracking/"+entryA+"/photos", "x.png", []byte("no soy imagen"), nil)
		require.Equal(t, 422, code)
		code, _ = bea.Upload("/api/v1/me/tracking/"+entryA+"/photos", "c.png", photo(), nil)
		require.Equal(t, 404, code)

		status, ct, _ := ana.GetRaw(url)
		require.Equal(t, 200, status)
		require.Equal(t, "image/jpeg", ct)
		status, _, _ = nutri.GetRaw(url)
		require.Equal(t, 200, status)
		status, _, _ = bea.GetRaw(url)
		require.Equal(t, 404, status, "otra paciente no puede ver la fotografía")

		_, usage := nutri.Do("GET", "/api/v1/patients/"+pa+"/storage", nil)
		require.Greater(t, usage["used_bytes"], float64(0), "las fotos cuentan contra la cuota")
	})

	t.Run("bandeja de la nutrióloga: filtros, búsqueda y paginación en servidor", func(t *testing.T) {
		code, f := ana.Do("PUT", "/api/v1/me/tracking/items/"+todayA, map[string]any{"status": "done"})
		require.Equal(t, 200, code, fmt.Sprint(f))
		code, _ = bea.Do("PUT", "/api/v1/me/tracking/items/"+todayB, map[string]any{"status": "skipped", "comment": "sin hambre"})
		require.Equal(t, 200, code)

		_, all := nutri.Do("GET", "/api/v1/tracking", nil)
		require.EqualValues(t, 2, all["total"])
		require.EqualValues(t, 2, all["pending_review"])
		item := all["items"].([]any)[0].(map[string]any)
		require.NotEmpty(t, item["patient_name"])

		for q, want := range map[string]int{"kind=photos": 1, "kind=skipped": 1, "kind=review": 2, "kind=comments": 2, "search=pollo": 2, "search=SIN+HAMBRE": 1, "search=zzz": 0, "page_size=1": 1} {
			_, b := nutri.Do("GET", "/api/v1/tracking?"+q, nil)
			require.Len(t, b["items"], want, q)
		}
		_, byP := nutri.Do("GET", "/api/v1/tracking?patient_id="+pb, nil)
		require.Len(t, byP["items"], 1)
		code, _ = nutri.Do("GET", "/api/v1/tracking?kind=raro", nil)
		require.Equal(t, 422, code)
		code, _ = nutri.Do("GET", "/api/v1/tracking?from=ayer", nil)
		require.Equal(t, 422, code)
		_, sq := nutri.Do("GET", "/api/v1/tracking?search="+url.QueryEscape("%"), nil)
		require.Empty(t, sq["items"], "los comodines de LIKE no se interpretan")
	})

	t.Run("cumplimiento: realizadas ÷ programadas hasta hoy", func(t *testing.T) {
		code, c := nutri.Do("GET", "/api/v1/patients/"+pa+"/compliance", nil)
		require.Equal(t, 200, code, fmt.Sprint(c))
		require.EqualValues(t, 1, c["planned"], "la comida de mañana todavía no cuenta")
		require.EqualValues(t, 1, c["done"])
		require.EqualValues(t, 100, c["pct"])
		code, c = nutri.Do("GET", "/api/v1/patients/"+pb+"/compliance", nil)
		require.Equal(t, 200, code)
		require.EqualValues(t, 0, c["done"])
		require.EqualValues(t, 1, c["skipped"])
		require.EqualValues(t, 0, c["pct"], "las omitidas no suman")
		days := c["days"].([]any)
		require.Len(t, days, 1)

		code, mine := ana.Do("GET", "/api/v1/me/compliance", nil)
		require.Equal(t, 200, code)
		require.EqualValues(t, 100, mine["pct"])
		code, _ = nutri.Do("GET", "/api/v1/patients/"+pa+"/compliance?from="+day(0)+"&to="+day(-5), nil)
		require.Equal(t, 422, code)
	})

	t.Run("quitar un registro sin actividad y expediente restringido sin consentimientos", func(t *testing.T) {
		pc := newPatient("carla@demo.mx")
		carla := link(pc, "carla.login@demo.mx")
		todayC, _ := publish(pc)
		_, e := carla.Do("PUT", "/api/v1/me/tracking/items/"+todayC, map[string]any{"status": "done"})
		code, _ := carla.Do("DELETE", "/api/v1/me/tracking/"+e["id"].(string), nil)
		require.Equal(t, 204, code)
		_, l := carla.Do("GET", "/api/v1/me/tracking", nil)
		require.Empty(t, l["items"])

		_, err := pool.Exec(ctx, `DELETE FROM consent_acceptances WHERE patient_id=$1`, pc)
		require.NoError(t, err)
		code, b := carla.Do("GET", "/api/v1/me/tracking", nil)
		require.Equal(t, 423, code, fmt.Sprint(b))
		code, _ = carla.Do("PUT", "/api/v1/me/tracking/items/"+todayC, map[string]any{"status": "done"})
		require.Equal(t, 423, code)
	})
}
