-- ---------- Salud reproductiva ----------
-- name: SetMenarche :exec
UPDATE patients SET menarche_age = $2, menarche_unknown = $3, updated_at = now() WHERE id = $1;

-- name: InsertMenstrualRecord :one
INSERT INTO patient_menstrual_records (patient_id, last_period_date, created_by) VALUES ($1, $2, $3) RETURNING *;

-- name: ListMenstrualRecords :many
SELECT * FROM patient_menstrual_records WHERE patient_id = $1 ORDER BY last_period_date DESC, created_at DESC;

-- name: InsertPregnancy :one
INSERT INTO patient_pregnancies (patient_id, weeks_at_start, recorded_on, due_date, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: ListPregnancies :many
SELECT * FROM patient_pregnancies WHERE patient_id = $1 ORDER BY recorded_on DESC, created_at DESC;

-- name: EndPregnancy :execrows
UPDATE patient_pregnancies SET ended_on = $3 WHERE id = $1 AND patient_id = $2 AND ended_on IS NULL AND recorded_on <= $3;
