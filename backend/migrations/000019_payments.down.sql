DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS payments;
ALTER TABLE subscriptions
    DROP COLUMN trial_notice_sent_at, DROP COLUMN card_exp_year, DROP COLUMN card_exp_month, DROP COLUMN card_last4,
    DROP COLUMN card_brand, DROP COLUMN trial_used;
