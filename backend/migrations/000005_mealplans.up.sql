-- Planes alimentarios, calendario, publicaciones, historial y plantillas (MVP_SPEC §9, §10, §11, §29.2).
--
-- Modelo: el plan es un documento editable (días → tiempos de comida → platillos). Cada guardado de un
-- plan PUBLICADO deja una revisión inmutable, de modo que siempre se puede reconstruir exactamente lo que
-- vio la paciente en un momento dado. Quitar elementos es lógico para no romper el historial de seguimiento.

CREATE TABLE meal_plans (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id           uuid NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
    name                 text NOT NULL,
    status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'finished', 'archived')),
    start_date           date NOT NULL,
    end_date             date NOT NULL,
    -- Concurrencia optimista: sube en cada cambio. Un guardado con revisión vieja se rechaza (§9.3).
    revision             integer NOT NULL DEFAULT 1,
    target_energy        numeric NOT NULL DEFAULT 0 CHECK (target_energy >= 0),
    target_protein       numeric NOT NULL DEFAULT 0 CHECK (target_protein >= 0),
    target_carbs         numeric NOT NULL DEFAULT 0 CHECK (target_carbs >= 0),
    target_lipids        numeric NOT NULL DEFAULT 0 CHECK (target_lipids >= 0),
    target_equivalents   jsonb NOT NULL DEFAULT '{}'::jsonb,
    targets_version      integer NOT NULL DEFAULT 1,
    created_by           uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_by           uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    updated_at           timestamptz NOT NULL DEFAULT now(),
    deleted_at           timestamptz,
    CONSTRAINT meal_plans_dates CHECK (end_date >= start_date)
);
CREATE INDEX meal_plans_patient_idx ON meal_plans (patient_id) WHERE deleted_at IS NULL;
CREATE INDEX meal_plans_status_idx ON meal_plans (status, end_date) WHERE deleted_at IS NULL;

CREATE TABLE meal_plan_days (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id    uuid NOT NULL REFERENCES meal_plans (id) ON DELETE RESTRICT,
    plan_date  date NOT NULL,
    notes      text NOT NULL DEFAULT '',
    removed_at timestamptz
);
CREATE UNIQUE INDEX meal_plan_days_live_idx ON meal_plan_days (plan_id, plan_date) WHERE removed_at IS NULL;

CREATE TABLE meal_slots (
    id         uuid PRIMARY KEY,
    day_id     uuid NOT NULL REFERENCES meal_plan_days (id) ON DELETE RESTRICT,
    name       text NOT NULL,
    position   integer NOT NULL,
    removed_at timestamptz
);
CREATE INDEX meal_slots_day_idx ON meal_slots (day_id) WHERE removed_at IS NULL;

CREATE TABLE meal_slot_items (
    id           uuid PRIMARY KEY,
    slot_id      uuid NOT NULL REFERENCES meal_slots (id) ON DELETE RESTRICT,
    position     integer NOT NULL,
    dish_id      uuid NOT NULL REFERENCES dishes (id) ON DELETE RESTRICT,
    dish_version integer NOT NULL,
    servings     numeric NOT NULL CHECK (servings > 0),
    instructions text NOT NULL DEFAULT '',
    removed_at   timestamptz,
    -- La referencia apunta a una versión concreta e inmutable del platillo (§7.4, §29.3).
    FOREIGN KEY (dish_id, dish_version) REFERENCES dish_versions (dish_id, version_number) ON DELETE RESTRICT
);
CREATE INDEX meal_slot_items_slot_idx ON meal_slot_items (slot_id) WHERE removed_at IS NULL;
CREATE INDEX meal_slot_items_dish_idx ON meal_slot_items (dish_id, dish_version) WHERE removed_at IS NULL;

-- Revisiones inmutables de planes publicados (reconstrucción exacta de lo visto por la paciente, §11).
CREATE TABLE meal_plan_revisions (
    plan_id       uuid NOT NULL REFERENCES meal_plans (id) ON DELETE RESTRICT,
    revision      integer NOT NULL,
    saved_at      timestamptz NOT NULL DEFAULT now(),
    saved_by      uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    snapshot      jsonb NOT NULL,
    PRIMARY KEY (plan_id, revision)
);
CREATE TRIGGER meal_plan_revisions_immutable BEFORE UPDATE OR DELETE ON meal_plan_revisions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE meal_plan_publications (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id        uuid NOT NULL REFERENCES meal_plans (id) ON DELETE RESTRICT,
    version_number integer NOT NULL,
    revision       integer NOT NULL,
    published_at   timestamptz NOT NULL DEFAULT now(),
    published_by   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    summary        text NOT NULL DEFAULT '',
    UNIQUE (plan_id, version_number),
    FOREIGN KEY (plan_id, revision) REFERENCES meal_plan_revisions (plan_id, revision) ON DELETE RESTRICT
);
CREATE TRIGGER meal_plan_publications_immutable BEFORE UPDATE OR DELETE ON meal_plan_publications FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE meal_plan_events (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id   uuid NOT NULL REFERENCES meal_plans (id) ON DELETE RESTRICT,
    at        timestamptz NOT NULL DEFAULT now(),
    actor     uuid REFERENCES users (id) ON DELETE RESTRICT,
    type      text NOT NULL CHECK (type IN ('created', 'edited', 'published', 'unpublished', 'substitution', 'finished', 'archived', 'restored', 'duplicated', 'deleted')),
    summary   text NOT NULL
);
CREATE INDEX meal_plan_events_plan_idx ON meal_plan_events (plan_id, at);

-- Plantillas: el plan creado desde una plantilla es una copia independiente (§10).
CREATE TABLE meal_plan_templates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    scope       text NOT NULL CHECK (scope IN ('global', 'patient')),
    patient_id  uuid REFERENCES patients (id) ON DELETE RESTRICT,
    -- [{ "offset": 0, "slots": [{ "name": "Desayuno", "items": [{ "dish_id": "...", "dish_version": 1, "servings": "1", "instructions": "" }] }] }]
    structure   jsonb NOT NULL,
    created_by  uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    CONSTRAINT meal_plan_templates_scope CHECK ((scope = 'patient') = (patient_id IS NOT NULL))
);
