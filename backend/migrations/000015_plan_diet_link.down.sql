DROP INDEX IF EXISTS meal_plans_diet_calculation_idx;
ALTER TABLE meal_plans DROP COLUMN IF EXISTS target_diet_synced_at;
ALTER TABLE meal_plans DROP COLUMN IF EXISTS target_diet_calculation_id;
