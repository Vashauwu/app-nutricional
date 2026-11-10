-- Identidad, autorización y auditoría (MVP_SPEC §29.2).
-- Convenciones: UUID como PK, fechas UTC en timestamptz, estados con CHECK,
-- ON DELETE RESTRICT en entidades históricas.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         citext NOT NULL UNIQUE,
    password_hash text NOT NULL,
    status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('invited', 'active', 'disabled')),
    last_login_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    description text NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT ''
);

CREATE TABLE user_role_assignments (
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    role_id     uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_role_assignments_role_id_idx ON user_role_assignments (role_id);

CREATE TABLE role_permissions (
    role_id       uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
    permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE RESTRICT,
    PRIMARY KEY (role_id, permission_id)
);

-- Solo se guarda el hash del refresh token, nunca el token.
CREATE TABLE user_sessions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    refresh_token_hash bytea NOT NULL UNIQUE,
    device_label       text NOT NULL DEFAULT '',
    user_agent         text NOT NULL DEFAULT '',
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz
);
CREATE INDEX user_sessions_active_idx ON user_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);

-- Auditoría interna: append-only. metadata no debe contener secretos ni tokens.
CREATE TABLE audit_logs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
    action        text NOT NULL,
    resource_type text NOT NULL,
    resource_id   uuid,
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    request_id    text NOT NULL DEFAULT '',
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, occurred_at DESC);

INSERT INTO roles (code, name, description) VALUES
    ('nutritionist', 'Nutrióloga', 'Administra pacientes, platillos, planes y configuración.'),
    ('patient', 'Paciente', 'Consulta exclusivamente su propia información autorizada.');
