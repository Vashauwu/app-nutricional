-- ---------- Consultas ----------
-- name: InsertAppointment :one
INSERT INTO appointments (patient_id, starts_at, ends_at, kind, mode, place, notes, status, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;

-- name: GetAppointment :one
SELECT * FROM appointments WHERE id = $1;

-- name: UpdateAppointment :one
UPDATE appointments SET starts_at = $2, ends_at = $3, kind = $4, mode = $5, place = $6, notes = $7, status = $8, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: CountAppointmentOverlap :one
SELECT count(*) FROM appointments
WHERE status = 'scheduled' AND starts_at < sqlc.arg(ends_at) AND ends_at > sqlc.arg(starts_at) AND id <> sqlc.arg(except_id);

-- name: ListAppointmentsRange :many
SELECT a.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name
FROM appointments a JOIN patients p ON p.id = a.patient_id
WHERE a.starts_at >= sqlc.arg(from_at) AND a.starts_at < sqlc.arg(to_at)
ORDER BY a.starts_at;

-- name: ListPatientAppointments :many
SELECT * FROM appointments
WHERE patient_id = $1 AND status <> 'cancelled' AND ends_at >= $2
ORDER BY starts_at;

-- name: GetCalendarFeed :one
SELECT * FROM calendar_feeds WHERE user_id = $1;

-- name: UpsertCalendarFeed :one
INSERT INTO calendar_feeds (user_id, token) VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, created_at = now() RETURNING *;

-- name: FeedByToken :one
SELECT * FROM calendar_feeds WHERE token = $1;
