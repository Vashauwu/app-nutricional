-- Catálogo SMAE versionado, alimentos personalizados y platillos con versiones inmutables
-- (MVP_SPEC §6, §7, §29.2, §30). Simplificación: la composición y la regla de equivalencia
-- viven en la fila del alimento.

CREATE TABLE smae_editions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text NOT NULL,
    edition_number    integer NOT NULL,
    publisher         text NOT NULL DEFAULT '',
    source_reference  text NOT NULL DEFAULT '',
    license_reference text NOT NULL DEFAULT '',
    effective_date    date NOT NULL,
    status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
    notes             text NOT NULL DEFAULT '',
    imported_at       timestamptz NOT NULL DEFAULT now(),
    imported_by       uuid REFERENCES users (id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX smae_editions_one_active_idx ON smae_editions ((true)) WHERE status = 'active';

-- Trazabilidad de cada carga (§30.9).
CREATE TABLE smae_import_batches (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL en lotes rechazados: la edición no llegó a crearse.
    edition_id       uuid REFERENCES smae_editions (id) ON DELETE RESTRICT,
    source_file_name text NOT NULL DEFAULT '',
    checksum         text NOT NULL,
    imported_by      uuid REFERENCES users (id) ON DELETE RESTRICT,
    imported_at      timestamptz NOT NULL DEFAULT now(),
    row_count        integer NOT NULL,
    status           text NOT NULL CHECK (status IN ('ok', 'rejected')),
    error_summary    text NOT NULL DEFAULT ''
);

CREATE TABLE smae_food_groups (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id uuid NOT NULL REFERENCES smae_editions (id) ON DELETE RESTRICT,
    code       text NOT NULL,
    name       text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    tone       text NOT NULL DEFAULT 'lavanda' CHECK (tone IN ('rosa', 'salvia', 'lavanda', 'mantequilla', 'cielo')),
    UNIQUE (edition_id, code)
);

CREATE TABLE smae_food_subgroups (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   uuid NOT NULL REFERENCES smae_food_groups (id) ON DELETE RESTRICT,
    code       text NOT NULL,
    name       text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    UNIQUE (group_id, code)
);

CREATE TABLE smae_foods (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id           uuid NOT NULL REFERENCES smae_editions (id) ON DELETE RESTRICT,
    subgroup_id          uuid NOT NULL REFERENCES smae_food_subgroups (id) ON DELETE RESTRICT,
    code                 text NOT NULL,
    name                 text NOT NULL,
    food_state           text NOT NULL DEFAULT '',
    edible_pct           numeric NOT NULL DEFAULT 100,
    density_g_per_ml     numeric CHECK (density_g_per_ml IS NULL OR density_g_per_ml > 0),
    basis_quantity       numeric NOT NULL CHECK (basis_quantity > 0),
    basis_unit           text NOT NULL DEFAULT 'g' CHECK (basis_unit IN ('g', 'ml')),
    energy_kcal          numeric NOT NULL CHECK (energy_kcal >= 0),
    protein_g            numeric NOT NULL CHECK (protein_g >= 0),
    carbohydrates_g      numeric NOT NULL CHECK (carbohydrates_g >= 0),
    lipids_g             numeric NOT NULL CHECK (lipids_g >= 0),
    fiber_g              numeric NOT NULL DEFAULT 0 CHECK (fiber_g >= 0),
    equiv_reference_grams numeric NOT NULL CHECK (equiv_reference_grams > 0),
    equiv_value          numeric NOT NULL DEFAULT 1 CHECK (equiv_value > 0),
    tags                 text[] NOT NULL DEFAULT '{}',
    source_reference     text NOT NULL DEFAULT '',
    status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    UNIQUE (edition_id, code)
);
CREATE INDEX smae_foods_subgroup_idx ON smae_foods (subgroup_id);
CREATE INDEX smae_foods_name_idx ON smae_foods (lower(name));

CREATE TABLE smae_portions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    food_id          uuid NOT NULL REFERENCES smae_foods (id) ON DELETE RESTRICT,
    name             text NOT NULL,
    unit             text NOT NULL,
    quantity         numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
    grams_equivalent numeric NOT NULL CHECK (grams_equivalent > 0),
    is_reference     boolean NOT NULL DEFAULT false,
    UNIQUE (food_id, unit)
);

-- Alimentos personalizados: siempre distinguibles de los oficiales (§30.3).
CREATE TABLE custom_foods (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL,
    brand              text,
    description        text NOT NULL DEFAULT '',
    basis_quantity     numeric NOT NULL CHECK (basis_quantity > 0),
    basis_unit         text NOT NULL DEFAULT 'g' CHECK (basis_unit IN ('g', 'ml')),
    density_g_per_ml   numeric CHECK (density_g_per_ml IS NULL OR density_g_per_ml > 0),
    energy_kcal        numeric NOT NULL CHECK (energy_kcal >= 0),
    protein_g          numeric NOT NULL CHECK (protein_g >= 0),
    carbohydrates_g    numeric NOT NULL CHECK (carbohydrates_g >= 0),
    lipids_g           numeric NOT NULL CHECK (lipids_g >= 0),
    fiber_g            numeric NOT NULL DEFAULT 0 CHECK (fiber_g >= 0),
    source_type        text NOT NULL CHECK (source_type IN ('label', 'manufacturer', 'analysis', 'manual', 'other')),
    source_reference   text NOT NULL,
    tags               text[] NOT NULL DEFAULT '{}',
    created_by         uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    validated_by       uuid REFERENCES users (id) ON DELETE RESTRICT,
    validated_at       timestamptz,
    status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    -- Equivalencia SMAE: solo existe si la nutrióloga la asigna de forma expresa y queda registrada.
    eq_subgroup_code   text,
    eq_reference_grams numeric CHECK (eq_reference_grams IS NULL OR eq_reference_grams > 0),
    eq_value           numeric CHECK (eq_value IS NULL OR eq_value > 0),
    eq_assigned_by     uuid REFERENCES users (id) ON DELETE RESTRICT,
    eq_assigned_at     timestamptz,
    eq_criterion       text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT custom_foods_eq_complete CHECK (
        (eq_subgroup_code IS NULL AND eq_reference_grams IS NULL AND eq_value IS NULL AND eq_assigned_by IS NULL AND eq_criterion IS NULL)
        OR (eq_subgroup_code IS NOT NULL AND eq_reference_grams IS NOT NULL AND eq_value IS NOT NULL AND eq_assigned_by IS NOT NULL AND eq_criterion IS NOT NULL))
);

CREATE TABLE custom_food_portions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    custom_food_id   uuid NOT NULL REFERENCES custom_foods (id) ON DELETE RESTRICT,
    name             text NOT NULL,
    unit             text NOT NULL,
    quantity         numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
    grams_equivalent numeric NOT NULL CHECK (grams_equivalent > 0),
    UNIQUE (custom_food_id, unit)
);

-- ---------- Platillos ----------
CREATE TABLE dishes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    name            text NOT NULL,
    category        text NOT NULL,
    tags            text[] NOT NULL DEFAULT '{}',
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    current_version integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
CREATE INDEX dishes_category_idx ON dishes (category) WHERE deleted_at IS NULL;
CREATE INDEX dishes_name_idx ON dishes (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE dish_versions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_id           uuid NOT NULL REFERENCES dishes (id) ON DELETE RESTRICT,
    version_number    integer NOT NULL CHECK (version_number > 0),
    description       text NOT NULL DEFAULT '',
    recipe_mode       text NOT NULL CHECK (recipe_mode IN ('structured', 'free')),
    instructions_text text NOT NULL DEFAULT '',
    steps             text[] NOT NULL DEFAULT '{}',
    servings          numeric NOT NULL CHECK (servings > 0),
    prep_time_minutes integer NOT NULL DEFAULT 0 CHECK (prep_time_minutes >= 0),
    recommendations   text NOT NULL DEFAULT '',
    image_file_id     uuid,
    smae_edition_id   uuid NOT NULL REFERENCES smae_editions (id) ON DELETE RESTRICT,
    created_by        uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at        timestamptz NOT NULL DEFAULT now(),
    change_reason     text NOT NULL DEFAULT '',
    UNIQUE (dish_id, version_number)
);

CREATE TABLE dish_ingredients (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_version_id  uuid NOT NULL REFERENCES dish_versions (id) ON DELETE RESTRICT,
    position         integer NOT NULL,
    food_kind        text NOT NULL CHECK (food_kind IN ('smae', 'custom')),
    food_id          uuid NOT NULL,
    name_snapshot    text NOT NULL,
    quantity         numeric NOT NULL CHECK (quantity >= 0),
    unit             text NOT NULL,
    grams            numeric NOT NULL,
    energy_kcal      numeric NOT NULL,
    protein_g        numeric NOT NULL,
    carbohydrates_g  numeric NOT NULL,
    lipids_g         numeric NOT NULL,
    fiber_g          numeric NOT NULL,
    equivalent_code  text,
    equivalent_value numeric,
    official         boolean NOT NULL
);
CREATE INDEX dish_ingredients_version_idx ON dish_ingredients (dish_version_id, position);
CREATE INDEX dish_ingredients_food_idx ON dish_ingredients (food_kind, food_id);

CREATE TABLE dish_nutrition_snapshots (
    dish_version_id    uuid PRIMARY KEY REFERENCES dish_versions (id) ON DELETE RESTRICT,
    totals_energy      numeric NOT NULL, totals_protein numeric NOT NULL, totals_carbs numeric NOT NULL, totals_lipids numeric NOT NULL, totals_fiber numeric NOT NULL,
    serving_energy     numeric NOT NULL, serving_protein numeric NOT NULL, serving_carbs numeric NOT NULL, serving_lipids numeric NOT NULL, serving_fiber numeric NOT NULL,
    equivalents        jsonb NOT NULL DEFAULT '{}'::jsonb,
    has_custom_foods   boolean NOT NULL,
    engine_version     text NOT NULL,
    calculated_at      timestamptz NOT NULL DEFAULT now()
);

-- Las versiones y sus datos de cálculo no se modifican ni se borran (§7.4, §28).
CREATE TRIGGER dish_versions_immutable BEFORE UPDATE OR DELETE ON dish_versions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER dish_ingredients_immutable BEFORE UPDATE OR DELETE ON dish_ingredients FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER dish_snapshots_immutable BEFORE UPDATE OR DELETE ON dish_nutrition_snapshots FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Alternativas autorizadas por la nutrióloga para una versión del platillo (§8).
CREATE TABLE dish_substitutions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_version_id    uuid NOT NULL REFERENCES dish_versions (id) ON DELETE RESTRICT,
    substitute_dish_id uuid NOT NULL REFERENCES dishes (id) ON DELETE RESTRICT,
    substitute_version integer NOT NULL,
    label              text NOT NULL,
    note               text NOT NULL DEFAULT '',
    rule               text NOT NULL DEFAULT '',
    diff               jsonb NOT NULL DEFAULT '{}'::jsonb,
    approved_by        uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    approved_at        timestamptz NOT NULL DEFAULT now(),
    removed_at         timestamptz
);
CREATE INDEX dish_substitutions_version_idx ON dish_substitutions (dish_version_id) WHERE removed_at IS NULL;

-- Decisiones de recálculo al incorporar una edición nueva del catálogo (§7.4).
CREATE TABLE smae_recalc_batches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_edition_id uuid NOT NULL REFERENCES smae_editions (id) ON DELETE RESTRICT,
    to_edition_id   uuid NOT NULL REFERENCES smae_editions (id) ON DELETE RESTRICT,
    decided_by      uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    decided_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE smae_recalc_decisions (
    batch_id     uuid NOT NULL REFERENCES smae_recalc_batches (id) ON DELETE RESTRICT,
    dish_id      uuid NOT NULL REFERENCES dishes (id) ON DELETE RESTRICT,
    from_version integer NOT NULL,
    to_version   integer,
    decision     text NOT NULL CHECK (decision IN ('authorized', 'rejected')),
    PRIMARY KEY (batch_id, dish_id)
);
