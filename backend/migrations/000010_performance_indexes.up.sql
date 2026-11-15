-- Índices para las consultas más frecuentes que hoy ordenan o filtran sin apoyo de un índice.
-- Todos son parciales o compuestos para no duplicar los existentes.

-- Bitácora de auditoría sin filtros: ORDER BY occurred_at DESC, id (los índices existentes parten de resource/actor).
CREATE INDEX IF NOT EXISTS audit_logs_occurred_idx ON audit_logs (occurred_at DESC, id);

-- Bandeja de seguimiento sin filtro de paciente: ORDER BY recorded_at DESC.
CREATE INDEX IF NOT EXISTS tracking_entries_recorded_idx ON tracking_entries (recorded_at DESC, id);

-- Tablero de alertas: planes publicados más recientes (ListPublishedPlanIDs).
CREATE INDEX IF NOT EXISTS meal_plans_published_recent_idx ON meal_plans (updated_at DESC)
    WHERE status = 'published' AND deleted_at IS NULL;

-- Listado de planes ordenado por inicio (ListPlans).
CREATE INDEX IF NOT EXISTS meal_plans_start_idx ON meal_plans (start_date DESC, id) WHERE deleted_at IS NULL;

-- Cumplimiento por rango de fechas: recorre los días del periodo sin pasar por cada plan.
CREATE INDEX IF NOT EXISTS meal_plan_days_date_idx ON meal_plan_days (plan_date) WHERE removed_at IS NULL;

-- Claves foráneas sin índice: acelera las uniones y evita barridos al validar referencias.
CREATE INDEX IF NOT EXISTS dishes_owner_idx ON dishes (owner_user_id);
CREATE INDEX IF NOT EXISTS dish_versions_created_by_idx ON dish_versions (created_by);
CREATE INDEX IF NOT EXISTS dish_substitutions_substitute_idx ON dish_substitutions (substitute_dish_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS meal_comments_author_idx ON meal_comments (author_user_id);
