DROP TABLE IF EXISTS patient_pregnancies;
DROP TABLE IF EXISTS patient_menstrual_records;
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_menarche_exclusive, DROP COLUMN IF EXISTS menarche_unknown, DROP COLUMN IF EXISTS menarche_age;
