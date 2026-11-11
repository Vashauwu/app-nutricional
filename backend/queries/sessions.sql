-- name: CreateSession :one
INSERT INTO user_sessions (user_id, refresh_token_hash, device_label, user_agent, ip, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, user_id, refresh_token_hash, device_label, user_agent, created_at, last_seen_at, expires_at, revoked_at, prev_refresh_token_hash, ip;

-- name: GetSessionByID :one
SELECT id, user_id, refresh_token_hash, device_label, user_agent, created_at, last_seen_at, expires_at, revoked_at, prev_refresh_token_hash, ip
FROM user_sessions
WHERE id = $1;

-- Busca por el hash vigente o por el anterior (para detectar reutilización).
-- name: GetSessionByRefreshHash :one
SELECT id, user_id, refresh_token_hash, device_label, user_agent, created_at, last_seen_at, expires_at, revoked_at, prev_refresh_token_hash, ip
FROM user_sessions
WHERE refresh_token_hash = $1 OR prev_refresh_token_hash = $1
LIMIT 1;

-- name: RotateSessionToken :exec
UPDATE user_sessions
SET prev_refresh_token_hash = refresh_token_hash,
    refresh_token_hash = $2,
    last_seen_at = now(),
    expires_at = $3
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeSession :exec
UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL;

-- name: RevokeSessionByID :exec
UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeOtherSessions :execrows
UPDATE user_sessions SET revoked_at = now()
WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL;

-- name: RevokeAllUserSessions :exec
UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;

-- name: ListActiveSessions :many
SELECT id, user_id, refresh_token_hash, device_label, user_agent, created_at, last_seen_at, expires_at, revoked_at, prev_refresh_token_hash, ip
FROM user_sessions
WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
ORDER BY last_seen_at DESC;

-- name: CreateResetToken :exec
INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3);

-- name: InvalidateUserResetTokens :exec
UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL;

-- Consume el token de un solo uso de forma atómica; devuelve el usuario si era válido.
-- name: ConsumeResetToken :one
UPDATE password_reset_tokens
SET used_at = now()
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
RETURNING user_id;
