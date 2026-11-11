-- name: GetSetting :one
SELECT * FROM app_settings WHERE key = $1;

-- name: UpsertSetting :exec
INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();

-- Versiones de un documento legal con el número de aceptaciones vigentes (§4.1).
-- name: ListConsentVersions :many
SELECT d.*, (SELECT count(*) FROM consent_acceptances a WHERE a.consent_document_id = d.id AND a.revoked_at IS NULL) AS acceptances
FROM consent_documents d
WHERE d.document_type = $1
ORDER BY d.version DESC;

-- name: DeactivateConsentType :exec
UPDATE consent_documents SET is_active = false WHERE document_type = $1 AND is_active;

-- name: InsertConsentVersion :one
INSERT INTO consent_documents (document_type, version, title, content, is_active)
VALUES ($1, (SELECT COALESCE(max(version), 0) + 1 FROM consent_documents WHERE document_type = $1), $2, $3, true)
RETURNING *;
