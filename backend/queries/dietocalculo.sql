-- ---------- Dietocálculo ----------
-- name: InsertDietCalculation :one
INSERT INTO diet_calculations (name, patient_id, inputs, result, engine_version, kcal, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: GetDietCalculation :one
SELECT d.*, COALESCE(p.first_name || ' ' || p.last_name, '')::text AS patient_name
FROM diet_calculations d LEFT JOIN patients p ON p.id = d.patient_id
WHERE d.id = $1 AND d.deleted_at IS NULL;

-- name: UpdateDietCalculation :one
UPDATE diet_calculations SET name = $2, patient_id = $3, inputs = $4, result = $5, engine_version = $6, kcal = $7, updated_at = now()
WHERE id = $1 AND deleted_at IS NULL RETURNING *;

-- name: ListDietCalculations :many
SELECT d.id, d.name, d.patient_id, d.engine_version, d.kcal, d.updated_at, d.created_at,
       COALESCE(p.first_name || ' ' || p.last_name, '')::text AS patient_name
FROM diet_calculations d LEFT JOIN patients p ON p.id = d.patient_id
WHERE d.deleted_at IS NULL
  AND (sqlc.narg(patient_id)::uuid IS NULL OR d.patient_id = sqlc.narg(patient_id)::uuid)
  AND (sqlc.arg(only_unlinked)::boolean = false OR d.patient_id IS NULL)
  AND (sqlc.arg(q)::text = '' OR d.name ILIKE '%' || sqlc.arg(q)::text || '%')
ORDER BY d.updated_at DESC
LIMIT sqlc.arg(row_limit);

-- name: SoftDeleteDietCalculation :execrows
UPDATE diet_calculations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL;

-- Para validar el vínculo de un plan con su Dietocálculo (el aislamiento por consulta lo impone la base).
-- name: GetDietCalcLink :one
SELECT patient_id, updated_at FROM diet_calculations WHERE id = $1 AND deleted_at IS NULL;
