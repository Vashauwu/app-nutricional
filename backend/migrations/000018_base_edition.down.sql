-- Quita la edición base solo si sigue vacía y sin uso.
DELETE FROM smae_food_subgroups WHERE group_id IN (SELECT g.id FROM smae_food_groups g JOIN smae_editions e ON e.id = g.edition_id
    WHERE e.edition_number = 0 AND e.name = 'Alimentos propios (sin catálogo oficial)'
      AND NOT EXISTS (SELECT 1 FROM smae_foods f WHERE f.edition_id = e.id) AND NOT EXISTS (SELECT 1 FROM dish_versions d WHERE d.smae_edition_id = e.id));
DELETE FROM smae_food_groups WHERE edition_id IN (SELECT e.id FROM smae_editions e
    WHERE e.edition_number = 0 AND e.name = 'Alimentos propios (sin catálogo oficial)'
      AND NOT EXISTS (SELECT 1 FROM smae_foods f WHERE f.edition_id = e.id) AND NOT EXISTS (SELECT 1 FROM dish_versions d WHERE d.smae_edition_id = e.id));
DELETE FROM smae_editions e WHERE e.edition_number = 0 AND e.name = 'Alimentos propios (sin catálogo oficial)'
  AND NOT EXISTS (SELECT 1 FROM smae_foods f WHERE f.edition_id = e.id) AND NOT EXISTS (SELECT 1 FROM dish_versions d WHERE d.smae_edition_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM smae_food_groups g WHERE g.edition_id = e.id);
