-- Comida del plan publicado de la paciente que se puede registrar (la paciente nunca elige el plan por URL).
-- name: TrackableItem :one
SELECT p.id AS plan_id, d.plan_date, s.name AS slot_name, i.dish_id, i.dish_version, dd.name AS dish_name
FROM meal_slot_items i
JOIN meal_slots s ON s.id = i.slot_id AND s.removed_at IS NULL
JOIN meal_plan_days d ON d.id = s.day_id AND d.removed_at IS NULL
JOIN meal_plans p ON p.id = d.plan_id AND p.deleted_at IS NULL AND p.status = 'published'
JOIN dishes dd ON dd.id = i.dish_id
WHERE i.id = $1 AND p.patient_id = $2 AND i.removed_at IS NULL;

-- name: UpsertEntry :one
INSERT INTO tracking_entries (patient_id, plan_id, item_id, entry_date, slot_name, dish_id, dish_version, dish_name, status, patient_comment)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE(sqlc.narg(comment)::text, ''))
ON CONFLICT (item_id) DO UPDATE
   SET status = EXCLUDED.status, recorded_at = now(), updated_at = now(), needs_review = true,
       patient_comment = COALESCE(sqlc.narg(comment)::text, tracking_entries.patient_comment)
   WHERE tracking_entries.patient_id = EXCLUDED.patient_id
RETURNING *;

-- name: GetEntry :one
SELECT * FROM tracking_entries WHERE id = $1;

-- Solo se puede borrar un registro sin fotografías ni comentarios de la nutrióloga (conserva trazabilidad).
-- name: DeleteEntryIfEmpty :execrows
DELETE FROM tracking_entries t
WHERE t.id = $1 AND t.patient_id = $2
  AND NOT EXISTS (SELECT 1 FROM tracking_photos ph JOIN file_objects f ON f.id = ph.file_object_id AND f.deleted_at IS NULL WHERE ph.entry_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM meal_comments c WHERE c.entry_id = t.id AND c.deleted_at IS NULL);

-- name: MarkEntryReviewed :execrows
UPDATE tracking_entries SET needs_review = false, updated_at = now() WHERE id = $1;

-- name: SetEntryNeedsReview :exec
UPDATE tracking_entries SET needs_review = $2, updated_at = now() WHERE id = $1;

-- Bandeja de actividad con filtros en servidor.
-- name: ListEntries :many
SELECT t.*, (p.first_name || ' ' || p.last_name)::text AS patient_name,
       (SELECT count(*) FROM tracking_photos ph JOIN file_objects f ON f.id = ph.file_object_id AND f.deleted_at IS NULL WHERE ph.entry_id = t.id)::int AS photo_count,
       (SELECT count(*) FROM meal_comments c WHERE c.entry_id = t.id AND c.deleted_at IS NULL)::int AS comment_count,
       count(*) OVER ()::int AS total
FROM tracking_entries t JOIN patients p ON p.id = t.patient_id
WHERE (sqlc.narg(patient_id)::uuid IS NULL OR t.patient_id = sqlc.narg(patient_id))
  AND (sqlc.narg(from_date)::date IS NULL OR t.entry_date >= sqlc.narg(from_date))
  AND (sqlc.narg(to_date)::date IS NULL OR t.entry_date <= sqlc.narg(to_date))
  AND (sqlc.arg(kind)::text = ''
       OR (sqlc.arg(kind) = 'photos' AND EXISTS (SELECT 1 FROM tracking_photos ph JOIN file_objects f ON f.id = ph.file_object_id AND f.deleted_at IS NULL WHERE ph.entry_id = t.id))
       OR (sqlc.arg(kind) = 'comments' AND (t.patient_comment <> '' OR EXISTS (SELECT 1 FROM meal_comments c WHERE c.entry_id = t.id AND c.deleted_at IS NULL)))
       OR (sqlc.arg(kind) = 'review' AND t.needs_review)
       OR (sqlc.arg(kind) = 'skipped' AND t.status = 'skipped'))
  AND (sqlc.arg(search)::text = ''
       OR unaccent(t.dish_name || ' ' || t.patient_comment || ' ' || p.first_name || ' ' || p.last_name) ILIKE '%' || unaccent(sqlc.arg(search)) || '%')
ORDER BY t.recorded_at DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: ListPhotosForEntries :many
SELECT ph.id, ph.entry_id, ph.file_object_id, ph.alt, ph.uploaded_at
FROM tracking_photos ph JOIN file_objects f ON f.id = ph.file_object_id AND f.deleted_at IS NULL
WHERE ph.entry_id = ANY($1::uuid[])
ORDER BY ph.uploaded_at;

-- name: CountEntryPhotos :one
SELECT count(*)::int FROM tracking_photos ph JOIN file_objects f ON f.id = ph.file_object_id AND f.deleted_at IS NULL WHERE ph.entry_id = $1;

-- name: InsertTrackingPhoto :one
INSERT INTO tracking_photos (entry_id, file_object_id, alt) VALUES ($1, $2, $3) RETURNING *;

-- name: InsertComment :one
INSERT INTO meal_comments (entry_id, author_user_id, author_role, body) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: ListCommentsForEntries :many
SELECT c.id, c.entry_id, c.author_role, c.body, c.created_at, u.display_name AS author_name
FROM meal_comments c JOIN users u ON u.id = c.author_user_id
WHERE c.entry_id = ANY($1::uuid[]) AND c.deleted_at IS NULL
ORDER BY c.created_at;

-- Cumplimiento: comidas programadas (planes no borradores) frente a registradas.
-- name: ComplianceCounts :one
SELECT count(*)::int AS planned,
       count(*) FILTER (WHERE t.status = 'done')::int AS done,
       count(*) FILTER (WHERE t.status = 'skipped')::int AS skipped
FROM meal_slot_items i
JOIN meal_slots s ON s.id = i.slot_id AND s.removed_at IS NULL
JOIN meal_plan_days d ON d.id = s.day_id AND d.removed_at IS NULL
JOIN meal_plans p ON p.id = d.plan_id AND p.deleted_at IS NULL AND p.status <> 'draft'
LEFT JOIN tracking_entries t ON t.item_id = i.id
WHERE p.patient_id = $1 AND i.removed_at IS NULL AND d.plan_date BETWEEN $2 AND $3;

-- Cumplimiento por día (para reportes diarios y semanales).
-- name: ComplianceByDay :many
SELECT d.plan_date::date AS day,
       count(*)::int AS planned,
       count(*) FILTER (WHERE t.status = 'done')::int AS done,
       count(*) FILTER (WHERE t.status = 'skipped')::int AS skipped
FROM meal_slot_items i
JOIN meal_slots s ON s.id = i.slot_id AND s.removed_at IS NULL
JOIN meal_plan_days d ON d.id = s.day_id AND d.removed_at IS NULL
JOIN meal_plans p ON p.id = d.plan_id AND p.deleted_at IS NULL AND p.status <> 'draft'
LEFT JOIN tracking_entries t ON t.item_id = i.id
WHERE p.patient_id = $1 AND i.removed_at IS NULL AND d.plan_date BETWEEN $2 AND $3
GROUP BY d.plan_date
ORDER BY d.plan_date;

-- Pendientes de revisión (para el dashboard).
-- name: CountPendingReview :one
SELECT count(*)::int FROM tracking_entries WHERE needs_review;
