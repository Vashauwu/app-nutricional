-- Endurecimiento de autenticación (§5) y permisos RBAC iniciales (§2.2).

ALTER TABLE users ADD COLUMN display_name text NOT NULL DEFAULT '';

-- Rotación de refresh tokens con detección de reutilización: se guarda el hash
-- del token anterior; si alguien lo presenta de nuevo, la sesión se revoca.
ALTER TABLE user_sessions
    ADD COLUMN prev_refresh_token_hash bytea,
    ADD COLUMN ip text NOT NULL DEFAULT '';
CREATE INDEX user_sessions_prev_hash_idx ON user_sessions (prev_refresh_token_hash)
    WHERE prev_refresh_token_hash IS NOT NULL;

INSERT INTO permissions (code, description) VALUES
    ('patients:manage',      'Crear, editar, desactivar y restaurar pacientes y expedientes'),
    ('patients:read_own',    'Consultar el propio expediente autorizado'),
    ('dishes:manage',        'Gestionar la biblioteca de platillos y recetas'),
    ('smae:manage',          'Administrar el catálogo SMAE y alimentos personalizados'),
    ('mealplans:manage',     'Crear, editar y publicar planes alimentarios'),
    ('mealplans:read_own',   'Consultar los propios planes publicados'),
    ('tracking:review',      'Revisar seguimiento y responder comentarios'),
    ('tracking:write_own',   'Registrar comidas, fotos y comentarios propios'),
    ('reports:read',         'Consultar y exportar reportes'),
    ('settings:manage',      'Configurar marca, cuotas, alertas y consentimientos'),
    ('audit:read',           'Consultar la auditoría interna');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'nutritionist' AND p.code IN
    ('patients:manage','dishes:manage','smae:manage','mealplans:manage','tracking:review','reports:read','settings:manage','audit:read');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'patient' AND p.code IN ('patients:read_own','mealplans:read_own','tracking:write_own');
