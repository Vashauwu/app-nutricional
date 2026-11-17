-- Operaciones de plataforma sobre consultas: requieren un contexto con tenant.Bypass.

-- name: CreatePractice :one
SELECT create_practice($1)::uuid AS id;

-- name: ListActivePracticeIDs :many
SELECT id FROM practices WHERE status = 'active' ORDER BY created_at;
