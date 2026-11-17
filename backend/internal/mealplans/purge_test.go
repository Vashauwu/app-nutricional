package mealplans_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

// fakeFiles registra los archivos que se piden quitar del almacenamiento.
type fakeFiles struct {
	mu   sync.Mutex
	keys []string
}

func (f *fakeFiles) RemovePrivateObjects(_ context.Context, keys []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.keys = append(f.keys, keys...)
}

func (e *env) count(t *testing.T, sql string, args ...any) int {
	var n int
	require.NoError(t, e.pool.QueryRow(e.ctx, sql, args...).Scan(&n))
	return n
}

func TestPlanPurge(t *testing.T) {
	e := start(t)
	files := &fakeFiles{}
	e.plans.SetFiles(files)
	nutri := e.login(t, "nutri@demo.mx", "nutritionist")
	pollo := newDish(t, nutri, "Pollo", "pechuga", "100", "g")
	pa := newPatient(t, e, nutri, "ana@demo.mx", true)
	mx, _ := time.LoadLocation("America/Mexico_City")
	in := func(d int) string { return time.Now().In(mx).AddDate(0, 0, d).Format("2006-01-02") }

	// Plan publicado con un platillo y seguimiento (registro, comentario y fotografía) del paciente.
	v := createPlan(t, nutri, pa, "Plan a borrar", in(1), in(3))
	id := v["id"].(string)
	d := docOf(v)
	slot := firstSlot(v, 0, 2)
	itemID := "aaaaaaaa-0000-4000-8000-000000000001"
	slot["items"] = []any{item(itemID, pollo, 1, "1")}
	d["days"].([]any)[0].(map[string]any)["slots"].([]any)[2] = slot
	code, saved := save(t, nutri, id, v["revision"], d)
	require.Equal(t, 200, code, fmt.Sprint(saved))
	code, _ = nutri.Do("POST", "/api/v1/plans/"+id+"/publish", map[string]any{"summary": "v1"})
	require.Equal(t, 200, code)

	var userID string
	require.NoError(t, e.pool.QueryRow(e.ctx, `SELECT id FROM users WHERE email = 'nutri@demo.mx'`).Scan(&userID))
	var entryID string
	require.NoError(t, e.pool.QueryRow(e.ctx, `INSERT INTO tracking_entries (patient_id, plan_id, item_id, entry_date, slot_name, dish_id, dish_version, dish_name, status)
		VALUES ($1, $2, $3, $4, 'Comida', $5, 1, 'Pollo', 'done') RETURNING id`, pa, id, itemID, in(1), pollo).Scan(&entryID))
	_, err := e.pool.Exec(e.ctx, `INSERT INTO meal_comments (entry_id, author_user_id, author_role, body) VALUES ($1, $2, 'patient', 'rico')`, entryID, userID)
	require.NoError(t, err)
	var fileID string
	require.NoError(t, e.pool.QueryRow(e.ctx, `INSERT INTO file_objects (storage_key, thumb_key, kind, visibility, mime_type, size_bytes, checksum, owner_patient_id)
		VALUES ('tracking_photo/x/foto.jpg', 'tracking_photo_thumb/x/foto.jpg', 'tracking_photo', 'private', 'image/jpeg', 100, 'abc', $1) RETURNING id`, pa).Scan(&fileID))
	_, err = e.pool.Exec(e.ctx, `INSERT INTO tracking_photos (entry_id, file_object_id) VALUES ($1, $2)`, entryID, fileID)
	require.NoError(t, err)

	// Otro plan del mismo paciente que NO debe tocarse.
	keep := createPlan(t, nutri, pa, "Plan que se queda", in(10), in(12))

	require.Equal(t, 1, e.count(t, `SELECT count(*) FROM meal_plan_publications WHERE plan_id = $1`, id), "hay una publicación inmutable")

	t.Run("otra consulta no puede borrarlo", func(t *testing.T) {
		other := testsupport.NewPractice(t, e.pool)
		var n int
		err := e.pool.QueryRow(other, `SELECT purge_meal_plan($1)::text`, id).Scan(&n)
		require.Error(t, err, "el plan no existe para otra consulta")
		require.Equal(t, 1, e.count(t, `SELECT count(*) FROM meal_plans WHERE id = $1`, id))
	})

	t.Run("borra el plan publicado con todo lo que depende de él", func(t *testing.T) {
		code, b := nutri.Do("DELETE", "/api/v1/plans/"+id, nil)
		require.Equal(t, 204, code, fmt.Sprint(b))
		for table, col := range map[string]string{
			"meal_plans": "id", "meal_plan_days": "plan_id", "meal_plan_revisions": "plan_id", "meal_plan_publications": "plan_id",
			"meal_plan_events": "plan_id", "tracking_entries": "plan_id",
		} {
			require.Equal(t, 0, e.count(t, fmt.Sprintf(`SELECT count(*) FROM %s WHERE %s = $1`, table, col), id), table)
		}
		require.Equal(t, 0, e.count(t, `SELECT count(*) FROM meal_slot_items WHERE id = $1`, itemID))
		require.Equal(t, 0, e.count(t, `SELECT count(*) FROM meal_comments WHERE entry_id = $1`, entryID))
		require.Equal(t, 0, e.count(t, `SELECT count(*) FROM tracking_photos WHERE entry_id = $1`, entryID))
		require.Equal(t, 0, e.count(t, `SELECT count(*) FROM file_objects WHERE id = $1`, fileID))
		require.ElementsMatch(t, []string{"tracking_photo/x/foto.jpg", "tracking_photo_thumb/x/foto.jpg"}, files.keys, "también se quitan del almacenamiento")
		code, _ = nutri.Do("GET", "/api/v1/plans/"+id, nil)
		require.Equal(t, 404, code)
	})

	t.Run("no toca otros planes y las protecciones siguen activas", func(t *testing.T) {
		code, _ := nutri.Do("GET", "/api/v1/plans/"+keep["id"].(string), nil)
		require.Equal(t, 200, code)
		// Las protecciones de inmutabilidad quedan activas (el borrado solo las apaga dentro de su transacción).
		require.Equal(t, 2, e.count(t, `SELECT count(*) FROM pg_trigger WHERE tgname IN ('meal_plan_revisions_immutable', 'meal_plan_publications_immutable') AND tgenabled = 'O'`))
		// Una publicación de otro plan sigue siendo inmutable para el resto de la aplicación.
		code, _ = nutri.Do("POST", "/api/v1/plans/"+keep["id"].(string)+"/publish", map[string]any{"summary": "x"})
		require.Equal(t, 422, code, "vacío: no se publica, pero tampoco se toca")
	})

	t.Run("borrar de nuevo o un plan inexistente da 404 y queda en la auditoría", func(t *testing.T) {
		code, _ := nutri.Do("DELETE", "/api/v1/plans/"+id, nil)
		require.Equal(t, 404, code)
		require.Equal(t, 1, e.count(t, `SELECT count(*) FROM audit_logs WHERE action = 'plan.purge' AND resource_id = $1`, id))
	})

	t.Run("también se puede borrar un borrador", func(t *testing.T) {
		draft := createPlan(t, nutri, pa, "Borrador", in(20), in(22))
		code, _ := nutri.Do("DELETE", "/api/v1/plans/"+draft["id"].(string), nil)
		require.Equal(t, 204, code)
	})
}
