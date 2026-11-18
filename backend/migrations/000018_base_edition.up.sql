-- M3: una plataforma sin catálogo SMAE oficial necesita una edición base. Los platillos guardan la edición con la que se
-- calcularon y las equivalencias de «Mis alimentos» necesitan grupos y subgrupos. Esta edición está VACÍA de alimentos
-- (solo la estructura de grupos, que no es contenido protegido) y solo se crea si no existe ninguna edición.

WITH ed AS (
    INSERT INTO smae_editions (name, edition_number, publisher, source_reference, license_reference, effective_date, status, notes)
    SELECT 'Alimentos propios (sin catálogo oficial)', 0, '', 'Estructura de grupos de alimentos', 'No contiene datos de terceros', current_date, 'active',
           'Edición base sin alimentos: permite crear platillos y equivalencias con alimentos propios. Se reemplaza al activar una edición del catálogo.'
    WHERE NOT EXISTS (SELECT 1 FROM smae_editions)
    RETURNING id
), g AS (
    INSERT INTO smae_food_groups (edition_id, code, name, sort_order, tone)
    SELECT ed.id, v.code, v.name, v.ord, v.tone FROM ed, (VALUES
        ('VER', 'Verduras', 1, 'salvia'), ('FRU', 'Frutas', 2, 'rosa'), ('CER', 'Cereales y tubérculos', 3, 'mantequilla'),
        ('LEG', 'Leguminosas', 4, 'lavanda'), ('AOA', 'Alimentos de origen animal', 5, 'cielo'), ('LEC', 'Leche', 6, 'cielo'),
        ('ACE', 'Aceites y grasas', 7, 'mantequilla'), ('AZU', 'Azúcares', 8, 'rosa'), ('LIB', 'Libres de energía', 9, 'salvia')
    ) AS v(code, name, ord, tone)
    RETURNING id, code
)
INSERT INTO smae_food_subgroups (group_id, code, name, sort_order)
SELECT g.id, v.code, v.name, v.ord FROM g JOIN (VALUES
    ('VER', 'VER', 'Verduras', 1), ('FRU', 'FRU', 'Frutas', 1),
    ('CER', 'CER-SG', 'Cereales sin grasa', 1), ('CER', 'CER-CG', 'Cereales con grasa', 2),
    ('LEG', 'LEG', 'Leguminosas', 1),
    ('AOA', 'AOA-MB', 'Muy bajo aporte de grasa', 1), ('AOA', 'AOA-B', 'Bajo aporte de grasa', 2),
    ('AOA', 'AOA-M', 'Moderado aporte de grasa', 3), ('AOA', 'AOA-A', 'Alto aporte de grasa', 4),
    ('LEC', 'LEC-D', 'Leche descremada', 1), ('LEC', 'LEC-S', 'Leche semidescremada', 2),
    ('LEC', 'LEC-E', 'Leche entera', 3), ('LEC', 'LEC-A', 'Leche con azúcar', 4),
    ('ACE', 'GRA', 'Grasas sin proteína', 1), ('ACE', 'GRP', 'Grasas con proteína', 2),
    ('AZU', 'AZU', 'Azúcares sin grasa', 1), ('AZU', 'AZU-CG', 'Azúcares con grasa', 2),
    ('LIB', 'LIB', 'Libres de energía', 1)
) AS v(gcode, code, name, ord) ON v.gcode = g.code;
