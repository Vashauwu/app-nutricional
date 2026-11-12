-- Composición corporal y circunferencias en cada medición, y el «tipo» de cada medicamento.
-- Las columnas son opcionales: una medición solo con peso y talla sigue siendo válida. La tabla sigue siendo de solo inserción.
ALTER TABLE patient_measurements
    ADD COLUMN fat_mass_kg    numeric CHECK (fat_mass_kg IS NULL OR fat_mass_kg > 0),
    ADD COLUMN muscle_pct     numeric CHECK (muscle_pct IS NULL OR (muscle_pct >= 0 AND muscle_pct <= 100)),
    ADD COLUMN muscle_mass_kg numeric CHECK (muscle_mass_kg IS NULL OR muscle_mass_kg > 0),
    ADD COLUMN visceral_fat   numeric CHECK (visceral_fat IS NULL OR visceral_fat >= 0),
    ADD COLUMN bone_kg        numeric CHECK (bone_kg IS NULL OR bone_kg > 0),
    ADD COLUMN obesity_pct    numeric CHECK (obesity_pct IS NULL OR obesity_pct >= 0),
    -- Perímetros (cm) por clave: hombros, pecho, bíceps/antebrazo/muslo/gemelo relajado y contraído (izq./der.), muñecas, abdomen.
    -- Cintura y cadera siguen en sus columnas. Las claves válidas se validan en el servicio.
    ADD COLUMN girths         jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE patient_medications ADD COLUMN kind text NOT NULL DEFAULT '';
