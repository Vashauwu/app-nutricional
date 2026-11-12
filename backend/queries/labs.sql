-- ---------- Laboratorios ----------
-- name: InsertLabReport :one
INSERT INTO patient_lab_reports (patient_id, taken_at, lab_name, notes, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: InsertLabResult :one
INSERT INTO patient_lab_results (report_id, name, value, unit, ref_min, ref_max, position) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;

-- name: ListLabReports :many
SELECT * FROM patient_lab_reports WHERE patient_id = $1 ORDER BY taken_at DESC, created_at DESC;

-- name: ListLabResults :many
SELECT r.* FROM patient_lab_results r JOIN patient_lab_reports p ON p.id = r.report_id
WHERE p.patient_id = $1 ORDER BY r.position, r.name;

-- name: DeleteLabReport :execrows
DELETE FROM patient_lab_reports WHERE id = $1 AND patient_id = $2;
