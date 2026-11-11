-- Pacientes, expediente y consentimientos (MVP_SPEC §3, §4, §29.2).

CREATE EXTENSION IF NOT EXISTS unaccent;
-- Los datos personales del perfil viven en la misma fila que el paciente (simplificación del ERD).

CREATE TABLE patients (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                    uuid UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
    status                     text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'inactive')),
    first_name                 text NOT NULL,
    last_name                  text NOT NULL,
    birth_date                 date NOT NULL,
    sex                        text NOT NULL CHECK (sex IN ('F', 'M', 'O')),
    email                      citext NOT NULL,
    phone                      text NOT NULL DEFAULT '',
    goal                       text NOT NULL DEFAULT 'maintenance'
                               CHECK (goal IN ('weight_loss', 'muscle_gain', 'maintenance', 'health', 'other')),
    goal_notes                 text NOT NULL DEFAULT '',
    clinical_indications       text NOT NULL DEFAULT '',
    measurements_visible       boolean NOT NULL DEFAULT true,
    quota_override_bytes       bigint CHECK (quota_override_bytes IS NULL OR quota_override_bytes > 0),
    created_by                 uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    deleted_at                 timestamptz
);
-- Solo adultos en el MVP (§3.1): la regla vive en el servicio (una CHECK con current_date no es inmutable).
CREATE UNIQUE INDEX patients_email_active_idx ON patients (email) WHERE deleted_at IS NULL;
CREATE INDEX patients_status_idx ON patients (status) WHERE deleted_at IS NULL;
CREATE INDEX patients_name_idx ON patients (lower(last_name), lower(first_name));

-- Historial antropométrico acumulativo: nunca se sobrescribe (§3.2).
CREATE TABLE patient_measurements (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id   uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    measured_at  date NOT NULL,
    weight_kg    numeric NOT NULL CHECK (weight_kg > 0),
    height_cm    numeric NOT NULL CHECK (height_cm > 0),
    bmi          numeric NOT NULL,
    waist_cm     numeric CHECK (waist_cm IS NULL OR waist_cm > 0),
    hip_cm       numeric CHECK (hip_cm IS NULL OR hip_cm > 0),
    body_fat_pct numeric CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 100)),
    notes        text NOT NULL DEFAULT '',
    created_by   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_measurements_patient_idx ON patient_measurements (patient_id, measured_at DESC);

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION '% es de solo insercion', TG_TABLE_NAME;
END
$fn$;
CREATE TRIGGER patient_measurements_append_only
    BEFORE UPDATE OR DELETE ON patient_measurements
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE patient_conditions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    name       text NOT NULL,
    details    text NOT NULL DEFAULT '',
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_conditions_patient_idx ON patient_conditions (patient_id);

CREATE TABLE patient_allergies (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    allergen   text NOT NULL,
    aliases    text[] NOT NULL DEFAULT '{}',
    reaction   text NOT NULL DEFAULT '',
    severity   text NOT NULL DEFAULT 'moderate' CHECK (severity IN ('mild', 'moderate', 'severe')),
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_allergies_patient_idx ON patient_allergies (patient_id);

CREATE TABLE patient_medications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    name       text NOT NULL,
    dose       text NOT NULL DEFAULT '',
    frequency  text NOT NULL DEFAULT '',
    start_date date,
    end_date   date,
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_medications_patient_idx ON patient_medications (patient_id);

CREATE TABLE patient_food_preferences (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    food_name       text NOT NULL,
    preference_type text NOT NULL CHECK (preference_type IN ('favorite', 'avoid', 'restriction', 'other')),
    notes           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_food_preferences_patient_idx ON patient_food_preferences (patient_id);

-- Notas privadas: solo la nutrióloga (§2.2). Eliminación lógica.
CREATE TABLE patient_notes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id     uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    author_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    body           text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz
);
CREATE INDEX patient_notes_patient_idx ON patient_notes (patient_id, created_at DESC);

-- Documentos legales versionados: una versión nueva no sobrescribe la anterior (§4.1).
CREATE TABLE consent_documents (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type text NOT NULL CHECK (document_type IN ('privacy', 'informed')),
    version       integer NOT NULL CHECK (version > 0),
    title         text NOT NULL,
    content       text NOT NULL,
    published_at  timestamptz NOT NULL DEFAULT now(),
    is_active     boolean NOT NULL DEFAULT false,
    UNIQUE (document_type, version)
);
CREATE UNIQUE INDEX consent_documents_one_active_idx ON consent_documents (document_type) WHERE is_active;

CREATE TABLE consent_acceptances (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    consent_document_id uuid NOT NULL REFERENCES consent_documents (id) ON DELETE RESTRICT,
    accepted_at         timestamptz NOT NULL DEFAULT now(),
    acceptance_method   text NOT NULL CHECK (acceptance_method IN ('web_checkbox', 'in_person')),
    evidence_metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
    revoked_at          timestamptz
);
CREATE INDEX consent_acceptances_patient_idx ON consent_acceptances (patient_id);
-- Una sola aceptación vigente por paciente y documento.
CREATE UNIQUE INDEX consent_acceptances_live_idx ON consent_acceptances (patient_id, consent_document_id) WHERE revoked_at IS NULL;

-- Textos marcador: DEBEN sustituirse por la versión validada por asesoría jurídica (§4.1, §25.1).
INSERT INTO consent_documents (document_type, version, title, content, is_active) VALUES
    ('privacy', 1, 'Aviso de privacidad', 'Texto marcador del aviso de privacidad. Sustituir por la versión validada por asesoría jurídica antes de producción.', true),
    ('informed', 1, 'Consentimiento informado', 'Texto marcador del consentimiento informado para la atención nutricional. Sustituir por la versión validada antes de producción.', true);
