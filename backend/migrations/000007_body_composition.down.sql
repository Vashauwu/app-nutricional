ALTER TABLE patient_medications DROP COLUMN kind;
ALTER TABLE patient_measurements
    DROP COLUMN fat_mass_kg, DROP COLUMN muscle_pct, DROP COLUMN muscle_mass_kg, DROP COLUMN visceral_fat,
    DROP COLUMN bone_kg, DROP COLUMN obesity_pct, DROP COLUMN girths;
