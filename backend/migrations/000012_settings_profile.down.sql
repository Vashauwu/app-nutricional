DELETE FROM app_settings WHERE key = 'profile';
ALTER TABLE app_settings DROP CONSTRAINT app_settings_key_check;
ALTER TABLE app_settings ADD CONSTRAINT app_settings_key_check CHECK (key IN ('brand', 'region', 'storage', 'alerts'));
