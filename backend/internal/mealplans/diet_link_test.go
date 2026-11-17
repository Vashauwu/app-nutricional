package mealplans_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// newDiet inserta un Dietocálculo enlazado a un paciente (como lo deja el módulo de Dietocálculo) y devuelve su id y su updated_at.
func newDiet(t *testing.T, e *env, patient string) (string, time.Time) {
	var id string
	var at time.Time
	require.NoError(t, e.pool.QueryRow(e.ctx, `INSERT INTO diet_calculations (name, patient_id, inputs, result, engine_version, kcal, created_by)
		VALUES ('DC prueba', $1, '{}', '{}', '1.1.0', 1810, (SELECT id FROM users LIMIT 1)) RETURNING id, updated_at`, patient).Scan(&id, &at))
	return id, at
}

// withRev arma el cuerpo de guardado: el documento más la revisión que se está editando.
func withRev(d map[string]any, rev any) map[string]any {
	d["expected_revision"] = rev
	return d
}

func targetsOf(v map[string]any) map[string]any { return v["targets"].(map[string]any) }

func TestPlanDietLink(t *testing.T) {
	e := start(t)
	nutri := e.login(t, "nutri@demo.mx", "nutritionist")
	pa := newPatient(t, e, nutri, "ana@demo.mx", true)
	pb := newPatient(t, e, nutri, "beto@demo.mx", true)
	mx, _ := time.LoadLocation("America/Mexico_City")
	in := func(d int) string { return time.Now().In(mx).AddDate(0, 0, d).Format("2006-01-02") }
	dietA, dietAt := newDiet(t, e, pa)
	dietB, _ := newDiet(t, e, pb)

	targets := func(id any, synced any) map[string]any {
		return map[string]any{"energy_kcal": "1810", "protein_g": "67.9", "carbohydrates_g": "271.5", "lipids_g": "50.3", "equivalents": map[string]string{"VER": "4"},
			"diet_calculation_id": id, "diet_synced_at": synced}
	}

	var planID string
	t.Run("el plan nace con el origen de sus objetivos", func(t *testing.T) {
		code, v := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "Con DC", "start_date": in(1), "end_date": in(7), "targets": targets(dietA, dietAt.Format(time.RFC3339Nano))})
		require.Equal(t, 201, code, fmt.Sprint(v))
		require.Equal(t, dietA, targetsOf(v)["diet_calculation_id"])
		require.NotNil(t, targetsOf(v)["diet_synced_at"])
		planID = v["id"].(string)
	})

	t.Run("ajustar los objetivos a mano conserva el origen", func(t *testing.T) {
		code, v := nutri.Do("GET", "/api/v1/plans/"+planID, nil)
		require.Equal(t, 200, code)
		d := docOf(v)
		tg := targetsOf(v)
		tg["energy_kcal"] = "1900" // ajuste manual: se envía el mismo vínculo que devolvió el servidor
		d["targets"] = tg
		code, saved := nutri.Do("PUT", "/api/v1/plans/"+planID, withRev(d, v["revision"]))
		require.Equal(t, 200, code, fmt.Sprint(saved))
		require.Equal(t, dietA, targetsOf(saved)["diet_calculation_id"], "el origen se conserva")
		require.Equal(t, tg["diet_synced_at"], targetsOf(saved)["diet_synced_at"])
		require.EqualValues(t, 2, saved["targets_version"], "los números sí cambian de versión")
	})

	t.Run("se puede quitar el origen", func(t *testing.T) {
		_, v := nutri.Do("GET", "/api/v1/plans/"+planID, nil)
		d := docOf(v)
		tg := targetsOf(v)
		tg["diet_calculation_id"], tg["diet_synced_at"] = nil, nil
		d["targets"] = tg
		code, saved := nutri.Do("PUT", "/api/v1/plans/"+planID, withRev(d, v["revision"]))
		require.Equal(t, 200, code, fmt.Sprint(saved))
		require.Nil(t, targetsOf(saved)["diet_calculation_id"])
	})

	t.Run("un Dietocálculo de otro paciente o inexistente se rechaza", func(t *testing.T) {
		for name, id := range map[string]any{"de otro paciente": dietB, "inexistente": "11111111-1111-1111-1111-111111111111"} {
			code, b := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "X", "start_date": in(1), "end_date": in(7), "targets": targets(id, nil)})
			require.Equal(t, 422, code, name+" "+fmt.Sprint(b))
		}
	})

	t.Run("la versión aplicada no puede ser posterior a la real", func(t *testing.T) {
		future := dietAt.Add(48 * time.Hour).Format(time.RFC3339Nano)
		code, v := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "Futuro", "start_date": in(1), "end_date": in(7), "targets": targets(dietA, future)})
		require.Equal(t, 201, code)
		got, err := time.Parse(time.RFC3339Nano, targetsOf(v)["diet_synced_at"].(string))
		require.NoError(t, err)
		require.False(t, got.After(dietAt.Add(time.Second)))
	})

	t.Run("un Dietocálculo eliminado después no impide seguir guardando el plan", func(t *testing.T) {
		code, v := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "Se borra", "start_date": in(20), "end_date": in(26), "targets": targets(dietA, dietAt.Format(time.RFC3339Nano))})
		require.Equal(t, 201, code, fmt.Sprint(v))
		_, err := e.pool.Exec(e.ctx, `UPDATE diet_calculations SET deleted_at = now() WHERE id = $1`, dietA)
		require.NoError(t, err)
		d := docOf(v)
		d["name"] = "Se borra (renombrado)"
		d["targets"] = targetsOf(v)
		code, saved := nutri.Do("PUT", "/api/v1/plans/"+v["id"].(string), withRev(d, v["revision"]))
		require.Equal(t, 200, code, fmt.Sprint(saved))
	})

	t.Run("duplicar el plan conserva el origen si es el mismo paciente", func(t *testing.T) {
		dietA2, _ := newDiet(t, e, pa)
		code, v := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "Original", "start_date": in(40), "end_date": in(46), "targets": targets(dietA2, nil)})
		require.Equal(t, 201, code, fmt.Sprint(v))
		code, cp := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pa, "name": "Copia", "start_date": in(47), "end_date": in(53), "copy_from_plan_id": v["id"]})
		require.Equal(t, 201, code, fmt.Sprint(cp))
		require.Equal(t, dietA2, targetsOf(cp)["diet_calculation_id"])
		code, other := nutri.Do("POST", "/api/v1/plans", map[string]any{"patient_id": pb, "name": "Copia otro", "start_date": in(47), "end_date": in(53), "copy_from_plan_id": v["id"]})
		require.Equal(t, 201, code, fmt.Sprint(other))
		require.Nil(t, targetsOf(other)["diet_calculation_id"], "no se hereda el origen de otro paciente")
	})
}
