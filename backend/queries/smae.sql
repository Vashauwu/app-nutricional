-- ---------- Ediciones ----------
-- name: CreateEdition :one
INSERT INTO smae_editions (name, edition_number, publisher, source_reference, license_reference, effective_date, status, notes, imported_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetEdition :one
SELECT * FROM smae_editions WHERE id = $1;

-- name: GetActiveEdition :one
SELECT * FROM smae_editions WHERE status = 'active';

-- name: ListEditions :many
SELECT * FROM smae_editions ORDER BY imported_at DESC;

-- name: SetEditionStatus :exec
UPDATE smae_editions SET status = $2 WHERE id = $1;

-- name: InsertImportBatch :one
INSERT INTO smae_import_batches (edition_id, source_file_name, checksum, imported_by, row_count, status, error_summary)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- ---------- Taxonomía y alimentos ----------
-- name: InsertGroup :one
INSERT INTO smae_food_groups (edition_id, code, name, sort_order, tone) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: InsertSubgroup :one
INSERT INTO smae_food_subgroups (group_id, code, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: ListGroups :many
SELECT * FROM smae_food_groups WHERE edition_id = $1 ORDER BY sort_order, code;

-- name: ListSubgroups :many
SELECT sg.id, sg.group_id, sg.code, sg.name, sg.sort_order
FROM smae_food_subgroups sg
JOIN smae_food_groups g ON g.id = sg.group_id
WHERE g.edition_id = $1
ORDER BY g.sort_order, sg.sort_order, sg.code;

-- name: InsertFood :one
INSERT INTO smae_foods (edition_id, subgroup_id, code, name, food_state, edible_pct, density_g_per_ml, basis_quantity, basis_unit,
    energy_kcal, protein_g, carbohydrates_g, lipids_g, fiber_g, equiv_reference_grams, equiv_value, tags, source_reference)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
RETURNING id;

-- name: InsertPortion :exec
INSERT INTO smae_portions (food_id, name, unit, quantity, grams_equivalent, is_reference) VALUES ($1, $2, $3, $4, $5, $6);

-- name: GetFood :one
SELECT sqlc.embed(f), sg.code AS subgroup_code, g.id AS group_id
FROM smae_foods f
JOIN smae_food_subgroups sg ON sg.id = f.subgroup_id
JOIN smae_food_groups g ON g.id = sg.group_id
WHERE f.id = $1;

-- name: GetFoodByEditionCode :one
SELECT sqlc.embed(f), sg.code AS subgroup_code, g.id AS group_id
FROM smae_foods f
JOIN smae_food_subgroups sg ON sg.id = f.subgroup_id
JOIN smae_food_groups g ON g.id = sg.group_id
WHERE f.edition_id = $1 AND f.code = $2;

-- Búsqueda sin acentos, filtro por grupo y paginación (carga progresiva, §20.2).
-- name: ListFoods :many
SELECT sqlc.embed(f), sg.code AS subgroup_code, g.id AS group_id, count(*) OVER () AS total
FROM smae_foods f
JOIN smae_food_subgroups sg ON sg.id = f.subgroup_id
JOIN smae_food_groups g ON g.id = sg.group_id
WHERE f.edition_id = sqlc.arg(edition_id)
  AND f.status = 'active'
  AND (sqlc.arg(group_id)::uuid = '00000000-0000-0000-0000-000000000000'::uuid OR g.id = sqlc.arg(group_id)::uuid)
  AND (sqlc.arg(search)::text = '' OR unaccent(f.name || ' ' || array_to_string(f.tags, ' ')) ILIKE '%' || unaccent(sqlc.arg(search)::text) || '%')
ORDER BY lower(f.name), f.id
LIMIT sqlc.arg(page_limit)::int OFFSET sqlc.arg(page_offset)::int;

-- name: ListPortionsForFoods :many
SELECT * FROM smae_portions WHERE food_id = ANY($1::uuid[]) ORDER BY is_reference DESC, grams_equivalent;

-- ---------- Alimentos personalizados ----------
-- name: InsertCustomFood :one
INSERT INTO custom_foods (name, brand, description, basis_quantity, basis_unit, density_g_per_ml, energy_kcal, protein_g, carbohydrates_g, lipids_g, fiber_g,
    source_type, source_reference, tags, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
RETURNING *;

-- Al editar los valores se invalida la validación previa.
-- name: UpdateCustomFood :one
UPDATE custom_foods SET name = $2, brand = $3, description = $4, basis_quantity = $5, basis_unit = $6, density_g_per_ml = $7,
    energy_kcal = $8, protein_g = $9, carbohydrates_g = $10, lipids_g = $11, fiber_g = $12, source_type = $13, source_reference = $14, tags = $15,
    validated_by = NULL, validated_at = NULL, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetCustomFood :one
SELECT * FROM custom_foods WHERE id = $1;

-- name: ListCustomFoods :many
SELECT *, count(*) OVER () AS total
FROM custom_foods
WHERE (sqlc.arg(only_active)::bool = false OR status = 'active')
  AND (sqlc.arg(search)::text = '' OR unaccent(name || ' ' || array_to_string(tags, ' ')) ILIKE '%' || unaccent(sqlc.arg(search)::text) || '%')
ORDER BY lower(name), id
LIMIT sqlc.arg(page_limit)::int OFFSET sqlc.arg(page_offset)::int;

-- name: ListCustomPortionsFor :many
SELECT * FROM custom_food_portions WHERE custom_food_id = ANY($1::uuid[]) ORDER BY grams_equivalent;

-- name: DeleteCustomPortions :exec
DELETE FROM custom_food_portions WHERE custom_food_id = $1;

-- name: InsertCustomPortion :exec
INSERT INTO custom_food_portions (custom_food_id, name, unit, quantity, grams_equivalent) VALUES ($1, $2, $3, $4, $5);

-- name: ValidateCustomFood :exec
UPDATE custom_foods SET validated_by = $2, validated_at = now(), updated_at = now() WHERE id = $1;

-- name: AssignCustomEquivalence :exec
UPDATE custom_foods SET eq_subgroup_code = $2, eq_reference_grams = $3, eq_value = 1, eq_assigned_by = $4, eq_assigned_at = now(), eq_criterion = $5, updated_at = now()
WHERE id = $1;

-- name: SetCustomFoodStatus :exec
UPDATE custom_foods SET status = $2, updated_at = now() WHERE id = $1;
