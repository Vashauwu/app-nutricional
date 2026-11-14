-- name: CreatePatient :one
INSERT INTO patients (user_id, status, first_name, last_name, birth_date, sex, email, phone, goal, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetPatient :one
SELECT * FROM patients WHERE id = $1;

-- Solo el nombre y si está activo (agenda).
-- name: GetPatientName :one
SELECT first_name, last_name, deleted_at FROM patients WHERE id = $1;

-- Solo las indicaciones clínicas (alertas).
-- name: GetPatientIndications :one
SELECT clinical_indications FROM patients WHERE id = $1;

-- name: GetPatientByUserID :one
SELECT * FROM patients WHERE user_id = $1 AND deleted_at IS NULL;

-- Filtros en el servidor y paginación (§16, §20.2). Búsqueda sin acentos.
-- name: ListPatients :many
SELECT p.*, count(*) OVER () AS total,
       NOT EXISTS (
         SELECT 1 FROM consent_documents d
         WHERE d.is_active AND NOT EXISTS (
           SELECT 1 FROM consent_acceptances a
           WHERE a.consent_document_id = d.id AND a.patient_id = p.id AND a.revoked_at IS NULL)
       ) AS consent_complete
FROM patients p
WHERE ((p.deleted_at IS NOT NULL) = sqlc.arg(only_deleted)::bool)
  AND (sqlc.arg(status)::text = '' OR p.status = sqlc.arg(status)::text)
  AND (sqlc.arg(goal)::text = '' OR p.goal = sqlc.arg(goal)::text)
  AND (sqlc.arg(search)::text = ''
       OR unaccent(p.first_name || ' ' || p.last_name || ' ' || p.email || ' ' || p.phone) ILIKE '%' || unaccent(sqlc.arg(search)::text) || '%')
ORDER BY lower(p.last_name), lower(p.first_name), p.id
LIMIT sqlc.arg(page_limit)::int OFFSET sqlc.arg(page_offset)::int;

-- name: UpdatePatient :one
UPDATE patients SET
    first_name = $2, last_name = $3, birth_date = $4, sex = $5, email = $6, phone = $7,
    goal = $8, goal_notes = $9, clinical_indications = $10, measurements_visible = $11,
    quota_override_bytes = $12, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetPatientDeleted :one
UPDATE patients SET
    deleted_at = CASE WHEN sqlc.arg(deleted)::bool THEN now() ELSE NULL END,
    -- Al restaurar: «invitado» solo si su cuenta sigue sin activarse; un paciente registrado a mano (sin cuenta) vuelve a «activo».
    status = CASE WHEN sqlc.arg(deleted)::bool THEN 'inactive'
                  WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = patients.user_id AND u.status = 'invited') THEN 'invited'
                  ELSE 'active' END,
    updated_at = now()
WHERE patients.id = sqlc.arg(id)
RETURNING *;

-- name: LinkPatientUser :exec
UPDATE patients SET user_id = $2, updated_at = now() WHERE id = $1;

-- Un paciente registrado a mano recibe cuenta e invitación: queda «invitado» hasta que cree su contraseña.
-- name: SetPatientInvited :exec
UPDATE patients SET status = 'invited', updated_at = now() WHERE id = $1;

-- name: ActivatePatientByUser :exec
UPDATE patients SET status = 'active', updated_at = now() WHERE user_id = $1 AND status = 'invited';

-- name: PatientEmailTaken :one
SELECT EXISTS (SELECT 1 FROM patients WHERE email = $1 AND deleted_at IS NULL AND id <> $2);

-- ---------- Mediciones (append-only) ----------
-- name: InsertMeasurement :one
INSERT INTO patient_measurements (patient_id, measured_at, weight_kg, height_cm, bmi, waist_cm, hip_cm, body_fat_pct, notes, created_by,
                                  fat_mass_kg, muscle_pct, muscle_mass_kg, visceral_fat, bone_kg, obesity_pct, girths)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
RETURNING *;

-- name: ListMeasurements :many
SELECT * FROM patient_measurements WHERE patient_id = $1 ORDER BY measured_at DESC, created_at DESC;

-- ---------- Condiciones ----------
-- name: ListConditions :many
SELECT * FROM patient_conditions WHERE patient_id = $1 ORDER BY created_at;
-- name: InsertCondition :one
INSERT INTO patient_conditions (patient_id, name, details, status) VALUES ($1, $2, $3, $4) RETURNING *;
-- name: UpdateCondition :one
UPDATE patient_conditions SET name = $3, details = $4, status = $5 WHERE id = $1 AND patient_id = $2 RETURNING *;
-- name: DeleteCondition :execrows
DELETE FROM patient_conditions WHERE id = $1 AND patient_id = $2;

-- ---------- Alergias ----------
-- name: ListAllergies :many
SELECT * FROM patient_allergies WHERE patient_id = $1 ORDER BY created_at;
-- name: InsertAllergy :one
INSERT INTO patient_allergies (patient_id, allergen, aliases, reaction, severity, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
-- name: UpdateAllergy :one
UPDATE patient_allergies SET allergen = $3, aliases = $4, reaction = $5, severity = $6, status = $7 WHERE id = $1 AND patient_id = $2 RETURNING *;
-- name: DeleteAllergy :execrows
DELETE FROM patient_allergies WHERE id = $1 AND patient_id = $2;

-- ---------- Medicamentos ----------
-- name: ListMedications :many
SELECT * FROM patient_medications WHERE patient_id = $1 ORDER BY created_at;
-- name: InsertMedication :one
INSERT INTO patient_medications (patient_id, name, dose, frequency, start_date, end_date, status, kind) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
-- name: UpdateMedication :one
UPDATE patient_medications SET name = $3, dose = $4, frequency = $5, start_date = $6, end_date = $7, status = $8, kind = $9 WHERE id = $1 AND patient_id = $2 RETURNING *;
-- name: DeleteMedication :execrows
DELETE FROM patient_medications WHERE id = $1 AND patient_id = $2;

-- ---------- Preferencias ----------
-- name: ListPreferences :many
SELECT * FROM patient_food_preferences WHERE patient_id = $1 ORDER BY created_at;
-- name: InsertPreference :one
INSERT INTO patient_food_preferences (patient_id, food_name, preference_type, notes) VALUES ($1, $2, $3, $4) RETURNING *;
-- name: UpdatePreference :one
UPDATE patient_food_preferences SET food_name = $3, preference_type = $4, notes = $5 WHERE id = $1 AND patient_id = $2 RETURNING *;
-- name: DeletePreference :execrows
DELETE FROM patient_food_preferences WHERE id = $1 AND patient_id = $2;

-- ---------- Notas privadas ----------
-- name: ListNotes :many
SELECT * FROM patient_notes WHERE patient_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC;
-- name: InsertNote :one
INSERT INTO patient_notes (patient_id, author_user_id, body) VALUES ($1, $2, $3) RETURNING *;
-- name: SoftDeleteNote :execrows
UPDATE patient_notes SET deleted_at = now() WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL;

-- ---------- Consentimientos ----------
-- name: ListActiveConsentDocuments :many
SELECT * FROM consent_documents WHERE is_active ORDER BY document_type;

-- Documentos vigentes que el paciente todavía no acepta.
-- name: ListPendingConsentDocuments :many
SELECT d.* FROM consent_documents d
WHERE d.is_active
  AND NOT EXISTS (SELECT 1 FROM consent_acceptances a
                  WHERE a.consent_document_id = d.id AND a.patient_id = $1 AND a.revoked_at IS NULL)
ORDER BY d.document_type;

-- name: InsertAcceptance :one
INSERT INTO consent_acceptances (patient_id, consent_document_id, acceptance_method, evidence_metadata)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListAcceptances :many
SELECT a.id, a.patient_id, a.consent_document_id, a.accepted_at, a.acceptance_method, a.evidence_metadata, a.revoked_at,
       d.document_type, d.version, d.title
FROM consent_acceptances a
JOIN consent_documents d ON d.id = a.consent_document_id
WHERE a.patient_id = $1
ORDER BY a.accepted_at DESC;

-- name: RevokeAcceptance :execrows
UPDATE consent_acceptances SET revoked_at = now() WHERE id = $1 AND patient_id = $2 AND revoked_at IS NULL;
