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
ORDER BY
  CASE WHEN sqlc.arg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::bool = false THEN lower(p.name) END ASC,
  CASE WHEN sqlc.arg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::bool THEN lower(p.name) END DESC,
  CASE WHEN sqlc.arg(sort_key)::text = 'plan' AND sqlc.arg(sort_desc)::bool = false THEN (CASE s.plan WHEN 'free' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END) END ASC,
  CASE WHEN sqlc.arg(sort_key)::text = 'plan' AND sqlc.arg(sort_desc)::bool THEN (CASE s.plan WHEN 'free' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END) END DESC,
  CASE WHEN sqlc.arg(sort_key)::text = 'patients' AND sqlc.arg(sort_desc)::bool = false THEN (SELECT count(*) FROM patients pa WHERE pa.practice_id = p.id AND pa.deleted_at IS NULL AND pa.status <> 'inactive') END ASC,
  CASE WHEN sqlc.arg(sort_key)::text = 'patients' AND sqlc.arg(sort_desc)::bool THEN (SELECT count(*) FROM patients pa WHERE pa.practice_id = p.id AND pa.deleted_at IS NULL AND pa.status <> 'inactive') END DESC,
  CASE WHEN sqlc.arg(sort_key)::text = 'created' AND sqlc.arg(sort_desc)::bool = false THEN p.created_at END ASC,
  p.created_at DESC
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

-- Bitácora global de la plataforma. Solo eventos operativos (las categorías las fija el servicio): nunca se mezclan datos clínicos.
-- name: PlatformListActivity :many
SELECT a.id, a.action, a.occurred_at, a.metadata, a.practice_id, COALESCE(p.name, '')::text AS practice_name,
       COALESCE(u.email, '')::text AS actor_email, count(*) OVER ()::bigint AS total
FROM audit_logs a
LEFT JOIN practices p ON p.id = a.practice_id
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE split_part(a.action, '.', 1) = ANY(sqlc.arg(categories)::text[])
  AND (sqlc.arg(category)::text = '' OR split_part(a.action, '.', 1) = sqlc.arg(category)::text)
  AND (sqlc.arg(practice)::uuid = '00000000-0000-0000-0000-000000000000'::uuid OR a.practice_id = sqlc.arg(practice)::uuid)
  AND (sqlc.arg(search)::text = '' OR a.action ILIKE '%' || sqlc.arg(search)::text || '%' ESCAPE '\'
       OR p.name ILIKE '%' || sqlc.arg(search)::text || '%' ESCAPE '\' OR u.email ILIKE '%' || sqlc.arg(search)::text || '%' ESCAPE '\')
  AND a.occurred_at >= sqlc.arg(since)::timestamptz
  AND a.occurred_at < sqlc.arg(until)::timestamptz
ORDER BY a.occurred_at DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: PlatformSetPracticeStatus :execrows
UPDATE practices SET status = $2, suspended_at = $3, suspended_reason = $4 WHERE id = $1;

-- name: PlatformRevokePracticeSessions :exec
UPDATE user_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE practice_id = $1);

-- name: PlatformInsertAction :one
INSERT INTO platform_actions (practice_id, kind, params, reason, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: PlatformGetAction :one
SELECT * FROM platform_actions WHERE id = $1;

-- name: PlatformListActions :many
SELECT a.*, p.name AS practice_name, COALESCE(u.email, '')::text AS requester_email, COALESCE(d.email, '')::text AS decider_email
FROM platform_actions a JOIN practices p ON p.id = a.practice_id LEFT JOIN users u ON u.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by
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

-- Resumen del panel: todas las suscripciones (el estado efectivo se resuelve en Go con plans.Resolve).
-- name: PlatformOverviewSubs :many
SELECT p.id, p.name, p.status, p.created_at,
       s.plan, s.status AS sub_status, s.billing_period, s.trial_ends_at, s.grace_until, s.current_period_end, s.comp_reason,
       COALESCE((SELECT u.email FROM users u JOIN user_role_assignments ura ON ura.user_id = u.id JOIN roles r ON r.id = ura.role_id
                 WHERE u.practice_id = p.id AND r.code = 'nutritionist' ORDER BY u.created_at LIMIT 1), '')::text AS owner_email
FROM practices p JOIN subscriptions s ON s.practice_id = p.id;

-- name: PlatformSignupsByDay :many
SELECT g::date AS day, count(p.id)::bigint AS total
FROM generate_series(sqlc.arg(from_day)::date, sqlc.arg(to_day)::date, interval '1 day') g
LEFT JOIN practices p ON (p.created_at AT TIME ZONE 'America/Mexico_City')::date = g::date
GROUP BY 1 ORDER BY 1;

-- name: PlatformPaymentStats :one
SELECT count(*) FILTER (WHERE status = 'paid')::bigint AS paid_count,
       COALESCE(sum(amount_mxn) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_mxn,
       count(*) FILTER (WHERE status = 'failed')::bigint AS failed_count,
       COALESCE(sum(amount_mxn) FILTER (WHERE status IN ('refunded', 'chargeback')), 0)::bigint AS returned_mxn
FROM payments WHERE occurred_at >= $1;

-- name: PlatformRecentPayments :many
SELECT pa.id, pa.practice_id, p.name AS practice_name, pa.status, pa.amount_mxn, pa.plan, pa.occurred_at
FROM payments pa JOIN practices p ON p.id = pa.practice_id
ORDER BY pa.occurred_at DESC LIMIT 8;

-- name: PlatformUsageTotals :one
SELECT (SELECT count(*) FROM patients WHERE deleted_at IS NULL AND status <> 'inactive')::bigint AS active_patients,
       (SELECT count(*) FROM users)::bigint AS users,
       (SELECT COALESCE(sum(size_bytes), 0) FROM file_objects WHERE deleted_at IS NULL)::bigint AS storage_bytes,
       (SELECT count(*) FROM platform_actions WHERE status = 'pending')::bigint AS pending_actions;
