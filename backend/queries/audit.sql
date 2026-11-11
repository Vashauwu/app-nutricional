-- Consulta de la bitácora de auditoría (solo lectura; la escritura es del módulo audit).
-- name: ListAuditLogs :many
SELECT a.id, a.occurred_at, COALESCE(u.display_name, 'Sistema')::text AS actor_name, a.action, a.resource_type, a.resource_id, a.request_id, a.metadata,
       count(*) OVER ()::int AS total
FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
WHERE sqlc.arg(search)::text = '' OR a.action ILIKE '%' || sqlc.arg(search)::text || '%' OR a.resource_type ILIKE '%' || sqlc.arg(search)::text || '%'
   OR COALESCE(u.display_name, '') ILIKE '%' || sqlc.arg(search)::text || '%'
ORDER BY a.occurred_at DESC, a.id
LIMIT sqlc.arg(page_limit)::int OFFSET sqlc.arg(page_offset)::int;
