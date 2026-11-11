-- Nombres de ingredientes de una versión de platillo (para detectar alérgenos y restricciones).
-- name: IngredientNames :many
SELECT i.name_snapshot
FROM dish_ingredients i JOIN dish_versions v ON v.id = i.dish_version_id
WHERE v.dish_id = $1 AND v.version_number = $2
ORDER BY i.position;

-- Planes publicados vigentes, para el tablero de alertas.
-- name: ListPublishedPlanIDs :many
SELECT id FROM meal_plans WHERE status = 'published' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200;
