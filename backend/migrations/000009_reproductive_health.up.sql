-- Salud reproductiva (solo la captura la nutrióloga; la paciente no la ve en su app).
-- Menarca: dato único del expediente. «No recuerda» se distingue de «no capturado».
ALTER TABLE patients
    ADD COLUMN menarche_age     smallint CHECK (menarche_age IS NULL OR menarche_age BETWEEN 8 AND 20),
    ADD COLUMN menarche_unknown boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT patients_menarche_exclusive CHECK (NOT (menarche_unknown AND menarche_age IS NOT NULL));

-- Fecha de última menstruación: historial acumulativo, nunca se sobrescribe (como la antropometría).
CREATE TABLE patient_menstrual_records (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id       uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    last_period_date date NOT NULL,
    created_by       uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_menstrual_records_patient_idx ON patient_menstrual_records (patient_id, last_period_date DESC, created_at DESC);

-- Embarazo: se registra con las semanas de gestación que se conocen en esa fecha; de ahí se calculan las semanas
-- actuales y la fecha probable de parto (semana 40). Solo puede haber uno vigente por paciente.
CREATE TABLE patient_pregnancies (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id     uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    weeks_at_start smallint NOT NULL CHECK (weeks_at_start BETWEEN 1 AND 42),
    recorded_on    date NOT NULL,
    due_date       date NOT NULL,
    notes          text NOT NULL DEFAULT '',
    ended_on       date,
    created_by     uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (ended_on IS NULL OR ended_on >= recorded_on)
);
CREATE INDEX patient_pregnancies_patient_idx ON patient_pregnancies (patient_id, recorded_on DESC);
CREATE UNIQUE INDEX patient_pregnancies_one_active_idx ON patient_pregnancies (patient_id) WHERE ended_on IS NULL;
