INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'nutritionist' AND p.code = 'smae:manage' ON CONFLICT DO NOTHING;
DELETE FROM user_role_assignments WHERE role_id = (SELECT id FROM roles WHERE code = 'platform_admin');
DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'platform_admin');
DELETE FROM roles WHERE code = 'platform_admin';
CREATE OR REPLACE FUNCTION create_practice(p_name text) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE pid uuid;
BEGIN
    INSERT INTO practices (name) VALUES (left(btrim(p_name), 120)) RETURNING id INTO pid;
    INSERT INTO consent_documents (practice_id, document_type, version, title, content, is_active) VALUES
        (pid, 'privacy', 1, 'Aviso de privacidad', 'Texto marcador del aviso de privacidad. Sustituir por la versión validada por asesoría jurídica antes de producción.', true),
        (pid, 'informed', 1, 'Consentimiento informado', 'Texto marcador del consentimiento informado para la atención nutricional. Sustituir por la versión validada antes de producción.', true);
    RETURN pid;
END
$fn$;
DROP TABLE subscriptions;
