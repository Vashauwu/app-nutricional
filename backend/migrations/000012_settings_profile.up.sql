-- Perfil profesional de la nutrióloga (sobre ella, especialidad, dónde atiende) como una sección más de la configuración.
ALTER TABLE app_settings DROP CONSTRAINT app_settings_key_check;
ALTER TABLE app_settings ADD CONSTRAINT app_settings_key_check CHECK (key IN ('brand', 'region', 'storage', 'alerts', 'profile'));
