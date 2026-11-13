-- name: GetUserByEmail :one
SELECT id, email, password_hash, status, last_login_at, created_at, updated_at, display_name
FROM users
WHERE email = $1;

-- name: GetUserByID :one
SELECT id, email, password_hash, status, last_login_at, created_at, updated_at, display_name
FROM users
WHERE id = $1;

-- name: CreateUser :one
INSERT INTO users (email, password_hash, status, display_name)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, status, last_login_at, created_at, updated_at, display_name;

-- name: UpdateUserPassword :exec
-- Establecer contraseña también activa cuentas invitadas.
UPDATE users SET password_hash = $2, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, updated_at = now() WHERE id = $1;

-- name: TouchUserLogin :exec
UPDATE users SET last_login_at = now() WHERE id = $1;

-- name: AssignRoleByCode :exec
INSERT INTO user_role_assignments (user_id, role_id)
SELECT $1, id FROM roles WHERE code = $2
ON CONFLICT DO NOTHING;

-- name: ListRoleCodesForUser :many
SELECT r.code
FROM roles r
JOIN user_role_assignments ura ON ura.role_id = r.id
WHERE ura.user_id = $1
ORDER BY r.code;

-- name: ListPermissionCodesForUser :many
SELECT DISTINCT p.code
FROM permissions p
JOIN role_permissions rp ON rp.permission_id = p.id
JOIN user_role_assignments ura ON ura.role_id = rp.role_id
WHERE ura.user_id = $1
ORDER BY p.code;

-- name: InsertAuditLog :exec
INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, request_id, metadata)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: SetUserStatus :exec
UPDATE users SET status = $2, updated_at = now() WHERE id = $1;
