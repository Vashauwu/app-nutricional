-- Operaciones de plataforma: se ejecutan con tenant.Bypass y SIEMPRE filtran por consulta de forma explícita.

-- name: PlatformListAccounts :many
SELECT p.id, p.name, p.status, p.suspended_reason, p.created_at,
       s.plan, s.status AS sub_status, s.billing_period, s.trial_ends_at, s.grace_until, s.current_period_end, s.comp_reason,
       s.cancel_at_period_end, s.provider IS NOT NULL AS has_provider,
       COALESCE((SELECT u.email FROM users u JOIN user_role_assignments ura ON ura.user_id = u.id JOIN roles r ON r.id = ura.role_id
                 WHERE u.practice_id = p.id AND r.code = 'nutritionist' ORDER BY u.created_at LIMIT 1), '')::text AS owner_email,
       (SELECT count(*) FROM patients pa WHERE pa.practice_id = p.id AND pa.deleted_at IS NULL AND pa.status <> 'inactive')::bigint AS active_patients,
       count(*) OVER ()::bigint AS total
FROM practices p JOIN subscriptions s ON s.practice_id = p.id
WHERE (sqlc.arg(search)::text = '' OR p.name ILIKE '%' || sqlc.arg(search)::text || '%' ESCAPE '\'
       OR EXISTS (SELECT 1 FROM users u WHERE u.practice_id = p.id AND u.email ILIKE '%' || sqlc.arg(search)::text || '%' ESCAPE '\'))
  AND (sqlc.arg(plan)::text = '' OR s.plan = sqlc.arg(plan)::text)
  AND (sqlc.arg(practice_status)::text = '' OR p.status = sqlc.arg(practice_status)::text)
ORDER BY p.created_at DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: PlatformGetAccount :one
SELECT p.id, p.name, p.status, p.suspended_reason, p.suspended_at, p.created_at,
       s.plan, s.status AS sub_status, s.billing_period, s.trial_ends_at, s.grace_until, s.current_period_end, s.comp_reason,
       s.cancel_at_period_end, s.trial_used, s.provider, s.card_brand, s.card_last4,
       COALESCE((SELECT u.email FROM users u JOIN user_role_assignments ura ON ura.user_id = u.id JOIN roles r ON r.id = ura.role_id
                 WHERE u.practice_id = p.id AND r.code = 'nutritionist' ORDER BY u.created_at LIMIT 1), '')::text AS owner_email,
       (SELECT count(*) FROM patients pa WHERE pa.practice_id = p.id AND pa.deleted_at IS NULL AND pa.status <> 'inactive')::bigint AS active_patients,
       (SELECT COALESCE(sum(f.size_bytes), 0) FROM file_objects f WHERE f.practice_id = p.id AND f.deleted_at IS NULL)::bigint AS storage_bytes,
       (SELECT count(*) FROM users u WHERE u.practice_id = p.id)::bigint AS users
FROM practices p JOIN subscriptions s ON s.practice_id = p.id
WHERE p.id = $1;

-- name: PlatformListPayments :many
SELECT * FROM payments WHERE practice_id = $1 ORDER BY occurred_at DESC LIMIT 20;

-- name: PlatformListAudit :many
SELECT a.id, a.action, a.resource_type, a.occurred_at, a.metadata, COALESCE(u.email, '')::text AS actor_email
FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.practice_id = $1 ORDER BY a.occurred_at DESC LIMIT 40;

-- name: PlatformSetPracticeStatus :execrows
UPDATE practices SET status = $2, suspended_at = $3, suspended_reason = $4 WHERE id = $1;

-- name: PlatformRevokePracticeSessions :exec
UPDATE user_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE practice_id = $1);

-- name: PlatformInsertAction :one
INSERT INTO platform_actions (practice_id, kind, params, reason, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: PlatformGetAction :one
SELECT * FROM platform_actions WHERE id = $1;

-- name: PlatformListActions :many
SELECT a.*, p.name AS practice_name, COALESCE(u.email, '')::text AS requester_email
FROM platform_actions a JOIN practices p ON p.id = a.practice_id LEFT JOIN users u ON u.id = a.requested_by
WHERE (sqlc.arg(action_status)::text = '' OR a.status = sqlc.arg(action_status)::text)
ORDER BY a.requested_at DESC LIMIT 100;

-- name: PlatformDecideAction :execrows
-- Solo una solicitud pendiente se puede decidir (dos aprobaciones simultáneas no la ejecutan dos veces).
UPDATE platform_actions SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1 AND status = 'pending';

-- name: PlatformFinishAction :exec
UPDATE platform_actions SET status = $2, executed_at = now(), error = $3 WHERE id = $1;

-- name: GetPracticeStatus :one
SELECT status FROM practices WHERE id = $1;

-- name: GetPayment :one
SELECT * FROM payments WHERE id = $1 AND practice_id = app_practice_id();

-- name: MarkPaymentRefunded :execrows
UPDATE payments SET status = 'refunded' WHERE id = $1 AND practice_id = app_practice_id() AND status = 'paid';
