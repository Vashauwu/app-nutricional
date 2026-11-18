-- CRM de cuentas (fase 1): suspender consultas por abuso, permiso de plataforma y acciones monetarias con aprobación de
-- una segunda persona.

ALTER TABLE practices
    ADD COLUMN suspended_at     timestamptz,
    ADD COLUMN suspended_reason text;

INSERT INTO permissions (code, description) VALUES ('platform:accounts', 'Administrar las cuentas y suscripciones de la plataforma');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'platform_admin' AND p.code = 'platform:accounts';

-- Solicitudes de acciones sobre una cuenta que cuestan dinero (plan de cortesía, prueba extendida, reembolso). Las pide una
-- persona y las aprueba OTRA (cuatro ojos). Solo la plataforma las ve: la política deja pasar únicamente con app_bypass().
CREATE TABLE platform_actions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id   uuid NOT NULL REFERENCES practices (id),
    kind          text NOT NULL CHECK (kind IN ('comp_plan', 'extend_trial', 'refund')),
    params        jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed')),
    requested_by  uuid NOT NULL REFERENCES users (id),
    requested_at  timestamptz NOT NULL DEFAULT now(),
    decided_by    uuid REFERENCES users (id),
    decided_at    timestamptz,
    decision_note text,
    executed_at   timestamptz,
    error         text
);
CREATE INDEX platform_actions_status_idx ON platform_actions (status, requested_at DESC);
CREATE INDEX platform_actions_practice_idx ON platform_actions (practice_id, requested_at DESC);
ALTER TABLE platform_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON platform_actions USING (app_bypass()) WITH CHECK (app_bypass());
GRANT SELECT, INSERT, UPDATE ON platform_actions TO nutri_app;
