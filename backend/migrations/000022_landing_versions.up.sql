-- Contenido de la landing pública gestionado desde el CRM (docs/interno/crm-landing.md).
-- Es contenido DE LA PLATAFORMA, no de una consulta: no lleva practice_id (tabla global) y solo la plataforma la toca; la lectura
-- pública pasa por la API, que entrega únicamente la versión publicada.
CREATE TABLE landing_versions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Consecutivo de versión; solo lo tienen las publicadas (y las reemplazadas).
    number        integer UNIQUE,
    status        text NOT NULL CHECK (status IN ('draft', 'pending', 'published', 'superseded')),
    content       jsonb NOT NULL,
    base_number   integer,
    reason        text,
    requested_by  uuid REFERENCES users (id),
    requested_at  timestamptz,
    decided_by    uuid REFERENCES users (id),
    decided_at    timestamptz,
    decision_note text,
    published_at  timestamptz,
    created_by    uuid REFERENCES users (id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CHECK ((status IN ('published', 'superseded')) = (number IS NOT NULL))
);
-- A la vez hay, como mucho, un borrador (o una publicación pendiente) y una versión publicada.
CREATE UNIQUE INDEX landing_one_open_idx ON landing_versions ((true)) WHERE status IN ('draft', 'pending');
CREATE UNIQUE INDEX landing_one_published_idx ON landing_versions ((true)) WHERE status = 'published';

ALTER TABLE landing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON landing_versions USING (app_bypass()) WITH CHECK (app_bypass());
GRANT SELECT, INSERT, UPDATE, DELETE ON landing_versions TO nutri_app;
