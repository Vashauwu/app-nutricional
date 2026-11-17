-- M1: cuentas aisladas. Cada consulta (nutrióloga y sus pacientes) tiene su propio espacio de datos.
-- El aislamiento lo impone PostgreSQL con seguridad por filas (RLS): una fila solo es visible y escribible desde la
-- sesión de su consulta (`app.practice_id`), que el servicio fija al tomar cada conexión (internal/tenant).
-- NO se pierde ni se mueve ningún dato: toda la información existente queda en la consulta #1.
-- (Las sentencias son explícitas, una por tabla, para que sqlc conozca la columna nueva en cada una.)

CREATE TABLE practices (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Consulta de la sesión actual (NULL si no hay: la base no deja pasar ninguna fila) y bandera de plataforma.
CREATE FUNCTION app_practice_id() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.practice_id', true), '')::uuid $$;

CREATE FUNCTION app_bypass() RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT COALESCE(current_setting('app.bypass', true), '') = 'on' $$;

-- Consulta #1: lo que hoy existe. Toma el nombre comercial guardado, si lo hay.
INSERT INTO practices (name)
VALUES (COALESCE((SELECT left(value->>'business_name', 120) FROM app_settings WHERE key = 'brand'), 'Consulta principal'));

-- Usuarios (nutriólogas y pacientes con acceso): todos a la consulta #1.
ALTER TABLE users ADD COLUMN practice_id uuid REFERENCES practices (id);
UPDATE users SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE users ALTER COLUMN practice_id SET NOT NULL;
CREATE INDEX users_practice_idx ON users (practice_id);

-- patients
ALTER TABLE patients ADD COLUMN practice_id uuid;
ALTER TABLE patients DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patients SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patients ENABLE TRIGGER USER;
ALTER TABLE patients ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patients ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patients ADD CONSTRAINT patients_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patients_practice_idx ON patients (practice_id);
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patients USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_measurements
ALTER TABLE patient_measurements ADD COLUMN practice_id uuid;
ALTER TABLE patient_measurements DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_measurements SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_measurements ENABLE TRIGGER USER;
ALTER TABLE patient_measurements ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_measurements ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_measurements ADD CONSTRAINT patient_measurements_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_measurements_practice_idx ON patient_measurements (practice_id);
ALTER TABLE patient_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_measurements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_measurements USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_conditions
ALTER TABLE patient_conditions ADD COLUMN practice_id uuid;
ALTER TABLE patient_conditions DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_conditions SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_conditions ENABLE TRIGGER USER;
ALTER TABLE patient_conditions ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_conditions ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_conditions ADD CONSTRAINT patient_conditions_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_conditions_practice_idx ON patient_conditions (practice_id);
ALTER TABLE patient_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_conditions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_conditions USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_allergies
ALTER TABLE patient_allergies ADD COLUMN practice_id uuid;
ALTER TABLE patient_allergies DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_allergies SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_allergies ENABLE TRIGGER USER;
ALTER TABLE patient_allergies ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_allergies ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_allergies ADD CONSTRAINT patient_allergies_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_allergies_practice_idx ON patient_allergies (practice_id);
ALTER TABLE patient_allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_allergies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_allergies USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_medications
ALTER TABLE patient_medications ADD COLUMN practice_id uuid;
ALTER TABLE patient_medications DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_medications SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_medications ENABLE TRIGGER USER;
ALTER TABLE patient_medications ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_medications ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_medications ADD CONSTRAINT patient_medications_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_medications_practice_idx ON patient_medications (practice_id);
ALTER TABLE patient_medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_medications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_medications USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_food_preferences
ALTER TABLE patient_food_preferences ADD COLUMN practice_id uuid;
ALTER TABLE patient_food_preferences DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_food_preferences SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_food_preferences ENABLE TRIGGER USER;
ALTER TABLE patient_food_preferences ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_food_preferences ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_food_preferences ADD CONSTRAINT patient_food_preferences_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_food_preferences_practice_idx ON patient_food_preferences (practice_id);
ALTER TABLE patient_food_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_food_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_food_preferences USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_notes
ALTER TABLE patient_notes ADD COLUMN practice_id uuid;
ALTER TABLE patient_notes DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_notes SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_notes ENABLE TRIGGER USER;
ALTER TABLE patient_notes ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_notes ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_notes ADD CONSTRAINT patient_notes_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_notes_practice_idx ON patient_notes (practice_id);
ALTER TABLE patient_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_notes USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- consent_documents
ALTER TABLE consent_documents ADD COLUMN practice_id uuid;
ALTER TABLE consent_documents DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE consent_documents SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE consent_documents ENABLE TRIGGER USER;
ALTER TABLE consent_documents ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE consent_documents ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE consent_documents ADD CONSTRAINT consent_documents_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX consent_documents_practice_idx ON consent_documents (practice_id);
ALTER TABLE consent_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_documents USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- consent_acceptances
ALTER TABLE consent_acceptances ADD COLUMN practice_id uuid;
ALTER TABLE consent_acceptances DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE consent_acceptances SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE consent_acceptances ENABLE TRIGGER USER;
ALTER TABLE consent_acceptances ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE consent_acceptances ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE consent_acceptances ADD CONSTRAINT consent_acceptances_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX consent_acceptances_practice_idx ON consent_acceptances (practice_id);
ALTER TABLE consent_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_acceptances USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- custom_foods
ALTER TABLE custom_foods ADD COLUMN practice_id uuid;
ALTER TABLE custom_foods DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE custom_foods SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE custom_foods ENABLE TRIGGER USER;
ALTER TABLE custom_foods ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE custom_foods ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE custom_foods ADD CONSTRAINT custom_foods_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX custom_foods_practice_idx ON custom_foods (practice_id);
ALTER TABLE custom_foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_foods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_foods USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- custom_food_portions
ALTER TABLE custom_food_portions ADD COLUMN practice_id uuid;
ALTER TABLE custom_food_portions DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE custom_food_portions SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE custom_food_portions ENABLE TRIGGER USER;
ALTER TABLE custom_food_portions ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE custom_food_portions ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE custom_food_portions ADD CONSTRAINT custom_food_portions_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX custom_food_portions_practice_idx ON custom_food_portions (practice_id);
ALTER TABLE custom_food_portions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_food_portions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_food_portions USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- dishes
ALTER TABLE dishes ADD COLUMN practice_id uuid;
ALTER TABLE dishes DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE dishes SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE dishes ENABLE TRIGGER USER;
ALTER TABLE dishes ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE dishes ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE dishes ADD CONSTRAINT dishes_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX dishes_practice_idx ON dishes (practice_id);
ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dishes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dishes USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- dish_versions
ALTER TABLE dish_versions ADD COLUMN practice_id uuid;
ALTER TABLE dish_versions DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE dish_versions SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE dish_versions ENABLE TRIGGER USER;
ALTER TABLE dish_versions ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE dish_versions ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE dish_versions ADD CONSTRAINT dish_versions_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX dish_versions_practice_idx ON dish_versions (practice_id);
ALTER TABLE dish_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dish_versions USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- dish_ingredients
ALTER TABLE dish_ingredients ADD COLUMN practice_id uuid;
ALTER TABLE dish_ingredients DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE dish_ingredients SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE dish_ingredients ENABLE TRIGGER USER;
ALTER TABLE dish_ingredients ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE dish_ingredients ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE dish_ingredients ADD CONSTRAINT dish_ingredients_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX dish_ingredients_practice_idx ON dish_ingredients (practice_id);
ALTER TABLE dish_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_ingredients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dish_ingredients USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- dish_nutrition_snapshots
ALTER TABLE dish_nutrition_snapshots ADD COLUMN practice_id uuid;
ALTER TABLE dish_nutrition_snapshots DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE dish_nutrition_snapshots SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE dish_nutrition_snapshots ENABLE TRIGGER USER;
ALTER TABLE dish_nutrition_snapshots ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE dish_nutrition_snapshots ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE dish_nutrition_snapshots ADD CONSTRAINT dish_nutrition_snapshots_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX dish_nutrition_snapshots_practice_idx ON dish_nutrition_snapshots (practice_id);
ALTER TABLE dish_nutrition_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_nutrition_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dish_nutrition_snapshots USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- dish_substitutions
ALTER TABLE dish_substitutions ADD COLUMN practice_id uuid;
ALTER TABLE dish_substitutions DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE dish_substitutions SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE dish_substitutions ENABLE TRIGGER USER;
ALTER TABLE dish_substitutions ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE dish_substitutions ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE dish_substitutions ADD CONSTRAINT dish_substitutions_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX dish_substitutions_practice_idx ON dish_substitutions (practice_id);
ALTER TABLE dish_substitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_substitutions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dish_substitutions USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- smae_recalc_batches
ALTER TABLE smae_recalc_batches ADD COLUMN practice_id uuid;
ALTER TABLE smae_recalc_batches DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE smae_recalc_batches SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE smae_recalc_batches ENABLE TRIGGER USER;
ALTER TABLE smae_recalc_batches ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE smae_recalc_batches ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE smae_recalc_batches ADD CONSTRAINT smae_recalc_batches_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX smae_recalc_batches_practice_idx ON smae_recalc_batches (practice_id);
ALTER TABLE smae_recalc_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE smae_recalc_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON smae_recalc_batches USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- smae_recalc_decisions
ALTER TABLE smae_recalc_decisions ADD COLUMN practice_id uuid;
ALTER TABLE smae_recalc_decisions DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE smae_recalc_decisions SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE smae_recalc_decisions ENABLE TRIGGER USER;
ALTER TABLE smae_recalc_decisions ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE smae_recalc_decisions ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE smae_recalc_decisions ADD CONSTRAINT smae_recalc_decisions_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX smae_recalc_decisions_practice_idx ON smae_recalc_decisions (practice_id);
ALTER TABLE smae_recalc_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE smae_recalc_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON smae_recalc_decisions USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- meal_plans
ALTER TABLE meal_plans ADD COLUMN practice_id uuid;
ALTER TABLE meal_plans DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE meal_plans SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE meal_plans ENABLE TRIGGER USER;
ALTER TABLE meal_plans ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE meal_plans ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE meal_plans ADD CONSTRAINT meal_plans_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX meal_plans_practice_idx ON meal_plans (practice_id);
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meal_plans USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- meal_plan_days
ALTER TABLE meal_plan_days ADD COLUMN practice_id uuid;
ALTER TABLE meal_plan_days DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE meal_plan_days SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE meal_plan_days ENABLE TRIGGER USER;
ALTER TABLE meal_plan_days ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE meal_plan_days ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE meal_plan_days ADD CONSTRAINT meal_plan_days_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX meal_plan_days_practice_idx ON meal_plan_days (practice_id);
ALTER TABLE meal_plan_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_days FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meal_plan_days USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- meal_slots
ALTER TABLE meal_slots ADD COLUMN practice_id uuid;
ALTER TABLE meal_slots DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE meal_slots SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE meal_slots ENABLE TRIGGER USER;
ALTER TABLE meal_slots ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE meal_slots ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE meal_slots ADD CONSTRAINT meal_slots_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX meal_slots_practice_idx ON meal_slots (practice_id);
ALTER TABLE meal_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meal_slots USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- meal_slot_items
ALTER TABLE meal_slot_items ADD COLUMN practice_id uuid;
ALTER TABLE meal_slot_items DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE meal_slot_items SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE meal_slot_items ENABLE TRIGGER USER;
ALTER TABLE meal_slot_items ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE meal_slot_items ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE meal_slot_items ADD CONSTRAINT meal_slot_items_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX meal_slot_items_practice_idx ON meal_slot_items (practice_id);
ALTER TABLE meal_slot_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_slot_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meal_slot_items USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- meal_plan_revisions
ALTER TABLE meal_plan_revisions ADD COLUMN practice_id uuid;
ALTER TABLE meal_plan_revisions DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE meal_plan_revisions SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE meal_plan_revisions ENABLE TRIGGER USER;
ALTER TABLE meal_plan_revisions ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE meal_plan_revisions ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE meal_plan_revisions ADD CONSTRAINT meal_plan_revisions_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX meal_plan_revisions_practice_idx ON meal_plan_revisions (practice_id);
ALTER TABLE meal_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meal_plan_revisions USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- meal_plan_publications
ALTER TABLE meal_plan_publications ADD COLUMN practice_id uuid;
ALTER TABLE meal_plan_publications DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE meal_plan_publications SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE meal_plan_publications ENABLE TRIGGER USER;
ALTER TABLE meal_plan_publications ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE meal_plan_publications ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE meal_plan_publications ADD CONSTRAINT meal_plan_publications_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX meal_plan_publications_practice_idx ON meal_plan_publications (practice_id);
ALTER TABLE meal_plan_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meal_plan_publications USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- meal_plan_events
ALTER TABLE meal_plan_events ADD COLUMN practice_id uuid;
ALTER TABLE meal_plan_events DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE meal_plan_events SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE meal_plan_events ENABLE TRIGGER USER;
ALTER TABLE meal_plan_events ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE meal_plan_events ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE meal_plan_events ADD CONSTRAINT meal_plan_events_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX meal_plan_events_practice_idx ON meal_plan_events (practice_id);
ALTER TABLE meal_plan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meal_plan_events USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- meal_plan_templates
ALTER TABLE meal_plan_templates ADD COLUMN practice_id uuid;
ALTER TABLE meal_plan_templates DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE meal_plan_templates SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE meal_plan_templates ENABLE TRIGGER USER;
ALTER TABLE meal_plan_templates ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE meal_plan_templates ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE meal_plan_templates ADD CONSTRAINT meal_plan_templates_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX meal_plan_templates_practice_idx ON meal_plan_templates (practice_id);
ALTER TABLE meal_plan_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meal_plan_templates USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- app_settings
ALTER TABLE app_settings ADD COLUMN practice_id uuid;
ALTER TABLE app_settings DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE app_settings SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE app_settings ENABLE TRIGGER USER;
ALTER TABLE app_settings ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE app_settings ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE app_settings ADD CONSTRAINT app_settings_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX app_settings_practice_idx ON app_settings (practice_id);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app_settings USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- file_objects
ALTER TABLE file_objects ADD COLUMN practice_id uuid;
ALTER TABLE file_objects DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE file_objects SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE file_objects ENABLE TRIGGER USER;
ALTER TABLE file_objects ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE file_objects ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE file_objects ADD CONSTRAINT file_objects_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX file_objects_practice_idx ON file_objects (practice_id);
ALTER TABLE file_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON file_objects USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_documents
ALTER TABLE patient_documents ADD COLUMN practice_id uuid;
ALTER TABLE patient_documents DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_documents SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_documents ENABLE TRIGGER USER;
ALTER TABLE patient_documents ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_documents ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_documents ADD CONSTRAINT patient_documents_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_documents_practice_idx ON patient_documents (practice_id);
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_documents USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- tracking_entries
ALTER TABLE tracking_entries ADD COLUMN practice_id uuid;
ALTER TABLE tracking_entries DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE tracking_entries SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE tracking_entries ENABLE TRIGGER USER;
ALTER TABLE tracking_entries ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE tracking_entries ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE tracking_entries ADD CONSTRAINT tracking_entries_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX tracking_entries_practice_idx ON tracking_entries (practice_id);
ALTER TABLE tracking_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tracking_entries USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- tracking_photos
ALTER TABLE tracking_photos ADD COLUMN practice_id uuid;
ALTER TABLE tracking_photos DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE tracking_photos SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE tracking_photos ENABLE TRIGGER USER;
ALTER TABLE tracking_photos ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE tracking_photos ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE tracking_photos ADD CONSTRAINT tracking_photos_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX tracking_photos_practice_idx ON tracking_photos (practice_id);
ALTER TABLE tracking_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tracking_photos USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- meal_comments
ALTER TABLE meal_comments ADD COLUMN practice_id uuid;
ALTER TABLE meal_comments DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE meal_comments SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE meal_comments ENABLE TRIGGER USER;
ALTER TABLE meal_comments ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE meal_comments ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE meal_comments ADD CONSTRAINT meal_comments_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX meal_comments_practice_idx ON meal_comments (practice_id);
ALTER TABLE meal_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meal_comments USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_lab_reports
ALTER TABLE patient_lab_reports ADD COLUMN practice_id uuid;
ALTER TABLE patient_lab_reports DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_lab_reports SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_lab_reports ENABLE TRIGGER USER;
ALTER TABLE patient_lab_reports ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_lab_reports ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_lab_reports ADD CONSTRAINT patient_lab_reports_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_lab_reports_practice_idx ON patient_lab_reports (practice_id);
ALTER TABLE patient_lab_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_lab_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_lab_reports USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_lab_results
ALTER TABLE patient_lab_results ADD COLUMN practice_id uuid;
ALTER TABLE patient_lab_results DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_lab_results SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_lab_results ENABLE TRIGGER USER;
ALTER TABLE patient_lab_results ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_lab_results ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_lab_results ADD CONSTRAINT patient_lab_results_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_lab_results_practice_idx ON patient_lab_results (practice_id);
ALTER TABLE patient_lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_lab_results FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_lab_results USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- appointments
ALTER TABLE appointments ADD COLUMN practice_id uuid;
ALTER TABLE appointments DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE appointments SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE appointments ENABLE TRIGGER USER;
ALTER TABLE appointments ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE appointments ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE appointments ADD CONSTRAINT appointments_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX appointments_practice_idx ON appointments (practice_id);
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- calendar_feeds
ALTER TABLE calendar_feeds ADD COLUMN practice_id uuid;
ALTER TABLE calendar_feeds DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE calendar_feeds SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE calendar_feeds ENABLE TRIGGER USER;
ALTER TABLE calendar_feeds ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE calendar_feeds ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE calendar_feeds ADD CONSTRAINT calendar_feeds_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX calendar_feeds_practice_idx ON calendar_feeds (practice_id);
ALTER TABLE calendar_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_feeds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calendar_feeds USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_menstrual_records
ALTER TABLE patient_menstrual_records ADD COLUMN practice_id uuid;
ALTER TABLE patient_menstrual_records DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_menstrual_records SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_menstrual_records ENABLE TRIGGER USER;
ALTER TABLE patient_menstrual_records ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_menstrual_records ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_menstrual_records ADD CONSTRAINT patient_menstrual_records_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_menstrual_records_practice_idx ON patient_menstrual_records (practice_id);
ALTER TABLE patient_menstrual_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_menstrual_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_menstrual_records USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- patient_pregnancies
ALTER TABLE patient_pregnancies ADD COLUMN practice_id uuid;
ALTER TABLE patient_pregnancies DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE patient_pregnancies SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE patient_pregnancies ENABLE TRIGGER USER;
ALTER TABLE patient_pregnancies ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE patient_pregnancies ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE patient_pregnancies ADD CONSTRAINT patient_pregnancies_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX patient_pregnancies_practice_idx ON patient_pregnancies (practice_id);
ALTER TABLE patient_pregnancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_pregnancies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_pregnancies USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- diet_calculations
ALTER TABLE diet_calculations ADD COLUMN practice_id uuid;
ALTER TABLE diet_calculations DISABLE TRIGGER USER; -- algunas tablas son de solo inserción: se apagan un instante para asignar la consulta
UPDATE diet_calculations SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE diet_calculations ENABLE TRIGGER USER;
ALTER TABLE diet_calculations ALTER COLUMN practice_id SET NOT NULL;
ALTER TABLE diet_calculations ALTER COLUMN practice_id SET DEFAULT app_practice_id();
ALTER TABLE diet_calculations ADD CONSTRAINT diet_calculations_practice_fk FOREIGN KEY (practice_id) REFERENCES practices (id);
CREATE INDEX diet_calculations_practice_idx ON diet_calculations (practice_id);
ALTER TABLE diet_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE diet_calculations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON diet_calculations USING (practice_id = app_practice_id() OR app_bypass()) WITH CHECK (practice_id = app_practice_id() OR app_bypass());
-- audit_logs: la consulta puede ser nula (intentos de ingreso de cuentas que no existen); esas filas solo las ve la plataforma.
ALTER TABLE audit_logs ADD COLUMN practice_id uuid REFERENCES practices (id);
ALTER TABLE audit_logs DISABLE TRIGGER USER;
UPDATE audit_logs SET practice_id = (SELECT id FROM practices ORDER BY created_at LIMIT 1);
ALTER TABLE audit_logs ENABLE TRIGGER USER;
ALTER TABLE audit_logs ALTER COLUMN practice_id SET DEFAULT app_practice_id();
CREATE INDEX audit_logs_practice_idx ON audit_logs (practice_id);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
    USING (practice_id = app_practice_id() OR app_bypass())
    WITH CHECK (practice_id IS NULL OR practice_id = app_practice_id() OR app_bypass());

-- Las consultas: solo la plataforma las crea y las ve todas; cada consulta ve la suya.
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE practices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON practices USING (id = app_practice_id() OR app_bypass()) WITH CHECK (app_bypass());

-- Unicidades que antes eran de toda la instalación y ahora son de cada consulta.
DROP INDEX patients_email_active_idx;
CREATE UNIQUE INDEX patients_email_active_idx ON patients (practice_id, email) WHERE deleted_at IS NULL;

ALTER TABLE consent_documents DROP CONSTRAINT consent_documents_document_type_version_key;
ALTER TABLE consent_documents ADD CONSTRAINT consent_documents_practice_type_version_key UNIQUE (practice_id, document_type, version);
DROP INDEX consent_documents_one_active_idx;
CREATE UNIQUE INDEX consent_documents_one_active_idx ON consent_documents (practice_id, document_type) WHERE is_active;

ALTER TABLE app_settings DROP CONSTRAINT app_settings_pkey;
ALTER TABLE app_settings ADD PRIMARY KEY (practice_id, key);

-- La cuenta que ya existía y ya tenía su marca guardada no repite el inicio guiado.
INSERT INTO app_settings (practice_id, key, value)
SELECT (SELECT id FROM practices ORDER BY created_at LIMIT 1), 'profile', '{"onboarding_done": true, "modality": "in_person", "show_exact_address": true}'::jsonb
WHERE EXISTS (SELECT 1 FROM app_settings WHERE key = 'brand')
ON CONFLICT (practice_id, key) DO NOTHING;

-- Alta de una consulta con sus textos legales marcadores (la plataforma debe sustituirlos por los validados).
-- Debe llamarse desde un contexto de plataforma (app.bypass).
CREATE FUNCTION create_practice(p_name text) RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE pid uuid;
BEGIN
    INSERT INTO practices (name) VALUES (left(btrim(p_name), 120)) RETURNING id INTO pid;
    INSERT INTO consent_documents (practice_id, document_type, version, title, content, is_active) VALUES
        (pid, 'privacy', 1, 'Aviso de privacidad', 'Texto marcador del aviso de privacidad. Sustituir por la versión validada por asesoría jurídica antes de producción.', true),
        (pid, 'informed', 1, 'Consentimiento informado', 'Texto marcador del consentimiento informado para la atención nutricional. Sustituir por la versión validada antes de producción.', true);
    RETURN pid;
END
$fn$;

-- Rol con el que corre la API: SIN superusuario ni BYPASSRLS (de lo contrario las políticas no se aplicarían).
-- El despliegue le asigna contraseña e inicio de sesión (docs/interno/m1-cuentas-aisladas.md).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nutri_app') THEN
        CREATE ROLE nutri_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO nutri_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nutri_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nutri_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nutri_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nutri_app;
DO $$
BEGIN
    IF to_regclass('public.schema_migrations') IS NOT NULL THEN
        REVOKE ALL ON public.schema_migrations FROM nutri_app;
    END IF;
END
$$;
