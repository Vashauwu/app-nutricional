-- name: InsertFile :one
INSERT INTO file_objects (storage_key, thumb_key, kind, visibility, mime_type, size_bytes, width, height, checksum, owner_patient_id, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetFile :one
SELECT * FROM file_objects WHERE id = $1 AND deleted_at IS NULL;

-- name: SoftDeleteFile :exec
UPDATE file_objects SET deleted_at = now() WHERE id = $1;

-- Espacio usado por un paciente (archivos vigentes); size_bytes incluye la miniatura.
-- name: PatientStorageUsed :one
SELECT COALESCE(sum(size_bytes), 0)::bigint FROM file_objects WHERE owner_patient_id = $1 AND deleted_at IS NULL;

-- name: InsertDocument :one
INSERT INTO patient_documents (patient_id, file_object_id, name, category, description, document_date, visible_to_patient, scan_status, uploaded_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetDocument :one
SELECT * FROM patient_documents WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL;

-- name: ListDocuments :many
SELECT d.*, f.size_bytes
FROM patient_documents d JOIN file_objects f ON f.id = d.file_object_id
WHERE d.patient_id = $1 AND d.deleted_at IS NULL AND (sqlc.arg(only_visible)::bool = false OR (d.visible_to_patient AND d.scan_status = 'clean'))
ORDER BY d.uploaded_at DESC;

-- name: UpdateDocument :one
UPDATE patient_documents SET name = $3, category = $4, description = $5, document_date = $6, visible_to_patient = $7
WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteDocument :one
UPDATE patient_documents SET deleted_at = now() WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL RETURNING file_object_id;

-- Autorización de descarga: ¿de quién es el archivo y quién puede verlo?
-- name: DocumentAccessByFile :one
SELECT patient_id, visible_to_patient, scan_status FROM patient_documents WHERE file_object_id = $1 AND deleted_at IS NULL;

-- name: TrackingPhotoOwner :one
SELECT e.patient_id FROM tracking_photos p JOIN tracking_entries e ON e.id = p.entry_id WHERE p.file_object_id = $1;
