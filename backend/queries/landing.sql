-- Landing gestionada desde el CRM. Todas se ejecutan con tenant.Bypass (tabla global de la plataforma).

-- name: LandingFind :one
-- Una versión: la abierta (borrador o pendiente), la publicada o una por número.
SELECT v.*, COALESCE(r.email, '')::text AS requester_email, COALESCE(d.email, '')::text AS decider_email
FROM landing_versions v
LEFT JOIN users r ON r.id = v.requested_by
LEFT JOIN users d ON d.id = v.decided_by
WHERE (sqlc.arg(open_one)::bool AND v.status IN ('draft', 'pending'))
   OR (sqlc.arg(published_one)::bool AND v.status = 'published')
   OR (sqlc.arg(by_number)::int > 0 AND v.number = sqlc.arg(by_number)::int)
LIMIT 1;

-- name: LandingListVersions :many
SELECT v.id, v.number, v.status, COALESCE(v.reason, '')::text AS reason, v.requested_at, v.decided_at, COALESCE(v.decision_note, '')::text AS decision_note, v.published_at,
       COALESCE(r.email, '')::text AS requester_email, COALESCE(d.email, '')::text AS decider_email
FROM landing_versions v
LEFT JOIN users r ON r.id = v.requested_by
LEFT JOIN users d ON d.id = v.decided_by
WHERE v.number IS NOT NULL
ORDER BY v.number DESC LIMIT 50;

-- name: LandingInsertDraft :one
INSERT INTO landing_versions (status, content, base_number, created_by) VALUES ('draft', $1, $2, $3) RETURNING *;

-- Guardar el borrador borra el último rechazo: ya es otro texto.
-- name: LandingUpdateDraft :one
UPDATE landing_versions SET content = $2, base_number = $3, decided_by = NULL, decided_at = NULL, decision_note = NULL, updated_at = now()
WHERE id = $1 AND status = 'draft' RETURNING *;

-- name: LandingDeleteDraft :execrows
DELETE FROM landing_versions WHERE status = 'draft';

-- name: LandingRequest :one
UPDATE landing_versions SET status = 'pending', reason = $2, requested_by = $3, requested_at = now(), decided_by = NULL, decided_at = NULL, decision_note = NULL, updated_at = now()
WHERE id = $1 AND status = 'draft' RETURNING *;

-- name: LandingWithdraw :one
UPDATE landing_versions SET status = 'draft', updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *;

-- name: LandingReject :one
UPDATE landing_versions SET status = 'draft', decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now()
WHERE id = $1 AND status = 'pending' RETURNING *;

-- name: LandingSupersedePublished :exec
UPDATE landing_versions SET status = 'superseded', updated_at = now() WHERE status = 'published';

-- name: LandingNextNumber :one
SELECT (COALESCE(max(number), 0) + 1)::int FROM landing_versions;

-- name: LandingPublish :one
UPDATE landing_versions SET status = 'published', number = $2, decided_by = $3, decided_at = now(), decision_note = $4, published_at = now(), updated_at = now()
WHERE id = $1 AND status = 'pending' RETURNING *;
