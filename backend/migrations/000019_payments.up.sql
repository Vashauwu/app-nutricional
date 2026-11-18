-- M4: cobro. La tarjeta nunca toca el servidor: aquí solo se guarda lo que el proveedor devuelve para mostrarla
-- (marca, últimos 4 y vigencia). El estado de la suscripción cambia por la respuesta del proveedor o por sus eventos firmados.

ALTER TABLE subscriptions
    ADD COLUMN trial_used           boolean NOT NULL DEFAULT false,
    ADD COLUMN card_brand           text,
    ADD COLUMN card_last4           text,
    ADD COLUMN card_exp_month       integer,
    ADD COLUMN card_exp_year        integer,
    ADD COLUMN trial_notice_sent_at timestamptz;

-- Historial de cobros de la consulta.
CREATE TABLE payments (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id        uuid NOT NULL DEFAULT app_practice_id() REFERENCES practices (id),
    provider           text NOT NULL,
    provider_charge_id text NOT NULL,
    status             text NOT NULL CHECK (status IN ('paid', 'failed', 'refunded', 'chargeback')),
    amount_mxn         integer NOT NULL CHECK (amount_mxn >= 0),
    plan               text NOT NULL CHECK (plan IN ('free', 'standard', 'pro')),
    billing_period     text CHECK (billing_period IN ('monthly', 'annual')),
    failure_reason     text,
    occurred_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_charge_id)
);
CREATE INDEX payments_practice_idx ON payments (practice_id, occurred_at DESC);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
GRANT SELECT, INSERT, UPDATE ON payments TO nutri_app;

-- Eventos del proveedor ya procesados (idempotencia: un reintento no repite el efecto).
CREATE TABLE payment_events (
    provider    text NOT NULL,
    event_id    text NOT NULL,
    event_type  text NOT NULL,
    practice_id uuid REFERENCES practices (id),
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, event_id)
);
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_events USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
GRANT SELECT, INSERT ON payment_events TO nutri_app;
