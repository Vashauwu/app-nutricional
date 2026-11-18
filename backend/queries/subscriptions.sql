-- name: GetSubscription :one
-- Siempre filtra por la consulta del contexto: la CLI se conecta como propietario y se salta la seguridad por filas.
SELECT * FROM subscriptions WHERE practice_id = app_practice_id();

-- name: ApplySubscription :execrows
-- Una fila por consulta (RLS): fija el estado completo de la suscripción.
UPDATE subscriptions SET plan = $1, billing_period = $2, status = $3, trial_ends_at = $4, grace_until = $5,
    current_period_end = $6, cancel_at_period_end = $7, pending_plan = $8, comp_reason = $9, updated_at = now()
WHERE practice_id = app_practice_id();

-- name: SetSubscriptionProvider :exec
UPDATE subscriptions SET provider = $1, provider_customer_id = $2, provider_subscription_id = $3, updated_at = now() WHERE practice_id = app_practice_id();

-- name: CountActivePatients :one
SELECT count(*)::bigint FROM patients WHERE deleted_at IS NULL AND status <> 'inactive';

-- name: PracticeStorageUsed :one
SELECT COALESCE(sum(size_bytes), 0)::bigint FROM file_objects WHERE deleted_at IS NULL;

-- name: ActivateUser :exec
UPDATE users SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'invited';
