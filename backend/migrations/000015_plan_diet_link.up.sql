-- Origen de los objetivos del plan: el Dietocálculo del que se tomaron y la versión de ese cálculo (su updated_at) con la que
-- se aplicaron, para avisar si el Dietocálculo cambió después. Columnas opcionales: los planes existentes quedan sin vínculo.
ALTER TABLE meal_plans ADD COLUMN target_diet_calculation_id uuid REFERENCES diet_calculations (id) ON DELETE SET NULL;
ALTER TABLE meal_plans ADD COLUMN target_diet_synced_at timestamptz;
CREATE INDEX meal_plans_diet_calculation_idx ON meal_plans (target_diet_calculation_id) WHERE target_diet_calculation_id IS NOT NULL;
