-- Deshace el aislamiento. Los datos de TODAS las consultas quedan en una sola instalación: úsese solo en desarrollo
-- o antes de que exista más de una consulta.
DO $$
DECLARE
    t text;
    tenant_tables text[] := ARRAY[
        'patients', 'patient_measurements', 'patient_conditions', 'patient_allergies', 'patient_medications',
        'patient_food_preferences', 'patient_notes', 'consent_documents', 'consent_acceptances',
        'custom_foods', 'custom_food_portions', 'dishes', 'dish_versions', 'dish_ingredients',
        'dish_nutrition_snapshots', 'dish_substitutions', 'smae_recalc_batches', 'smae_recalc_decisions',
        'meal_plans', 'meal_plan_days', 'meal_slots', 'meal_slot_items', 'meal_plan_revisions',
        'meal_plan_publications', 'meal_plan_events', 'meal_plan_templates', 'app_settings', 'file_objects',
        'patient_documents', 'tracking_entries', 'tracking_photos', 'meal_comments', 'patient_lab_reports',
        'patient_lab_results', 'appointments', 'calendar_feeds', 'patient_menstrual_records', 'patient_pregnancies',
        'diet_calculations', 'audit_logs'];
BEGIN
    DROP INDEX patients_email_active_idx;
    ALTER TABLE consent_documents DROP CONSTRAINT consent_documents_practice_type_version_key;
    DROP INDEX consent_documents_one_active_idx;
    ALTER TABLE app_settings DROP CONSTRAINT app_settings_pkey;

    FOREACH t IN ARRAY tenant_tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I DROP COLUMN practice_id', t);
    END LOOP;
END
$$;
CREATE UNIQUE INDEX patients_email_active_idx ON patients (email) WHERE deleted_at IS NULL;
ALTER TABLE consent_documents ADD CONSTRAINT consent_documents_document_type_version_key UNIQUE (document_type, version);
CREATE UNIQUE INDEX consent_documents_one_active_idx ON consent_documents (document_type) WHERE is_active;
ALTER TABLE app_settings ADD PRIMARY KEY (key);

DROP FUNCTION create_practice(text);
ALTER TABLE users DROP COLUMN practice_id;
DROP TABLE practices;
DROP FUNCTION app_bypass();
DROP FUNCTION app_practice_id();
