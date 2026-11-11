-- Indicadores del tablero de la nutrióloga (MVP_SPEC §13).
-- name: DashboardPatientCounts :one
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE p.status = 'active')::int AS active,
       count(*) FILTER (WHERE p.status = 'invited')::int AS invited,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM consent_documents d
         WHERE d.is_active AND NOT EXISTS (
           SELECT 1 FROM consent_acceptances a WHERE a.consent_document_id = d.id AND a.patient_id = p.id AND a.revoked_at IS NULL)))::int AS consent_pending
FROM patients p WHERE p.deleted_at IS NULL;

-- name: DashboardPlanCounts :many
SELECT status, count(*)::int AS n FROM meal_plans WHERE deleted_at IS NULL GROUP BY status;

-- name: PlansEndingSoon :many
SELECT p.id, p.name, p.patient_id, (pa.first_name || ' ' || pa.last_name)::text AS patient_name, p.end_date
FROM meal_plans p JOIN patients pa ON pa.id = p.patient_id
WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.end_date BETWEEN $1 AND $2
ORDER BY p.end_date, p.id LIMIT 10;

-- name: ComplianceByPatient :many
SELECT p.patient_id, (pa.first_name || ' ' || pa.last_name)::text AS patient_name,
       count(*)::int AS planned,
       count(*) FILTER (WHERE t.status = 'done')::int AS done,
       count(*) FILTER (WHERE t.status = 'skipped')::int AS skipped
FROM meal_slot_items i
JOIN meal_slots s ON s.id = i.slot_id AND s.removed_at IS NULL
JOIN meal_plan_days d ON d.id = s.day_id AND d.removed_at IS NULL
JOIN meal_plans p ON p.id = d.plan_id AND p.deleted_at IS NULL AND p.status <> 'draft'
JOIN patients pa ON pa.id = p.patient_id AND pa.deleted_at IS NULL
LEFT JOIN tracking_entries t ON t.item_id = i.id
WHERE i.removed_at IS NULL AND d.plan_date BETWEEN $1 AND $2
GROUP BY p.patient_id, pa.first_name, pa.last_name
ORDER BY patient_name;
