package dishes_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
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
	cat  *smae.Service
	dsh  *dishes.Service
	auth *auth.Service
}

func start(t *testing.T) *env {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute, AppBaseURL: "http://app.test"}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	cat := smae.NewService(pool, log)
	dsh := dishes.NewService(pool, cat, log)
	dsh.SetClinical(ps)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	smae.NewController(cat, as, log).Register(v1)
	dishes.NewController(dsh, as, log).Register(v1)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return &env{pool: pool, srv: srv, cat: cat, dsh: dsh, auth: as}
}

func (e *env) staff(t *testing.T, email string) *testsupport.Client {
	_, err := e.auth.CreateUser(context.Background(), email, "Lic. Prueba", "nutritionist", "demo1234")
	require.NoError(t, err)
	c := testsupport.NewClient(t, e.srv.URL)
	c.Login(email, "demo1234")
	return c
}

// foodID busca un alimento por nombre en el catálogo ACTIVO y devuelve su id.
func foodID(t *testing.T, c *testsupport.Client, q string) string {
	code, b := c.Do("GET", "/api/v1/smae/foods?limit=5&search="+url.QueryEscape(q), nil)
	require.Equal(t, 200, code, fmt.Sprint(b))
	items := b["items"].([]any)
	require.NotEmpty(t, items, q)
	return items[0].(map[string]any)["id"].(string)
}

func ing(kind, id, qty, unit string) map[string]any {
	return map[string]any{"food_kind": kind, "food_id": id, "quantity": qty, "unit": unit}
}

func dishBody(name, category string, servings string, ings ...map[string]any) map[string]any {
	return map[string]any{"name": name, "category": category, "recipe_mode": "structured", "servings": servings, "prep_time_minutes": 20,
		"description": "d", "steps": []string{"uno", " ", "dos"}, "tags": []string{"x"}, "ingredients": ings}
}

func str(m map[string]any, path ...string) string {
	var cur any = m
	for _, p := range path {
		cur = cur.(map[string]any)[p]
	}
	return fmt.Sprint(cur)
}

func TestSmaeAndDishesIntegration(t *testing.T) {
	e := start(t)
	ctx := context.Background()
	rep, err := e.cat.ImportEdition(ctx, smae.Actor{}, sample.Catalog())
	require.NoError(t, err)
	_, err = e.dsh.ActivateEdition(ctx, dishes.Actor{}, rep.Edition.ID)
	require.NoError(t, err)
	nutri := e.staff(t, "nutri@demo.mx")

	t.Run("catálogo: taxonomía, búsqueda sin acentos, grupos y carga progresiva", func(t *testing.T) {
		code, b := nutri.Do("GET", "/api/v1/smae/taxonomy", nil)
		require.Equal(t, 200, code)
		require.Len(t, b["groups"], 9)
		require.NotEmpty(t, b["subgroups"])

		_, b = nutri.Do("GET", "/api/v1/smae/foods?search=platano", nil)
		require.Equal(t, "Plátano", b["items"].([]any)[0].(map[string]any)["name"], "la búsqueda ignora acentos")

		_, all := nutri.Do("GET", "/api/v1/smae/foods?limit=10", nil)
		require.EqualValues(t, 46, all["total"])
		require.Len(t, all["items"], 10)
		_, p2 := nutri.Do("GET", "/api/v1/smae/foods?limit=10&offset=40", nil)
		require.Len(t, p2["items"], 6, "la última página trae el resto")

		_, tax := nutri.Do("GET", "/api/v1/smae/taxonomy", nil)
		verduras := ""
		for _, g := range tax["groups"].([]any) {
			if g.(map[string]any)["code"] == "VER" {
				verduras = g.(map[string]any)["id"].(string)
			}
		}
		_, v := nutri.Do("GET", "/api/v1/smae/foods?limit=50&group_id="+verduras, nil)
		require.EqualValues(t, 10, v["total"])
		_, o := nutri.Do("GET", "/api/v1/smae/foods?search=%25", nil)
		require.EqualValues(t, 0, o["total"], "% se trata como texto literal")
	})

	t.Run("catálogo: solo la nutrióloga accede", func(t *testing.T) {
		code, _ := testsupport.NewClient(t, e.srv.URL).Do("GET", "/api/v1/smae/foods", nil)
		require.Equal(t, 401, code)
		_, err := e.auth.CreateUser(ctx, "pac@demo.mx", "Pac", "patient", "demo1234")
		require.NoError(t, err)
		p := testsupport.NewClient(t, e.srv.URL)
		p.Login("pac@demo.mx", "demo1234")
		for _, path := range []string{"/api/v1/smae/foods", "/api/v1/dishes", "/api/v1/custom-foods", "/api/v1/smae/editions"} {
			code, b := p.Do("GET", path, nil)
			require.Equal(t, 403, code, path)
			require.Equal(t, "forbidden", testsupport.ErrCode(b))
		}
	})

	t.Run("importación: valida y deja lotes trazables, incluso los rechazados", func(t *testing.T) {
		bad := sample.Catalog()
		bad.Name = "Edición con errores"
		bad.Foods = append(bad.Foods, bad.Foods[0])                                                // código duplicado
		bad.Foods[1].SubgroupCode = "NO-EXISTE"                                                    // subgrupo inexistente
		bad.Foods[2].EnergyKcal = "-5"                                                             // negativo
		bad.Foods[3].Portions = []smae.ImportPortion{{Name: "x", Unit: "g", GramsEquivalent: "5"}} // unidad reservada
		code, b := nutri.Do("POST", "/api/v1/smae/editions", bad)
		require.Equal(t, 422, code, fmt.Sprint(b))
		require.GreaterOrEqual(t, len(testsupport.ErrFields(b)), 4)
		var rejected int
		require.NoError(t, e.pool.QueryRow(ctx, `SELECT count(*) FROM smae_import_batches WHERE status='rejected'`).Scan(&rejected))
		require.Equal(t, 1, rejected)
		var eds int
		require.NoError(t, e.pool.QueryRow(ctx, `SELECT count(*) FROM smae_editions WHERE name='Edición con errores'`).Scan(&eds))
		require.Zero(t, eds, "una importación rechazada no deja edición a medias")

		var checksum string
		require.NoError(t, e.pool.QueryRow(ctx, `SELECT checksum FROM smae_import_batches WHERE status='ok' LIMIT 1`).Scan(&checksum))
		require.Len(t, checksum, 64)
	})

	t.Run("alimentos personalizados: sin equivalencia oficial salvo asignación expresa y registrada", func(t *testing.T) {
		body := map[string]any{"name": "Barra proteica", "brand": "Marca X", "basis_quantity": "100", "energy_kcal": "380", "protein_g": "33", "carbohydrates_g": "35", "lipids_g": "12",
			"source_type": "label", "source_reference": "Etiqueta 2026", "portions": []map[string]any{{"name": "Barra", "unit": "pieza", "quantity": "1", "grams_equivalent": "45"}}}
		code, f := nutri.Do("POST", "/api/v1/custom-foods", body)
		require.Equal(t, 201, code, fmt.Sprint(f))
		require.Equal(t, false, f["official"])
		require.Nil(t, f["equivalence"], "no se presenta como equivalente oficial")
		id := f["id"].(string)

		code, bad := nutri.Do("POST", "/api/v1/custom-foods", map[string]any{"name": "", "basis_quantity": "0", "source_type": "rumor"})
		require.Equal(t, 422, code)
		require.Contains(t, testsupport.ErrFields(bad), "name")
		require.Contains(t, testsupport.ErrFields(bad), "source_type")

		code, _ = nutri.Do("POST", "/api/v1/custom-foods/"+id+"/equivalence", map[string]any{"subgroup_code": "CER-SG", "reference_grams": "40", "criterion": "corto"})
		require.Equal(t, 422, code, "el criterio es obligatorio")
		code, _ = nutri.Do("POST", "/api/v1/custom-foods/"+id+"/equivalence", map[string]any{"subgroup_code": "XXX", "reference_grams": "40", "criterion": "Equivalente por aporte de carbohidratos"})
		require.Equal(t, 422, code, "el subgrupo debe existir")
		code, _ = nutri.Do("POST", "/api/v1/custom-foods/"+id+"/equivalence", map[string]any{"subgroup_code": "CER-SG", "reference_grams": "40", "criterion": "Equivalente por aporte de carbohidratos y energía"})
		require.Equal(t, 204, code)
		code, _ = nutri.Do("POST", "/api/v1/custom-foods/"+id+"/validate", nil)
		require.Equal(t, 204, code)

		_, got := nutri.Do("GET", "/api/v1/smae/foods/custom/"+id, nil)
		require.Equal(t, "CER-SG", str(got, "equivalence", "subgroup_code"))
		require.NotEmpty(t, got["validated_at"])

		body["energy_kcal"] = "400"
		code, up := nutri.Do("PUT", "/api/v1/custom-foods/"+id, body)
		require.Equal(t, 200, code, fmt.Sprint(up))
		require.Nil(t, up["validated_at"], "editar los valores invalida la validación")
		require.Equal(t, "CER-SG", str(up, "equivalence", "subgroup_code"), "la equivalencia asignada se conserva")

		var by int
		require.NoError(t, e.pool.QueryRow(ctx, `SELECT count(*) FROM custom_foods WHERE id=$1 AND eq_assigned_by IS NOT NULL AND eq_assigned_at IS NOT NULL AND eq_criterion IS NOT NULL`, id).Scan(&by))
		require.Equal(t, 1, by, "queda registrado quién, cuándo y con qué criterio")

		code, _ = nutri.Do("POST", "/api/v1/custom-foods/"+id+"/active", map[string]any{"active": false})
		require.Equal(t, 204, code)
		_, s := nutri.Do("GET", "/api/v1/smae/foods?search=barra&source=custom", nil)
		require.EqualValues(t, 0, s["total"], "un alimento inactivo no aparece en la búsqueda")
	})

	pollo := foodID(t, nutri, "pechuga")
	arroz := foodID(t, nutri, "arroz")

	t.Run("platillos: el servidor calcula con la política decimal y rechaza datos inválidos", func(t *testing.T) {
		code, d := nutri.Do("POST", "/api/v1/dishes", dishBody("Pollo con arroz", "Comida", "2", ing("smae", pollo, "120", "g"), ing("smae", arroz, "1", "taza")))
		require.Equal(t, 201, code, fmt.Sprint(d))
		require.EqualValues(t, 1, d["current_version"])
		n := d["version"].(map[string]any)["nutrition"].(map[string]any)
		require.Equal(t, "406", str(n, "totals", "energy_kcal"), "120 g de pollo (198) + 160 g de arroz (208)")
		require.Equal(t, "203", str(n, "per_serving", "energy_kcal"))
		require.Equal(t, "41.52", str(n, "totals", "protein_g"))
		eq := n["equivalents"].(map[string]any)
		require.Equal(t, "2", str(map[string]any{"v": eq["AOA-MB"]}, "v"), "4 equivalentes entre 2 porciones")
		require.True(t, strings.HasPrefix(fmt.Sprint(eq["CER-SG"]), "1.48148148148148"), fmt.Sprint(eq["CER-SG"]))
		require.Equal(t, "0.1.0", str(n, "engine_version"))
		steps := d["version"].(map[string]any)["steps"].([]any)
		require.Len(t, steps, 2, "se descartan los pasos vacíos")

		for name, body := range map[string]map[string]any{
			"ml sin densidad":    dishBody("X", "Comida", "1", ing("smae", pollo, "100", "ml")),
			"unidad inexistente": dishBody("X", "Comida", "1", ing("smae", pollo, "1", "taza")),
			"porciones cero":     dishBody("X", "Comida", "0", ing("smae", pollo, "100", "g")),
			"sin ingredientes":   dishBody("X", "Comida", "1"),
			"sin nombre":         dishBody("", "Comida", "1", ing("smae", pollo, "100", "g")),
			"alimento falso":     dishBody("X", "Comida", "1", ing("smae", uuid.NewString(), "100", "g")),
		} {
			code, b := nutri.Do("POST", "/api/v1/dishes", body)
			require.Equal(t, 422, code, name+" "+fmt.Sprint(b))
		}
		// Los resultados que envíe el cliente se ignoran: no hay campos de cálculo en la entrada.
		body := dishBody("Con trampa", "Comida", "1", ing("smae", pollo, "100", "g"))
		body["nutrition"] = map[string]any{"per_serving": map[string]any{"energy_kcal": "1"}}
		_, d2 := nutri.Do("POST", "/api/v1/dishes", body)
		require.Equal(t, "165", str(d2, "version", "nutrition", "per_serving", "energy_kcal"))
	})

	t.Run("versiones inmutables: cada cambio crea una nueva y las anteriores no se alteran", func(t *testing.T) {
		_, d := nutri.Do("POST", "/api/v1/dishes", dishBody("Versionado", "Comida", "1", ing("smae", pollo, "100", "g")))
		id := d["id"].(string)
		body := dishBody("Versionado", "Comida", "1", ing("smae", pollo, "200", "g"))
		code, b := nutri.Do("POST", "/api/v1/dishes/"+id+"/versions", body)
		require.Equal(t, 422, code, "sin motivo no se crea versión")
		require.Contains(t, testsupport.ErrFields(b), "change_reason")

		body["change_reason"] = "Más porción de proteína"
		code, v2 := nutri.Do("POST", "/api/v1/dishes/"+id+"/versions", body)
		require.Equal(t, 201, code, fmt.Sprint(v2))
		require.EqualValues(t, 2, v2["current_version"])
		require.Equal(t, "330", str(v2, "version", "nutrition", "per_serving", "energy_kcal"))
		require.Len(t, v2["versions"], 2)

		_, v1 := nutri.Do("GET", "/api/v1/dishes/"+id+"?version=1", nil)
		require.Equal(t, "165", str(v1, "version", "nutrition", "per_serving", "energy_kcal"), "la versión 1 conserva su cálculo")
		require.Equal(t, "Versión inicial", str(v1, "version", "change_reason"))

		for _, q := range []string{
			`UPDATE dish_versions SET servings = 9`, `DELETE FROM dish_versions`, `UPDATE dish_ingredients SET grams = 1`,
			`DELETE FROM dish_ingredients`, `UPDATE dish_nutrition_snapshots SET serving_energy = 1`, `DELETE FROM dish_nutrition_snapshots`,
		} {
			_, err := e.pool.Exec(ctx, q)
			require.ErrorContains(t, err, "solo insercion", q)
		}
		code, _ = nutri.Do("GET", "/api/v1/dishes/"+id+"?version=99", nil)
		require.Equal(t, 404, code)
	})

	t.Run("listado: filtros, búsqueda por ingrediente, equivalentes y carga progresiva", func(t *testing.T) {
		nutri.Do("POST", "/api/v1/dishes", dishBody("Ensalada de atún", "Comida", "1", ing("smae", foodID(t, nutri, "atun"), "1", "lata")))
		nutri.Do("POST", "/api/v1/dishes", dishBody("Fruta picada", "Colación", "1", ing("smae", foodID(t, nutri, "papaya"), "1", "taza")))
		_, b := nutri.Do("GET", "/api/v1/dishes?search=atun", nil)
		require.EqualValues(t, 1, b["total"], "busca por nombre o ingrediente, sin acentos")
		_, b = nutri.Do("GET", "/api/v1/dishes?search=papaya", nil)
		require.EqualValues(t, 1, b["total"], "también por ingrediente")
		_, b = nutri.Do("GET", "/api/v1/dishes?category=Colaci%C3%B3n", nil)
		require.EqualValues(t, 1, b["total"])
		_, b = nutri.Do("GET", "/api/v1/dishes?subgroup_code=FRU", nil)
		require.EqualValues(t, 1, b["total"], "filtra por grupo SMAE usando los equivalentes calculados")
		_, all := nutri.Do("GET", "/api/v1/dishes?limit=2", nil)
		require.Len(t, all["items"], 2)
		require.Greater(t, all["total"].(float64), float64(2))
	})

	t.Run("duplicar copia el cálculo tal cual y desactivar lo oculta de los activos", func(t *testing.T) {
		_, d := nutri.Do("POST", "/api/v1/dishes", dishBody("Original", "Cena", "1", ing("smae", arroz, "1", "taza")))
		id := d["id"].(string)
		code, c := nutri.Do("POST", "/api/v1/dishes/"+id+"/duplicate", nil)
		require.Equal(t, 201, code)
		require.Equal(t, "Copia de Original", c["name"])
		require.EqualValues(t, 1, c["current_version"])
		require.Equal(t, str(d, "version", "nutrition", "per_serving", "energy_kcal"), str(c, "version", "nutrition", "per_serving", "energy_kcal"))
		require.NotEqual(t, id, c["id"])

		code, _ = nutri.Do("POST", "/api/v1/dishes/"+id+"/active", map[string]any{"active": false})
		require.Equal(t, 204, code)
		_, l := nutri.Do("GET", "/api/v1/dishes?status=inactive&search=Original", nil)
		require.EqualValues(t, 1, l["total"])
		_, l = nutri.Do("GET", "/api/v1/dishes?status=active&search=Original", nil)
		require.EqualValues(t, 1, l["total"], "solo queda activa la copia")
	})

	t.Run("sustituciones: sugerencias con alergias del paciente y autorización con diferencia calculada", func(t *testing.T) {
		_, a := nutri.Do("POST", "/api/v1/dishes", dishBody("Pollo al horno", "Sustituibles", "1", ing("smae", pollo, "100", "g")))
		_, b := nutri.Do("POST", "/api/v1/dishes", dishBody("Pescado blanco", "Sustituibles", "1", ing("smae", foodID(t, nutri, "tilapia"), "130", "g")))
		_, _ = nutri.Do("POST", "/api/v1/dishes", dishBody("Pollo guisado", "Sustituibles", "1", ing("smae", pollo, "105", "g")))
		_, far := nutri.Do("POST", "/api/v1/dishes", dishBody("Banquete", "Sustituibles", "1", ing("smae", arroz, "5", "taza")))
		aid := a["id"].(string)

		// Paciente con alergia a "pollo".
		code, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Ana", "last_name": "Alérgica", "birth_date": "1990-01-01", "sex": "F", "email": "ana@demo.mx", "goal": "maintenance"})
		require.Equal(t, 201, code)
		pid := p["id"].(string)
		_, cs := nutri.Do("GET", "/api/v1/patients/"+pid+"/consents", nil)
		var docs []string
		for _, d := range cs["pending"].([]any) {
			docs = append(docs, d.(map[string]any)["id"].(string))
		}
		nutri.Do("POST", "/api/v1/patients/"+pid+"/consents/record", map[string]any{"document_ids": docs})
		code, _ = nutri.Do("POST", "/api/v1/patients/"+pid+"/allergies", map[string]any{"allergen": "Pollo", "severity": "severe"})
		require.Equal(t, 201, code)

		code, cand := nutri.Do("GET", "/api/v1/dishes/"+aid+"/substitute-candidates?patient_id="+pid, nil)
		require.Equal(t, 200, code, fmt.Sprint(cand))
		items := cand["items"].([]any)
		names := map[string][]any{}
		for _, it := range items {
			m := it.(map[string]any)
			names[m["name"].(string)] = m["conflicts"].([]any)
		}
		require.Contains(t, names, "Pescado blanco")
		require.Contains(t, names, "Pollo guisado")
		require.NotContains(t, names, "Banquete", "fuera de ±20 % de energía")
		require.Empty(t, names["Pescado blanco"])
		require.Contains(t, fmt.Sprint(names["Pollo guisado"]), "Alergia: Pollo", "marca el conflicto con la alergia")
		_ = far

		code, sub := nutri.Do("POST", "/api/v1/dishes/"+aid+"/substitutions", map[string]any{"substitute_dish_id": b["id"], "note": "para días de pescado"})
		require.Equal(t, 201, code, fmt.Sprint(sub))
		require.Equal(t, "Pescado blanco", sub["label"])
		diff := sub["diff"].(map[string]any)
		require.Equal(t, "1.4", fmt.Sprint(diff["energy_kcal"]), "tilapia 130 g = 166.4 kcal frente a 165 kcal del pollo")
	})
}

func TestEditionRecalcFlow(t *testing.T) {
	e := start(t)
	ctx := context.Background()
	rep, err := e.cat.ImportEdition(ctx, smae.Actor{}, sample.Catalog())
	require.NoError(t, err)
	_, err = e.dsh.ActivateEdition(ctx, dishes.Actor{}, rep.Edition.ID)
	require.NoError(t, err)
	nutri := e.staff(t, "nutri@demo.mx")

	avena, huevo, pollo := foodID(t, nutri, "avena"), foodID(t, nutri, "huevo entero"), foodID(t, nutri, "pechuga")
	_, dAvena := nutri.Do("POST", "/api/v1/dishes", dishBody("Avena", "Desayuno", "1", ing("smae", avena, "100", "g")))
	_, dHuevo := nutri.Do("POST", "/api/v1/dishes", dishBody("Huevos", "Desayuno", "1", ing("smae", huevo, "2", "pieza")))
	_, dPollo := nutri.Do("POST", "/api/v1/dishes", dishBody("Pollo", "Comida", "1", ing("smae", pollo, "100", "g")))
	oldEnergy := str(dAvena, "version", "nutrition", "per_serving", "energy_kcal")
	require.Equal(t, "389", oldEnergy)

	// Se importa la fe de erratas como BORRADOR: no cambia nada hasta que se autorice.
	code, imp := nutri.Do("POST", "/api/v1/smae/editions", sample.Errata())
	require.Equal(t, 201, code, fmt.Sprint(imp))
	newEd := str(imp, "edition", "id")
	require.Equal(t, "draft", str(imp, "edition", "status"))
	_, cur := nutri.Do("GET", "/api/v1/dishes/"+dAvena["id"].(string), nil)
	require.Equal(t, oldEnergy, str(cur, "version", "nutrition", "per_serving", "energy_kcal"), "importar no modifica platillos")

	t.Run("el impacto lista solo los platillos afectados con sus diferencias", func(t *testing.T) {
		code, b := nutri.Do("GET", "/api/v1/smae/editions/"+newEd+"/impact", nil)
		require.Equal(t, 200, code, fmt.Sprint(b))
		items := b["items"].([]any)
		require.Len(t, items, 2, "avena y huevo cambian; el pollo no")
		by := map[string]map[string]any{}
		for _, it := range items {
			m := it.(map[string]any)
			by[m["name"].(string)] = m
		}
		require.Contains(t, by, "Avena")
		require.Contains(t, by, "Huevos")
		require.NotContains(t, by, "Pollo")
		require.Equal(t, "379", str(by["Avena"], "after", "energy_kcal"))
		require.Equal(t, "-10", str(by["Avena"], "diff", "energy_kcal"))
		require.Equal(t, []any{"Avena en hojuelas"}, by["Avena"]["changed_foods"])
	})

	t.Run("no se puede activar sin decidir el recálculo", func(t *testing.T) {
		code, b := nutri.Do("POST", "/api/v1/smae/editions/"+newEd+"/activate", nil)
		require.Equal(t, 409, code)
		require.Equal(t, "recalc_required", testsupport.ErrCode(b))
	})

	t.Run("las decisiones deben cubrir todos los platillos afectados", func(t *testing.T) {
		code, b := nutri.Do("POST", "/api/v1/smae/editions/"+newEd+"/recalc", map[string]any{"decisions": []map[string]any{{"dish_id": dAvena["id"], "authorize": true}}})
		require.Equal(t, 422, code, fmt.Sprint(b))
		require.Contains(t, testsupport.ErrFields(b), dHuevo["id"].(string))
		code, _ = nutri.Do("POST", "/api/v1/smae/editions/"+newEd+"/recalc", map[string]any{"decisions": []map[string]any{
			{"dish_id": dAvena["id"], "authorize": true}, {"dish_id": dHuevo["id"], "authorize": false}, {"dish_id": dPollo["id"], "authorize": true}}})
		require.Equal(t, 422, code, "un platillo no afectado no puede decidirse")
	})

	t.Run("autorizar crea versión nueva inmutable; rechazar deja todo igual", func(t *testing.T) {
		code, r := nutri.Do("POST", "/api/v1/smae/editions/"+newEd+"/recalc", map[string]any{"decisions": []map[string]any{
			{"dish_id": dAvena["id"], "authorize": true}, {"dish_id": dHuevo["id"], "authorize": false}}})
		require.Equal(t, 200, code, fmt.Sprint(r))
		require.EqualValues(t, 1, r["authorized"])
		require.EqualValues(t, 1, r["rejected"])

		_, a := nutri.Do("GET", "/api/v1/dishes/"+dAvena["id"].(string), nil)
		require.EqualValues(t, 2, a["current_version"])
		require.Equal(t, "379", str(a, "version", "nutrition", "per_serving", "energy_kcal"))
		require.Equal(t, newEd, str(a, "version", "smae_edition_id"))
		require.Contains(t, str(a, "version", "change_reason"), "Recalculado con")
		_, a1 := nutri.Do("GET", "/api/v1/dishes/"+dAvena["id"].(string)+"?version=1", nil)
		require.Equal(t, "389", str(a1, "version", "nutrition", "per_serving", "energy_kcal"), "la versión histórica sigue reproduciendo su cálculo")

		_, h := nutri.Do("GET", "/api/v1/dishes/"+dHuevo["id"].(string), nil)
		require.EqualValues(t, 1, h["current_version"], "el rechazado conserva su versión")

		code, _ = nutri.Do("POST", "/api/v1/smae/editions/"+newEd+"/recalc", map[string]any{"decisions": []map[string]any{}})
		require.Equal(t, 409, code, "las decisiones se registran una sola vez")
	})

	t.Run("activar archiva la anterior y las versiones nuevas usan la edición vigente", func(t *testing.T) {
		code, ed := nutri.Do("POST", "/api/v1/smae/editions/"+newEd+"/activate", nil)
		require.Equal(t, 200, code, fmt.Sprint(ed))
		require.Equal(t, "active", ed["status"])
		code, list := nutri.Do("GET", "/api/v1/smae/editions", nil)
		require.Equal(t, 200, code)
		statuses := map[string]int{}
		for _, it := range list["items"].([]any) {
			statuses[it.(map[string]any)["status"].(string)]++
		}
		require.Equal(t, 1, statuses["active"])
		require.Equal(t, 1, statuses["archived"], "la edición anterior se conserva archivada")

		// El alimento de la edición archivada ya no es válido para platillos nuevos…
		code, b := nutri.Do("POST", "/api/v1/dishes", dishBody("Con alimento viejo", "Cena", "1", ing("smae", avena, "50", "g")))
		require.Equal(t, 422, code, fmt.Sprint(b))
		require.Contains(t, fmt.Sprint(testsupport.ErrFields(b)), "otra edición")
		// …pero el de la edición vigente sí.
		code, _ = nutri.Do("POST", "/api/v1/dishes", dishBody("Con alimento nuevo", "Cena", "1", ing("smae", foodID(t, nutri, "avena"), "50", "g")))
		require.Equal(t, 201, code)

		code, _ = nutri.Do("POST", "/api/v1/smae/editions/"+newEd+"/activate", nil)
		require.Equal(t, 409, code, "una edición ya activa no se reactiva")
	})

	t.Run("auditoría del catálogo y los platillos sin datos personales", func(t *testing.T) {
		rows, err := e.pool.Query(ctx, `SELECT action, metadata::text FROM audit_logs`)
		require.NoError(t, err)
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			var a, m string
			require.NoError(t, rows.Scan(&a, &m))
			seen[a] = true
			require.NotContains(t, m, "@demo.mx")
		}
		for _, want := range []string{"smae.import", "smae.recalc", "smae.activate", "dish.create"} {
			require.True(t, seen[want], want)
		}
	})
}
