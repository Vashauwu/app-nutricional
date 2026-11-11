-- ---------- Planes ----------
-- name: InsertPlan :one
INSERT INTO meal_plans (patient_id, name, start_date, end_date, target_energy, target_protein, target_carbs, target_lipids, target_equivalents, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
RETURNING *;

-- name: GetPlan :one
SELECT * FROM meal_plans WHERE id = $1 AND deleted_at IS NULL;

-- name: ListPlans :many
SELECT p.*, pt.first_name, pt.last_name,
       (SELECT count(*) FROM meal_slot_items i JOIN meal_slots s ON s.id = i.slot_id JOIN meal_plan_days d ON d.id = s.day_id
         WHERE d.plan_id = p.id AND i.removed_at IS NULL AND s.removed_at IS NULL AND d.removed_at IS NULL) AS item_count,
       count(*) OVER () AS total
FROM meal_plans p
JOIN patients pt ON pt.id = p.patient_id
WHERE p.deleted_at IS NULL
  AND (sqlc.arg(status)::text = '' OR p.status = sqlc.arg(status)::text)
  AND (sqlc.arg(patient_id)::uuid = '00000000-0000-0000-0000-000000000000'::uuid OR p.patient_id = sqlc.arg(patient_id)::uuid)
  AND (sqlc.arg(from_date)::date IS NULL OR p.end_date >= sqlc.arg(from_date)::date)
  AND (sqlc.arg(to_date)::date IS NULL OR p.start_date <= sqlc.arg(to_date)::date)
  AND (sqlc.arg(search)::text = '' OR unaccent(p.name || ' ' || pt.first_name || ' ' || pt.last_name) ILIKE '%' || unaccent(sqlc.arg(search)::text) || '%')
ORDER BY p.start_date DESC, p.id
LIMIT sqlc.arg(page_limit)::int OFFSET sqlc.arg(page_offset)::int;

-- Guardado con concurrencia optimista: solo actualiza si la revisión coincide.
-- name: UpdatePlanDoc :one
UPDATE meal_plans SET name = $3, start_date = $4, end_date = $5, target_energy = $6, target_protein = $7, target_carbs = $8, target_lipids = $9,
    target_equivalents = $10, targets_version = $11, revision = revision + 1, updated_by = $12, updated_at = now()
WHERE id = $1 AND revision = $2 AND deleted_at IS NULL
RETURNING *;

-- name: SetPlanStatus :one
UPDATE meal_plans SET status = $2, revision = revision + 1, updated_by = $3, updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: BumpPlanRevision :one
UPDATE meal_plans SET revision = revision + 1, updated_by = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: SoftDeletePlan :exec
UPDATE meal_plans SET deleted_at = now(), revision = revision + 1, updated_by = $2, updated_at = now() WHERE id = $1;

-- Al terminar el periodo el plan pasa a finalizado (§11).
-- name: FinalizeExpiredPlans :many
UPDATE meal_plans SET status = 'finished', revision = revision + 1, updated_at = now()
WHERE status = 'published' AND end_date < $1 AND deleted_at IS NULL
RETURNING id, updated_by;

-- ---------- Documento: días, tiempos y platillos ----------
-- name: UpsertDay :one
INSERT INTO meal_plan_days (plan_id, plan_date, notes) VALUES ($1, $2, $3)
ON CONFLICT (plan_id, plan_date) WHERE removed_at IS NULL DO UPDATE SET notes = EXCLUDED.notes
RETURNING id;

-- name: RemoveDaysNotIn :exec
UPDATE meal_plan_days SET removed_at = now() WHERE plan_id = $1 AND removed_at IS NULL AND NOT (plan_date = ANY($2::date[]));

-- name: ListDays :many
SELECT * FROM meal_plan_days WHERE plan_id = $1 AND removed_at IS NULL ORDER BY plan_date;

-- name: SlotPlanIDs :many
SELECT s.id, d.plan_id FROM meal_slots s JOIN meal_plan_days d ON d.id = s.day_id WHERE s.id = ANY($1::uuid[]);

-- name: ItemPlanIDs :many
SELECT i.id, d.plan_id FROM meal_slot_items i JOIN meal_slots s ON s.id = i.slot_id JOIN meal_plan_days d ON d.id = s.day_id WHERE i.id = ANY($1::uuid[]);

-- name: UpsertSlot :exec
INSERT INTO meal_slots (id, day_id, name, position) VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO UPDATE SET day_id = EXCLUDED.day_id, name = EXCLUDED.name, position = EXCLUDED.position, removed_at = NULL;

-- name: RemoveSlotsNotIn :exec
UPDATE meal_slots SET removed_at = now()
WHERE removed_at IS NULL AND day_id IN (SELECT id FROM meal_plan_days WHERE plan_id = $1) AND NOT (id = ANY($2::uuid[]));

-- name: UpsertItem :exec
INSERT INTO meal_slot_items (id, slot_id, position, dish_id, dish_version, servings, instructions) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET slot_id = EXCLUDED.slot_id, position = EXCLUDED.position, dish_id = EXCLUDED.dish_id, dish_version = EXCLUDED.dish_version,
    servings = EXCLUDED.servings, instructions = EXCLUDED.instructions, removed_at = NULL;

-- name: RemoveItemsNotIn :exec
UPDATE meal_slot_items SET removed_at = now()
WHERE removed_at IS NULL
  AND slot_id IN (SELECT s.id FROM meal_slots s JOIN meal_plan_days d ON d.id = s.day_id WHERE d.plan_id = $1)
  AND NOT (id = ANY($2::uuid[]));

-- Todo lo necesario para dibujar el plan: platillo, su versión y la nutrición por porción de ESA versión.
-- name: ListPlanItems :many
SELECT i.id AS item_id, s.id AS slot_id, s.name AS slot_name, s.position AS slot_position, d.plan_date, i.position AS item_position,
       i.dish_id, i.dish_version, i.servings, i.instructions,
       dd.name AS dish_name, dd.category AS dish_category, dd.status AS dish_status, dd.current_version AS dish_latest,
       sn.serving_energy, sn.serving_protein, sn.serving_carbs, sn.serving_lipids, sn.serving_fiber, sn.equivalents
FROM meal_slot_items i
JOIN meal_slots s ON s.id = i.slot_id AND s.removed_at IS NULL
JOIN meal_plan_days d ON d.id = s.day_id AND d.removed_at IS NULL
JOIN dishes dd ON dd.id = i.dish_id
JOIN dish_versions v ON v.dish_id = i.dish_id AND v.version_number = i.dish_version
JOIN dish_nutrition_snapshots sn ON sn.dish_version_id = v.id
WHERE d.plan_id = $1 AND i.removed_at IS NULL
ORDER BY d.plan_date, s.position, i.position;

-- name: ListPlanSlots :many
SELECT s.id, s.name, s.position, d.plan_date
FROM meal_slots s JOIN meal_plan_days d ON d.id = s.day_id
WHERE d.plan_id = $1 AND s.removed_at IS NULL AND d.removed_at IS NULL
ORDER BY d.plan_date, s.position;

-- ---------- Revisiones, publicaciones, historial ----------
-- name: InsertRevision :exec
INSERT INTO meal_plan_revisions (plan_id, revision, saved_by, snapshot) VALUES ($1, $2, $3, $4);

-- name: GetRevision :one
SELECT * FROM meal_plan_revisions WHERE plan_id = $1 AND revision = $2;

-- name: ListRevisions :many
SELECT plan_id, revision, saved_at, saved_by FROM meal_plan_revisions WHERE plan_id = $1 ORDER BY revision DESC;

-- name: InsertPublication :one
INSERT INTO meal_plan_publications (plan_id, version_number, revision, published_by, summary)
VALUES ($1, (SELECT COALESCE(max(version_number), 0) + 1 FROM meal_plan_publications WHERE plan_id = $1), $2, $3, $4)
RETURNING *;

-- name: ListPublications :many
SELECT * FROM meal_plan_publications WHERE plan_id = $1 ORDER BY version_number DESC;

-- name: InsertPlanEvent :exec
INSERT INTO meal_plan_events (plan_id, actor, type, summary) VALUES ($1, $2, $3, $4);

-- name: ListPlanEvents :many
SELECT * FROM meal_plan_events WHERE plan_id = $1 ORDER BY at DESC, id;

-- name: LastPlanEvent :one
SELECT * FROM meal_plan_events WHERE plan_id = $1 ORDER BY at DESC, id LIMIT 1;

-- name: TouchPlanEvent :exec
UPDATE meal_plan_events SET at = now() WHERE id = $1;

-- ---------- Plantillas ----------
-- name: InsertTemplate :one
INSERT INTO meal_plan_templates (name, description, scope, patient_id, structure, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetTemplate :one
SELECT * FROM meal_plan_templates WHERE id = $1 AND deleted_at IS NULL;

-- name: ListTemplates :many
SELECT * FROM meal_plan_templates
WHERE deleted_at IS NULL AND (sqlc.arg(patient_id)::uuid = '00000000-0000-0000-0000-000000000000'::uuid OR scope = 'global' OR patient_id = sqlc.arg(patient_id)::uuid)
ORDER BY created_at DESC;

-- name: SoftDeleteTemplate :execrows
UPDATE meal_plan_templates SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL;

-- ---------- Rol paciente ----------
-- Plan vigente: publicado y dentro de su periodo; si no hay, el publicado más reciente.
-- name: CurrentPublishedPlan :one
SELECT * FROM meal_plans
WHERE patient_id = $1 AND status = 'published' AND deleted_at IS NULL
ORDER BY (start_date <= $2 AND end_date >= $2) DESC, start_date DESC
LIMIT 1;

-- Un platillo solo es visible para la paciente si aparece en SU plan publicado.
-- name: DishInPatientPublishedPlan :one
SELECT EXISTS (
  SELECT 1 FROM meal_slot_items i
  JOIN meal_slots s ON s.id = i.slot_id AND s.removed_at IS NULL
  JOIN meal_plan_days d ON d.id = s.day_id AND d.removed_at IS NULL
  JOIN meal_plans p ON p.id = d.plan_id AND p.deleted_at IS NULL AND p.status = 'published'
  WHERE p.patient_id = $1 AND i.dish_id = $2 AND i.dish_version = $3 AND i.removed_at IS NULL);

-- Cuántos planes no archivados usan un platillo (para avisar antes de desactivarlo).
-- name: PlansUsingDish :one
SELECT count(DISTINCT p.id) FROM meal_slot_items i
JOIN meal_slots s ON s.id = i.slot_id AND s.removed_at IS NULL
JOIN meal_plan_days d ON d.id = s.day_id AND d.removed_at IS NULL
JOIN meal_plans p ON p.id = d.plan_id AND p.deleted_at IS NULL AND p.status <> 'archived'
WHERE i.dish_id = $1 AND i.removed_at IS NULL;

-- ---------- Sustitución ----------
-- name: GetItemForSubstitution :one
SELECT i.id, i.slot_id, i.position, i.servings, i.instructions, i.dish_id, i.dish_version, s.name AS slot_name, d.plan_date
FROM meal_slot_items i
JOIN meal_slots s ON s.id = i.slot_id AND s.removed_at IS NULL
JOIN meal_plan_days d ON d.id = s.day_id AND d.removed_at IS NULL
WHERE i.id = $1 AND d.plan_id = $2 AND i.removed_at IS NULL;

-- name: RemoveItem :exec
UPDATE meal_slot_items SET removed_at = now() WHERE id = $1;

-- name: InsertItem :exec
INSERT INTO meal_slot_items (id, slot_id, position, dish_id, dish_version, servings, instructions) VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: GetDishForPlan :one
SELECT id, name, status, current_version FROM dishes WHERE id = $1 AND deleted_at IS NULL;
