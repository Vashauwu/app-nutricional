-- Configuración, almacenamiento de archivos y seguimiento (MVP_SPEC §12, §17–§19, §29.2).

-- ---------- Configuración (§19) ----------
-- Una fila por sección (brand, region, storage, alerts). Los valores por defecto viven en el servicio.
CREATE TABLE app_settings (
    key        text PRIMARY KEY CHECK (key IN ('brand', 'region', 'storage', 'alerts')),
    value      jsonb NOT NULL,
    updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Archivos (§18) ----------
-- La ruta física (storage_key) nunca se expone: se accede por id con autorización.
CREATE TABLE file_objects (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key      text NOT NULL UNIQUE,
    thumb_key        text,
    storage_provider text NOT NULL DEFAULT 's3',
    kind             text NOT NULL CHECK (kind IN ('document', 'tracking_photo', 'dish_image', 'brand_logo', 'brand_photo')),
    visibility       text NOT NULL CHECK (visibility IN ('private', 'public')),
    mime_type        text NOT NULL,
    size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
    width            integer,
    height           integer,
    checksum         text NOT NULL,
    owner_patient_id uuid REFERENCES patients (id) ON DELETE RESTRICT,
    created_by       uuid REFERENCES users (id) ON DELETE RESTRICT,
    created_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz,
    -- Fotografías y documentos clínicos son siempre privados (§18.3).
    CONSTRAINT file_objects_clinical_private CHECK (kind NOT IN ('document', 'tracking_photo') OR visibility = 'private')
);
CREATE INDEX file_objects_owner_idx ON file_objects (owner_patient_id) WHERE deleted_at IS NULL;

CREATE TABLE patient_documents (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id         uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    file_object_id     uuid NOT NULL UNIQUE REFERENCES file_objects (id) ON DELETE RESTRICT,
    name               text NOT NULL,
    category           text NOT NULL CHECK (category IN ('laboratorio', 'estudio', 'receta', 'consentimiento', 'otro')),
    description        text NOT NULL DEFAULT '',
    document_date      date NOT NULL,
    visible_to_patient boolean NOT NULL DEFAULT false,
    scan_status        text NOT NULL CHECK (scan_status IN ('clean', 'rejected')),
    uploaded_by        uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    uploaded_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz
);
CREATE INDEX patient_documents_patient_idx ON patient_documents (patient_id, uploaded_at DESC) WHERE deleted_at IS NULL;

-- ---------- Seguimiento (§12.3, §12.4) ----------
-- Cada registro se vincula al elemento del plan y a la versión EXACTA del platillo de ese momento.
CREATE TABLE tracking_entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    plan_id         uuid NOT NULL REFERENCES meal_plans (id) ON DELETE RESTRICT,
    item_id         uuid NOT NULL UNIQUE REFERENCES meal_slot_items (id) ON DELETE RESTRICT,
    entry_date      date NOT NULL,
    slot_name       text NOT NULL,
    dish_id         uuid NOT NULL,
    dish_version    integer NOT NULL,
    dish_name       text NOT NULL,
    status          text NOT NULL CHECK (status IN ('done', 'skipped')),
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    patient_comment text NOT NULL DEFAULT '',
    needs_review    boolean NOT NULL DEFAULT true,
    FOREIGN KEY (dish_id, dish_version) REFERENCES dish_versions (dish_id, version_number) ON DELETE RESTRICT
);
CREATE INDEX tracking_entries_patient_idx ON tracking_entries (patient_id, entry_date DESC);
CREATE INDEX tracking_entries_plan_idx ON tracking_entries (plan_id, entry_date);
CREATE INDEX tracking_entries_review_idx ON tracking_entries (recorded_at DESC) WHERE needs_review;

CREATE TABLE tracking_photos (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id       uuid NOT NULL REFERENCES tracking_entries (id) ON DELETE RESTRICT,
    file_object_id uuid NOT NULL UNIQUE REFERENCES file_objects (id) ON DELETE RESTRICT,
    alt            text NOT NULL DEFAULT '',
    uploaded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracking_photos_entry_idx ON tracking_photos (entry_id);

-- Conversación por tiempo de comida (no es un chat global).
CREATE TABLE meal_comments (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id       uuid NOT NULL REFERENCES tracking_entries (id) ON DELETE RESTRICT,
    author_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    author_role    text NOT NULL CHECK (author_role IN ('patient', 'nutritionist')),
    body           text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    edited_at      timestamptz,
    deleted_at     timestamptz
);
CREATE INDEX meal_comments_entry_idx ON meal_comments (entry_id, created_at) WHERE deleted_at IS NULL;
