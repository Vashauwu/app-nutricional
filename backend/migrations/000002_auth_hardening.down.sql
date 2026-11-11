DELETE FROM role_permissions;
DELETE FROM permissions;
DROP INDEX IF EXISTS user_sessions_prev_hash_idx;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS prev_refresh_token_hash, DROP COLUMN IF EXISTS ip;
ALTER TABLE users DROP COLUMN IF EXISTS display_name;
