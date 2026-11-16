-- Dietocálculo: cálculos dietéticos guardados por la nutrióloga. Pueden ser independientes (patient_id NULL)
-- o estar enlazados a un paciente. Se guardan las entradas y el resultado del motor tal como se calcularon.
CREATE TABLE diet_calculations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    patient_id     uuid REFERENCES patients (id) ON DELETE RESTRICT,
    inputs         jsonb NOT NULL,
    result         jsonb NOT NULL,
    engine_version text NOT NULL,
    kcal           integer NOT NULL CHECK (kcal >= 0),
    created_by     uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz
);
CREATE INDEX diet_calculations_patient_idx ON diet_calculations (patient_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX diet_calculations_updated_idx ON diet_calculations (updated_at DESC) WHERE deleted_at IS NULL;
