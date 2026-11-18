-- name: SetPaymentMethod :exec
UPDATE subscriptions SET card_brand = $1, card_last4 = $2, card_exp_month = $3, card_exp_year = $4, updated_at = now() WHERE practice_id = app_practice_id();

-- name: MarkTrialUsed :exec
UPDATE subscriptions SET trial_used = true, updated_at = now() WHERE practice_id = app_practice_id();

-- name: GetSubscriptionByProviderID :one
-- El proveedor avisa por id de su suscripción, sin saber de consultas: se busca saltando el aislamiento (app_bypass).
SELECT * FROM subscriptions WHERE provider = $1 AND provider_subscription_id = $2;

-- name: InsertPayment :exec
INSERT INTO payments (provider, provider_charge_id, status, amount_mxn, plan, billing_period, failure_reason, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (provider, provider_charge_id) DO UPDATE SET status = EXCLUDED.status, failure_reason = EXCLUDED.failure_reason;

-- name: ListPayments :many
SELECT * FROM payments ORDER BY occurred_at DESC LIMIT 50;

-- name: InsertPaymentEvent :execrows
INSERT INTO payment_events (provider, event_id, event_type, practice_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING;

-- name: ListTrialsEnding :many
-- Pruebas que terminan entre $1 (ahora) y $2 y aún sin aviso previo al primer cobro (se corre saltando el aislamiento).
SELECT practice_id, plan, trial_ends_at FROM subscriptions
WHERE status = 'trialing' AND trial_notice_sent_at IS NULL AND trial_ends_at IS NOT NULL AND trial_ends_at > $1 AND trial_ends_at <= $2;

-- name: MarkTrialNoticeSent :exec
UPDATE subscriptions SET trial_notice_sent_at = now() WHERE practice_id = $1;

-- name: GetPracticeOwnerEmail :one
-- Correo de la nutrióloga titular de la consulta (para avisos de cobro).
SELECT u.email FROM users u
JOIN user_role_assignments ura ON ura.user_id = u.id JOIN roles r ON r.id = ura.role_id
WHERE u.practice_id = $1 AND r.code = 'nutritionist' AND u.status = 'active' ORDER BY u.created_at LIMIT 1;
