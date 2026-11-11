-- Laboratorios: la nutrióloga captura los valores de la química sanguínea (el PDF original se guarda en Documentos).
-- Cada resultado lleva su propio rango de referencia, porque cambia entre laboratorios y según el sexo del paciente.
CREATE TABLE patient_lab_reports (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    taken_at   date NOT NULL,
    lab_name   text NOT NULL DEFAULT '',
    notes      text NOT NULL DEFAULT '',
    created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_lab_reports_patient_idx ON patient_lab_reports (patient_id, taken_at DESC);

CREATE TABLE patient_lab_results (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES patient_lab_reports (id) ON DELETE CASCADE,
    name      text NOT NULL,
    value     numeric NOT NULL,
    unit      text NOT NULL DEFAULT '',
    ref_min   numeric,
    ref_max   numeric,
    position  integer NOT NULL DEFAULT 0,
    CHECK (ref_min IS NULL OR ref_max IS NULL OR ref_min <= ref_max)
);
CREATE INDEX patient_lab_results_report_idx ON patient_lab_results (report_id);

-- Consultas (citas) con la nutrióloga.
CREATE TABLE appointments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    starts_at  timestamptz NOT NULL,
    ends_at    timestamptz NOT NULL,
    kind       text NOT NULL DEFAULT 'follow_up' CHECK (kind IN ('first', 'follow_up', 'other')),
    mode       text NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person', 'online')),
    place      text NOT NULL DEFAULT '',
    notes      text NOT NULL DEFAULT '',  -- internas: el paciente no las ve
    status     text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
    created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX appointments_starts_idx ON appointments (starts_at);
CREATE INDEX appointments_patient_idx ON appointments (patient_id, starts_at);

-- Enlace secreto de suscripción (.ics) para que Google Calendar, Apple Calendar u Outlook muestren las consultas.
CREATE TABLE calendar_feeds (
    user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    token      text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
