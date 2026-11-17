-- name: GetSubscription :one
SELECT * FROM subscriptions;

-- name: SetSubscriptionPlan :exec
UPDATE subscriptions SET plan = $1, billing_period = $2, status = 'active', updated_at = now();

-- name: CountActivePatients :one
SELECT count(*)::bigint FROM patients WHERE deleted_at IS NULL AND status <> 'inactive';

-- name: PracticeStorageUsed :one
SELECT COALESCE(sum(size_bytes), 0)::bigint FROM file_objects WHERE deleted_at IS NULL;

-- name: ActivateUser :exec
UPDATE users SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'invited';
