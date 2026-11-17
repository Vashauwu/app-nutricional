DROP INDEX IF EXISTS subscriptions_provider_sub_idx;
ALTER TABLE subscriptions
    DROP COLUMN comp_reason, DROP COLUMN provider_subscription_id, DROP COLUMN provider_customer_id, DROP COLUMN provider,
    DROP COLUMN pending_plan, DROP COLUMN cancel_at_period_end, DROP COLUMN grace_until, DROP COLUMN trial_ends_at;
UPDATE subscriptions SET status = 'canceled' WHERE status IN ('trialing', 'expired');
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('active', 'past_due', 'canceled'));
