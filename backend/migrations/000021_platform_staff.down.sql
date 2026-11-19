DELETE FROM user_role_assignments WHERE role_id IN (SELECT id FROM roles WHERE code IN ('platform_owner', 'platform_support', 'platform_viewer', 'platform_content'));
DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code IN ('platform_owner', 'platform_support', 'platform_viewer', 'platform_content'))
    OR permission_id IN (SELECT id FROM permissions WHERE code IN ('platform:read', 'platform:approve', 'platform:staff', 'platform:landing:edit', 'platform:landing:publish'));
DELETE FROM roles WHERE code IN ('platform_owner', 'platform_support', 'platform_viewer', 'platform_content');
DELETE FROM permissions WHERE code IN ('platform:read', 'platform:approve', 'platform:staff', 'platform:landing:edit', 'platform:landing:publish');
DROP INDEX IF EXISTS practices_one_platform_idx;
ALTER TABLE practices DROP COLUMN is_platform;
