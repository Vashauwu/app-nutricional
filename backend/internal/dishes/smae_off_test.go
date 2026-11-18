package dishes_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/smae"
	"github.com/nutri/app-nutricional/backend/internal/smae/sample"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

func customFood(t *testing.T, c *testsupport.Client, name string) string {
	t.Helper()
	code, f := c.Do("POST", "/api/v1/custom-foods", map[string]any{"name": name, "basis_quantity": "100", "energy_kcal": "200", "protein_g": "10", "carbohydrates_g": "20", "lipids_g": "8",
		"source_type": "label", "source_reference": "Etiqueta 2026", "portions": []map[string]any{{"name": "Porción", "unit": "porcion", "quantity": "1", "grams_equivalent": "50"}}})
	require.Equal(t, 201, code, fmt.Sprint(f))
	return f["id"].(string)
}

// Una plataforma recién creada (sin ninguna edición cargada) ya trae la edición base: se pueden crear platillos con
// alimentos propios y asignarles equivalencia sin que exista catálogo oficial.
func TestBaseEditionLetsAccountsWorkWithoutOfficialCatalog(t *testing.T) {
	e := start(t)
	nutri := e.staff(t, "base@demo.mx")

	ed, err := e.cat.ActiveEdition(e.ctx)
	require.NoError(t, err)
	require.Equal(t, int32(0), ed.EditionNumber)
	code, tax := nutri.Do("GET", "/api/v1/smae/taxonomy", nil)
	require.Equal(t, 200, code, fmt.Sprint(tax))
	require.Len(t, tax["groups"], 9)
	require.Len(t, tax["subgroups"], 18)
	var foods int
	require.NoError(t, e.pool.QueryRow(e.ctx, `SELECT count(*) FROM smae_foods WHERE edition_id = $1`, ed.ID).Scan(&foods))
	require.Zero(t, foods, "la edición base no trae alimentos de nadie")

	id := customFood(t, nutri, "Avena de la casa")
	code, _ = nutri.Do("POST", "/api/v1/custom-foods/"+id+"/equivalence", map[string]any{"subgroup_code": "CER-SG", "reference_grams": "30", "criterion": "Equivalente por aporte de carbohidratos y energía"})
	require.Equal(t, 204, code, "las equivalencias usan la estructura de grupos de la edición base")
	code, d := nutri.Do("POST", "/api/v1/dishes", dishBody("Avena", "Desayuno", "1", ing("custom", id, "1", "porcion")))
	require.Equal(t, 201, code, fmt.Sprint(d))
}

func TestSmaeSwitchOff(t *testing.T) {
	e := start(t)
	rep, err := e.cat.ImportEdition(e.ctx, smae.Actor{}, sample.Catalog())
	require.NoError(t, err)
	_, err = e.dsh.ActivateEdition(e.ctx, dishes.Actor{}, rep.Edition.ID)
	require.NoError(t, err)
	nutri := e.staff(t, "off@demo.mx")
	platano, arroz := foodID(t, nutri, "Plátano"), foodID(t, nutri, "Arroz")
	propio := customFood(t, nutri, "Barra casera")

	// Con el catálogo encendido, un platillo con alimento oficial.
	code, d := nutri.Do("POST", "/api/v1/dishes", dishBody("Plátano solo", "Colación", "1", ing("smae", platano, "100", "g")))
	require.Equal(t, 201, code, fmt.Sprint(d))
	dishID := d["id"].(string)

	e.cat.SetEnabled(false)
	t.Cleanup(func() { e.cat.SetEnabled(true) })

	t.Run("no se lista ningún alimento oficial, solo los propios", func(t *testing.T) {
		_, b := nutri.Do("GET", "/api/v1/smae/foods?source=smae", nil)
		require.EqualValues(t, 0, b["total"])
		require.Empty(t, b["items"])
		_, b = nutri.Do("GET", "/api/v1/smae/foods?search=platano", nil)
		require.Empty(t, b["items"], "tampoco aparece al buscar")
		_, b = nutri.Do("GET", "/api/v1/smae/foods", nil)
		require.EqualValues(t, 1, b["total"], "queda solo «Mis alimentos»")
		require.Equal(t, "Barra casera", b["items"].([]any)[0].(map[string]any)["name"])
	})

	t.Run("lo ya usado en platillos se sigue viendo", func(t *testing.T) {
		code, got := nutri.Do("GET", "/api/v1/dishes/"+dishID, nil)
		require.Equal(t, 200, code, fmt.Sprint(got))
		code, _ = nutri.Do("GET", "/api/v1/smae/foods/smae/"+platano, nil)
		require.Equal(t, 200, code, "el detalle por id sigue resolviendo (no se pierde nada)")
	})

	t.Run("no se pueden agregar alimentos oficiales nuevos", func(t *testing.T) {
		code, b := nutri.Do("POST", "/api/v1/dishes", dishBody("Con arroz", "Comida", "1", ing("smae", arroz, "100", "g")))
		require.Equal(t, 422, code, fmt.Sprint(b))
		code, b = nutri.Do("POST", "/api/v1/dishes", dishBody("Con propio", "Comida", "1", ing("custom", propio, "1", "porcion")))
		require.Equal(t, 201, code, fmt.Sprint(b))
	})

	t.Run("una versión nueva conserva el oficial que ya tenía pero no suma otro", func(t *testing.T) {
		keep := dishBody("Plátano solo", "Colación", "1", ing("smae", platano, "150", "g"))
		keep["change_reason"] = "más porción"
		code, b := nutri.Do("POST", "/api/v1/dishes/"+dishID+"/versions", keep)
		require.Equal(t, 201, code, fmt.Sprint(b))

		add := dishBody("Plátano solo", "Colación", "1", ing("smae", platano, "150", "g"), ing("smae", arroz, "50", "g"))
		add["change_reason"] = "agrego arroz"
		code, b = nutri.Do("POST", "/api/v1/dishes/"+dishID+"/versions", add)
		require.Equal(t, 422, code, fmt.Sprint(b))
	})
}

// Una cuenta nueva (nutrióloga sin administración de la plataforma) puede leer el catálogo y administrar «Mis alimentos»,
// pero no importar ni activar ediciones del catálogo global.
func TestRegularNutritionistUsesCatalogButCannotManageEditions(t *testing.T) {
	e := start(t)
	_, err := e.auth.CreateUser(e.ctx, "cuenta-nueva@demo.mx", "Lic. Nueva", "nutritionist", "demo1234")
	require.NoError(t, err)
	c := testsupport.NewClient(t, e.srv.URL)
	c.Login("cuenta-nueva@demo.mx", "demo1234") // sin GrantPlatformAdmin

	for _, path := range []string{"/api/v1/smae/taxonomy", "/api/v1/smae/editions", "/api/v1/smae/foods", "/api/v1/custom-foods"} {
		code, b := c.Do("GET", path, nil)
		require.Equal(t, 200, code, "%s: %v", path, b)
	}
	id := customFood(t, c, "Mi avena")
	code, _ := c.Do("POST", "/api/v1/custom-foods/"+id+"/equivalence", map[string]any{"subgroup_code": "CER-SG", "reference_grams": "30", "criterion": "Equivalente por aporte de carbohidratos y energía"})
	require.Equal(t, 204, code)

	code, _ = c.Do("POST", "/api/v1/smae/editions", sample.Catalog())
	require.Equal(t, 403, code, "importar ediciones es solo de la plataforma")
	code, _ = c.Do("POST", "/api/v1/smae/editions/"+uuidZero+"/activate", nil)
	require.Equal(t, 403, code, "activar ediciones es solo de la plataforma")
}

const uuidZero = "00000000-0000-0000-0000-000000000000"
