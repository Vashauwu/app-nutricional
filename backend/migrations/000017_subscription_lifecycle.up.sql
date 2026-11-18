-- M2/M4: ciclo de vida de la suscripción (prueba, gracia, baja al gratuito) y datos del proveedor de cobro.
-- Nada se borra al bajar de plan: el plan vigente se calcula al consultar (ver internal/plans/lifecycle.go).

ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired'));

ALTER TABLE subscriptions
    ADD COLUMN trial_ends_at           timestamptz,
    -- Fin del periodo de gracia tras un cobro fallido.
    ADD COLUMN grace_until             timestamptz,
    -- Cancelada: conserva el plan hasta current_period_end y después pasa a Gratuito.
    ADD COLUMN cancel_at_period_end    boolean NOT NULL DEFAULT false,
    -- Bajada de plan programada para el siguiente periodo.
    ADD COLUMN pending_plan            text CHECK (pending_plan IN ('free', 'standard', 'pro')),
    ADD COLUMN provider                text,
    ADD COLUMN provider_customer_id    text,
    ADD COLUMN provider_subscription_id text,
    -- Plan concedido sin cobro (cuenta fundadora, cortesía): no vence por falta de pago.
    ADD COLUMN comp_reason             text;

-- Las consultas que existían al abrirse los planes son las fundadoras.
UPDATE subscriptions SET comp_reason = 'cuenta fundadora' WHERE plan = 'pro';

CREATE UNIQUE INDEX subscriptions_provider_sub_idx ON subscriptions (provider, provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
