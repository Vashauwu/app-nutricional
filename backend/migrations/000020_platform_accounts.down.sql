DROP TABLE IF EXISTS platform_actions;
DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'platform:accounts');
DELETE FROM permissions WHERE code = 'platform:accounts';
ALTER TABLE practices DROP COLUMN suspended_reason, DROP COLUMN suspended_at;
