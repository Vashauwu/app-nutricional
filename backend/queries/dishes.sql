-- name: InsertDish :one
INSERT INTO dishes (owner_user_id, name, category, tags, current_version) VALUES ($1, $2, $3, $4, 1) RETURNING *;

-- name: GetDish :one
SELECT * FROM dishes WHERE id = $1 AND deleted_at IS NULL;

-- name: UpdateDishMeta :exec
UPDATE dishes SET name = $2, category = $3, tags = $4, current_version = $5, updated_at = now() WHERE id = $1;

-- name: SetDishStatus :exec
UPDATE dishes SET status = $2, updated_at = now() WHERE id = $1;

-- Listado con filtros en el servidor y carga progresiva (§6.1, §16).
-- name: ListDishes :many
SELECT d.*, s.serving_energy, s.serving_protein, s.serving_carbs, s.serving_lipids, s.serving_fiber, s.equivalents, s.has_custom_foods,
       v.description, v.servings, v.prep_time_minutes, count(*) OVER () AS total
FROM dishes d
JOIN dish_versions v ON v.dish_id = d.id AND v.version_number = d.current_version
JOIN dish_nutrition_snapshots s ON s.dish_version_id = v.id
WHERE d.deleted_at IS NULL
  AND (sqlc.arg(status)::text = '' OR d.status = sqlc.arg(status)::text)
  AND (sqlc.arg(category)::text = '' OR d.category = sqlc.arg(category)::text)
  AND (sqlc.arg(subgroup_code)::text = '' OR COALESCE((s.equivalents ->> sqlc.arg(subgroup_code)::text)::numeric, 0) > 0)
  AND (sqlc.arg(search)::text = '' OR unaccent(d.name || ' ' || array_to_string(d.tags, ' ')) ILIKE '%' || unaccent(sqlc.arg(search)::text) || '%'
       OR EXISTS (SELECT 1 FROM dish_ingredients i WHERE i.dish_version_id = v.id AND unaccent(i.name_snapshot) ILIKE '%' || unaccent(sqlc.arg(search)::text) || '%'))
ORDER BY lower(d.name), d.id
LIMIT sqlc.arg(page_limit)::int OFFSET sqlc.arg(page_offset)::int;

-- name: InsertDishVersion :one
INSERT INTO dish_versions (dish_id, version_number, description, recipe_mode, instructions_text, steps, servings, prep_time_minutes,
    recommendations, image_file_id, smae_edition_id, created_by, change_reason)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: GetDishVersion :one
SELECT * FROM dish_versions WHERE dish_id = $1 AND version_number = $2;

-- name: ListDishVersions :many
SELECT v.*, s.serving_energy
FROM dish_versions v
JOIN dish_nutrition_snapshots s ON s.dish_version_id = v.id
WHERE v.dish_id = $1
ORDER BY v.version_number DESC;

-- name: InsertIngredient :exec
INSERT INTO dish_ingredients (dish_version_id, position, food_kind, food_id, name_snapshot, quantity, unit, grams,
    energy_kcal, protein_g, carbohydrates_g, lipids_g, fiber_g, equivalent_code, equivalent_value, official)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16);

-- name: ListIngredients :many
SELECT * FROM dish_ingredients WHERE dish_version_id = $1 ORDER BY position;

-- name: InsertSnapshot :exec
INSERT INTO dish_nutrition_snapshots (dish_version_id, totals_energy, totals_protein, totals_carbs, totals_lipids, totals_fiber,
    serving_energy, serving_protein, serving_carbs, serving_lipids, serving_fiber, equivalents, has_custom_foods, engine_version)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);

-- name: GetSnapshot :one
SELECT * FROM dish_nutrition_snapshots WHERE dish_version_id = $1;

-- ---------- Sustituciones autorizadas ----------
-- name: InsertSubstitution :one
INSERT INTO dish_substitutions (dish_version_id, substitute_dish_id, substitute_version, label, note, rule, diff, approved_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListSubstitutions :many
SELECT * FROM dish_substitutions WHERE dish_version_id = $1 AND removed_at IS NULL ORDER BY approved_at;

-- name: RemoveSubstitution :execrows
UPDATE dish_substitutions SET removed_at = now() WHERE id = $1 AND dish_version_id = $2 AND removed_at IS NULL;

-- ---------- Recálculo por nueva edición ----------
-- name: ListCurrentDishVersions :many
SELECT d.id AS dish_id, d.name, v.id AS version_id, v.version_number, v.servings, v.smae_edition_id, v.recipe_mode, v.description,
       v.instructions_text, v.steps, v.prep_time_minutes, v.recommendations, v.image_file_id
FROM dishes d
JOIN dish_versions v ON v.dish_id = d.id AND v.version_number = d.current_version
WHERE d.deleted_at IS NULL
ORDER BY lower(d.name);

-- name: InsertRecalcBatch :one
INSERT INTO smae_recalc_batches (from_edition_id, to_edition_id, decided_by) VALUES ($1, $2, $3) RETURNING *;

-- name: InsertRecalcDecision :exec
INSERT INTO smae_recalc_decisions (batch_id, dish_id, from_version, to_version, decision) VALUES ($1, $2, $3, $4, $5);

-- name: GetRecalcBatchForEdition :one
SELECT * FROM smae_recalc_batches WHERE to_edition_id = $1 ORDER BY decided_at DESC LIMIT 1;

-- name: ListRecalcDecisions :many
SELECT * FROM smae_recalc_decisions WHERE batch_id = $1;
