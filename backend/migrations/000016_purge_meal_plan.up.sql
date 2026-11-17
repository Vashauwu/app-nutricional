-- Borrado permanente de un plan: elimina el plan y todo lo que depende de él (días, tiempos, platillos, historial, versiones
-- publicadas y el seguimiento que registró el paciente, con sus comentarios y fotografías). Las revisiones y publicaciones son
-- inmutables (triggers), así que solo esta función —con los privilegios de quien es dueño de las tablas— puede quitarlas, y solo
-- las del plan indicado y de la consulta de la sesión. Devuelve cuántos registros de seguimiento y archivos se eliminaron.
CREATE FUNCTION purge_meal_plan(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
    pr uuid;
    entries int := 0;
    fids uuid[];
BEGIN
    SELECT practice_id INTO pr FROM meal_plans WHERE id = p_id;
    IF pr IS NULL OR NOT (pr = app_practice_id() OR app_bypass()) THEN
        RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Seguimiento del paciente sobre este plan.
    DELETE FROM meal_comments WHERE entry_id IN (SELECT id FROM tracking_entries WHERE plan_id = p_id);
    WITH d AS (DELETE FROM tracking_photos WHERE entry_id IN (SELECT id FROM tracking_entries WHERE plan_id = p_id) RETURNING file_object_id)
    SELECT array_agg(file_object_id) INTO fids FROM d;
    IF fids IS NOT NULL THEN
        DELETE FROM file_objects WHERE id = ANY (fids);
    END IF;
    WITH d AS (DELETE FROM tracking_entries WHERE plan_id = p_id RETURNING 1) SELECT count(*) INTO entries FROM d;

    -- Historial, versiones y publicaciones (inmutables: se apagan sus triggers solo dentro de esta transacción).
    DELETE FROM meal_plan_events WHERE plan_id = p_id;
    ALTER TABLE meal_plan_publications DISABLE TRIGGER meal_plan_publications_immutable;
    ALTER TABLE meal_plan_revisions DISABLE TRIGGER meal_plan_revisions_immutable;
    DELETE FROM meal_plan_publications WHERE plan_id = p_id;
    DELETE FROM meal_plan_revisions WHERE plan_id = p_id;
    ALTER TABLE meal_plan_revisions ENABLE TRIGGER meal_plan_revisions_immutable;
    ALTER TABLE meal_plan_publications ENABLE TRIGGER meal_plan_publications_immutable;

    -- El plan y su calendario.
    DELETE FROM meal_slot_items WHERE slot_id IN (SELECT s.id FROM meal_slots s JOIN meal_plan_days d ON d.id = s.day_id WHERE d.plan_id = p_id);
    DELETE FROM meal_slots WHERE day_id IN (SELECT id FROM meal_plan_days WHERE plan_id = p_id);
    DELETE FROM meal_plan_days WHERE plan_id = p_id;
    DELETE FROM meal_plans WHERE id = p_id;

    RETURN jsonb_build_object('tracking_entries', entries, 'files', COALESCE(cardinality(fids), 0));
END
$fn$;
REVOKE ALL ON FUNCTION purge_meal_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_meal_plan(uuid) TO nutri_app;
