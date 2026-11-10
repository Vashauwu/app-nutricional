-- name: GetUserByEmail :one
SELECT id, email, password_hash, status, last_login_at, created_at, updated_at
FROM users
WHERE email = $1;

-- name: GetUserByID :one
SELECT id, email, password_hash, status, last_login_at, created_at, updated_at
FROM users
WHERE id = $1;

-- name: ListRoleCodesForUser :many
SELECT r.code
FROM roles r
JOIN user_role_assignments ura ON ura.role_id = r.id
WHERE ura.user_id = $1
ORDER BY r.code;

-- name: InsertAuditLog :exec
INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, request_id, metadata)
VALUES ($1, $2, $3, $4, $5, $6);
