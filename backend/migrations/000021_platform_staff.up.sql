-- Equipo propio del CRM: roles finos y permisos separados. Compatible hacia atrás: el rol platform_admin sigue existiendo y
-- conserva todo lo que ya podía hacer (más los permisos nuevos); nadie pierde acceso al migrar.

-- La «consulta de plataforma» aloja a las personas del equipo (no son nutriólogas ni tienen pacientes). Hay una sola y no
-- cuenta como cliente en la lista de cuentas, el resumen ni las métricas.
ALTER TABLE practices ADD COLUMN is_platform boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX practices_one_platform_idx ON practices ((true)) WHERE is_platform;

INSERT INTO permissions (code, description) VALUES
    ('platform:read', 'Ver el panel de plataforma: resumen, cuentas, actividad y solicitudes'),
    ('platform:approve', 'Aprobar o rechazar solicitudes que cuestan dinero'),
    ('platform:staff', 'Administrar al equipo del CRM (invitar, cambiar rol, deshabilitar)'),
    ('platform:landing:edit', 'Editar el borrador de la landing y pedir su publicación'),
    ('platform:landing:publish', 'Aprobar la publicación de la landing');

INSERT INTO roles (code, name, description) VALUES
    ('platform_owner', 'Dueño de la plataforma', 'Todo el CRM: cuentas, aprobaciones, equipo y contenido.'),
    ('platform_support', 'Soporte', 'Ve las cuentas y opera (suspender, pedir cortesías y reembolsos), pero no aprueba.'),
    ('platform_viewer', 'Solo lectura', 'Ve el panel sin poder cambiar nada.'),
    ('platform_content', 'Contenido', 'Edita la landing y pide su publicación; no ve cuentas.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
    ('platform_admin', 'platform:read'), ('platform_admin', 'platform:approve'), ('platform_admin', 'platform:staff'),
    ('platform_admin', 'platform:landing:edit'), ('platform_admin', 'platform:landing:publish'),
    ('platform_owner', 'platform:read'), ('platform_owner', 'platform:accounts'), ('platform_owner', 'platform:approve'),
    ('platform_owner', 'platform:staff'), ('platform_owner', 'platform:landing:edit'), ('platform_owner', 'platform:landing:publish'),
    ('platform_owner', 'smae:manage'),
    ('platform_support', 'platform:read'), ('platform_support', 'platform:accounts'),
    ('platform_viewer', 'platform:read'),
    ('platform_content', 'platform:landing:edit')
) AS m(role_code, perm_code)
JOIN roles r ON r.code = m.role_code JOIN permissions p ON p.code = m.perm_code;
