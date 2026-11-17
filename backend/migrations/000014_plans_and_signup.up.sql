-- Planes y registro abierto (MVP): suscripción por consulta y permiso del catálogo global solo para la plataforma.

CREATE TABLE subscriptions (
    practice_id        uuid PRIMARY KEY DEFAULT app_practice_id() REFERENCES practices (id),
    plan               text NOT NULL CHECK (plan IN ('free', 'standard', 'pro')),
    billing_period     text CHECK (billing_period IN ('monthly', 'annual')),
    status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled')),
    current_period_end timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO nutri_app;

-- Las consultas que ya existen conservan todo: pasan al plan Pro (sin límites).
INSERT INTO subscriptions (practice_id, plan) SELECT id, 'pro' FROM practices;

-- Alta de una consulta: ahora también abre su suscripción gratuita.
CREATE OR REPLACE FUNCTION create_practice(p_name text) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE pid uuid;
BEGIN
    INSERT INTO practices (name) VALUES (left(btrim(p_name), 120)) RETURNING id INTO pid;
    INSERT INTO subscriptions (practice_id, plan) VALUES (pid, 'free');
    INSERT INTO consent_documents (practice_id, document_type, version, title, content, is_active) VALUES
        (pid, 'privacy', 1, 'Aviso de privacidad', 'Texto marcador del aviso de privacidad. Sustituir por la versión validada por asesoría jurídica antes de producción.', true),
        (pid, 'informed', 1, 'Consentimiento informado', 'Texto marcador del consentimiento informado para la atención nutricional. Sustituir por la versión validada antes de producción.', true);
    RETURN pid;
END
$fn$;

-- El catálogo SMAE es global: importar ediciones es cosa de la plataforma, no de cada nutrióloga.
INSERT INTO roles (code, name, description) VALUES
    ('platform_admin', 'Administración de la plataforma', 'Administra el catálogo SMAE global.');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'platform_admin' AND p.code = 'smae:manage';
DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE code = 'nutritionist')
  AND permission_id = (SELECT id FROM permissions WHERE code = 'smae:manage');
-- Quien ya administraba el catálogo lo sigue haciendo.
INSERT INTO user_role_assignments (user_id, role_id)
SELECT ura.user_id, (SELECT id FROM roles WHERE code = 'platform_admin')
FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id WHERE r.code = 'nutritionist';
