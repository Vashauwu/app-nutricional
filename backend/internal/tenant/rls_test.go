package tenant_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

// Tablas sin `practice_id`: identidad compartida y catálogo SMAE (solo lectura para las consultas) y las propias consultas.
// Cualquier tabla nueva que no esté aquí DEBE traer practice_id y su política: esta lista es la guarda contra olvidos.
var globalTables = map[string]bool{
	"users": true, "roles": true, "permissions": true, "user_role_assignments": true, "role_permissions": true,
	"user_sessions": true, "password_reset_tokens": true,
	"smae_editions": true, "smae_import_batches": true, "smae_food_groups": true, "smae_food_subgroups": true, "smae_foods": true, "smae_portions": true,
	"practices": true, "schema_migrations": true,
}

func newPractice(t *testing.T, admin *pgxpool.Pool, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	require.NoError(t, admin.QueryRow(tenant.Bypass(context.Background()), "SELECT create_practice($1)", name).Scan(&id))
	return id
}

func newUser(t *testing.T, admin *pgxpool.Pool, practice uuid.UUID, email string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	require.NoError(t, admin.QueryRow(context.Background(),
		`INSERT INTO users (email, password_hash, status, display_name, practice_id) VALUES ($1, 'x', 'active', $2, $3) RETURNING id`, email, "Usuario", practice).Scan(&id))
	return id
}

func insertPatient(ctx context.Context, pool *pgxpool.Pool, by uuid.UUID, email string) (uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `INSERT INTO patients (first_name, last_name, birth_date, sex, email, created_by) VALUES ('P', 'Q', '1990-01-01', 'F', $1, $2) RETURNING id`, email, by).Scan(&id)
	return id, err
}

func count(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(ctx, sql, args...).Scan(&n))
	return n
}

func TestRowLevelIsolation(t *testing.T) {
	app, admin := testsupport.NewPools(t)
	bg := context.Background()
	pa, pb := newPractice(t, admin, "Consulta A"), newPractice(t, admin, "Consulta B")
	ua, ub := newUser(t, admin, pa, "a@demo.mx"), newUser(t, admin, pb, "b@demo.mx")
	ctxA, ctxB := tenant.With(bg, pa), tenant.With(bg, pb)

	patA, err := insertPatient(ctxA, app, ua, "p@demo.mx")
	require.NoError(t, err)
	patB, err := insertPatient(ctxB, app, ub, "p@demo.mx")
	require.NoError(t, err, "el mismo correo de paciente puede existir en dos consultas distintas")

	t.Run("cada consulta ve solo lo suyo", func(t *testing.T) {
		require.Equal(t, 1, count(t, ctxA, app, "SELECT count(*) FROM patients"))
		require.Equal(t, 1, count(t, ctxB, app, "SELECT count(*) FROM patients"))
		require.Equal(t, 0, count(t, ctxA, app, "SELECT count(*) FROM patients WHERE id = $1", patB))
		require.Equal(t, 0, count(t, ctxB, app, "SELECT count(*) FROM patients WHERE id = $1", patA))
		require.Equal(t, 2, count(t, bg, admin, "SELECT count(*) FROM patients"), "el administrador de la base sí ve ambos")
	})

	t.Run("falla cerrado: sin consulta no se ve ni se escribe nada", func(t *testing.T) {
		require.Equal(t, 0, count(t, bg, app, "SELECT count(*) FROM patients"))
		_, err := insertPatient(bg, app, ua, "sin@demo.mx")
		require.Error(t, err, "sin consulta en el contexto el alta no tiene dueño y se rechaza")
	})

	t.Run("no se puede escribir en la consulta de otra", func(t *testing.T) {
		_, err := app.Exec(ctxA, `INSERT INTO patients (practice_id, first_name, last_name, birth_date, sex, email, created_by) VALUES ($1, 'X', 'Y', '1990-01-01', 'F', 'x@demo.mx', $2)`, pb, ua)
		require.Error(t, err, "forzar practice_id de otra consulta viola la política")
		tag, err := app.Exec(ctxA, `UPDATE patients SET first_name = 'Hack' WHERE id = $1`, patB)
		require.NoError(t, err)
		require.EqualValues(t, 0, tag.RowsAffected(), "actualizar un paciente ajeno no toca ninguna fila")
		tag, err = app.Exec(ctxA, `DELETE FROM patients WHERE id = $1`, patB)
		require.NoError(t, err)
		require.EqualValues(t, 0, tag.RowsAffected())
		_, err = app.Exec(ctxA, `UPDATE patients SET practice_id = $1 WHERE id = $2`, pb, patA)
		require.Error(t, err, "tampoco se puede «regalar» un registro propio a otra consulta")
	})

	t.Run("las consultas y la configuración también están aisladas", func(t *testing.T) {
		require.Equal(t, 1, count(t, ctxA, app, "SELECT count(*) FROM practices"))
		require.Equal(t, 0, count(t, bg, app, "SELECT count(*) FROM practices"))
		_, err := app.Exec(ctxA, "INSERT INTO practices (name) VALUES ('Intrusa')")
		require.Error(t, err, "solo la plataforma crea consultas")
		_, err = app.Exec(ctxA, `INSERT INTO app_settings (key, value) VALUES ('brand', '{"business_name":"A"}')`)
		require.NoError(t, err)
		_, err = app.Exec(ctxB, `INSERT INTO app_settings (key, value) VALUES ('brand', '{"business_name":"B"}')`)
		require.NoError(t, err, "la misma clave de configuración existe una vez por consulta")
		var name string
		require.NoError(t, app.QueryRow(ctxA, `SELECT value->>'business_name' FROM app_settings WHERE key = 'brand'`).Scan(&name))
		require.Equal(t, "A", name)
	})

	t.Run("la auditoría sin consulta solo la ve la plataforma", func(t *testing.T) {
		_, err := app.Exec(bg, `INSERT INTO audit_logs (action, resource_type) VALUES ('auth.login_failed', 'user')`)
		require.NoError(t, err, "un intento de ingreso de una cuenta inexistente se registra sin consulta")
		_, err = app.Exec(ctxA, `INSERT INTO audit_logs (action, resource_type) VALUES ('x.a', 'x')`)
		require.NoError(t, err)
		require.Equal(t, 1, count(t, ctxA, app, "SELECT count(*) FROM audit_logs"), "A ve solo su registro, no el huérfano ni el de B")
		require.GreaterOrEqual(t, count(t, tenant.Bypass(bg), app, "SELECT count(*) FROM audit_logs"), 2)
	})

	t.Run("el rol de la API no puede saltarse las políticas", func(t *testing.T) {
		require.NoError(t, tenant.VerifyRole(bg, app))
		require.ErrorIs(t, tenant.VerifyRole(bg, admin), tenant.ErrRoleBypassesRLS)
	})

	t.Run("crear una consulta deja sus textos legales marcadores", func(t *testing.T) {
		require.Equal(t, 2, count(t, ctxA, app, "SELECT count(*) FROM consent_documents WHERE is_active"))
		require.Equal(t, 2, count(t, ctxB, app, "SELECT count(*) FROM consent_documents WHERE is_active"))
	})
}

// Guarda del esquema: ninguna tabla con datos de una consulta puede quedar sin aislamiento, ahora ni en migraciones futuras.
func TestEveryTenantTableIsProtected(t *testing.T) {
	_, admin := testsupport.NewPools(t)
	ctx := context.Background()
	rows, err := admin.Query(ctx, `
		SELECT c.relname,
		       EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'practice_id' AND NOT a.attisdropped),
		       c.relrowsecurity, c.relforcerowsecurity,
		       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind = 'r'`)
	require.NoError(t, err)
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var name string
		var hasCol, rls, force, policy bool
		require.NoError(t, rows.Scan(&name, &hasCol, &rls, &force, &policy))
		seen++
		if name == "users" {
			require.True(t, hasCol, "users guarda la consulta de cada cuenta") // sin RLS: se consulta antes de saber la consulta (ingreso)
			continue
		}
		if globalTables[name] && name != "practices" {
			require.False(t, hasCol, "%s es global y no debe tener practice_id", name)
			continue
		}
		if name == "practices" {
			require.True(t, rls && force && policy, "practices debe tener RLS forzada")
			continue
		}
		require.True(t, hasCol, "%s guarda datos de una consulta y le falta practice_id (o añádela a globalTables si de verdad es global)", name)
		require.True(t, rls, "%s: RLS no habilitada", name)
		require.True(t, force, "%s: RLS no forzada (el propietario podría saltársela)", name)
		require.True(t, policy, "%s: sin política de aislamiento", name)
	}
	require.NoError(t, rows.Err())
	require.Greater(t, seen, 40)
}

// La migración no pierde ni mueve datos: todo lo que existía queda en la consulta #1 con los mismos conteos.
func TestMigrationKeepsExistingData(t *testing.T) {
	admin := testsupport.NewAdminAt(t, 12)
	ctx := context.Background()
	var uid, pid uuid.UUID
	require.NoError(t, admin.QueryRow(ctx, `INSERT INTO users (email, password_hash, status, display_name) VALUES ('vieja@demo.mx', 'x', 'active', 'Vieja') RETURNING id`).Scan(&uid))
	require.NoError(t, admin.QueryRow(ctx, `INSERT INTO patients (first_name, last_name, birth_date, sex, email, created_by) VALUES ('Ana', 'Vieja', '1990-01-01', 'F', 'ana@demo.mx', $1) RETURNING id`, uid).Scan(&pid))
	_, err := admin.Exec(ctx, `INSERT INTO patient_measurements (patient_id, measured_at, weight_kg, height_cm, bmi, created_by) VALUES ($1, '2026-01-01', 60, 165, 22, $2)`, pid, uid)
	require.NoError(t, err, "tabla de solo inserción: la migración debe poder asignarle consulta sin romper su disparador")
	_, err = admin.Exec(ctx, `INSERT INTO app_settings (key, value) VALUES ('brand', '{"business_name":"Mi Consulta Original"}')`)
	require.NoError(t, err)
	_, err = admin.Exec(ctx, `INSERT INTO audit_logs (action, resource_type) VALUES ('antes', 'x')`)
	require.NoError(t, err)

	before := map[string]int{}
	tables := []string{"users", "patients", "patient_measurements", "app_settings", "audit_logs", "consent_documents"}
	for _, tb := range tables {
		before[tb] = count(t, ctx, admin, "SELECT count(*) FROM "+tb)
	}
	testsupport.ApplyMigration(t, admin, 13)
	for _, tb := range tables {
		want := before[tb]
		if tb == "app_settings" {
			want++ // la migración agrega el perfil de la cuenta existente (inicio guiado ya hecho)
		}
		require.Equal(t, want, count(t, ctx, admin, "SELECT count(*) FROM "+tb), tb+": mismos registros")
	}
	var done string
	require.NoError(t, admin.QueryRow(ctx, "SELECT value->>'onboarding_done' FROM app_settings WHERE key = 'profile'").Scan(&done))
	require.Equal(t, "true", done, "la cuenta que ya tenía marca no repite el inicio guiado")
	var practices int
	require.NoError(t, admin.QueryRow(ctx, "SELECT count(*) FROM practices").Scan(&practices))
	require.Equal(t, 1, practices, "una sola consulta (la #1) para todo lo anterior")
	var name string
	require.NoError(t, admin.QueryRow(ctx, "SELECT name FROM practices").Scan(&name))
	require.Equal(t, "Mi Consulta Original", name, "toma el nombre comercial guardado")
	for _, tb := range []string{"users", "patients", "patient_measurements", "app_settings", "audit_logs", "consent_documents"} {
		require.Equal(t, 0, count(t, ctx, admin, "SELECT count(*) FROM "+tb+" WHERE practice_id IS NULL OR practice_id <> (SELECT id FROM practices)"), tb+": todo en la consulta #1")
	}
}

// Reproduce el arranque real de un ambiente: migra con el propietario, la API prepara su rol con la contraseña del .env y
// se conecta como ese rol (no como superusuario).
func TestStartupRoleSetup(t *testing.T) {
	dsn := testsupport.NewOwnerDSN(t)
	ctx := context.Background()
	const pw = "p@ss'w\"ord;--"
	require.NoError(t, tenant.EnsureAppRole(ctx, dsn, config.AppDBRole, pw), "la contraseña con comillas se escapa, no se concatena")

	cfg := config.Config{DatabaseURL: dsn, AppDBPassword: pw}
	pcfg, err := pgxpool.ParseConfig(cfg.RuntimeDatabaseURL())
	require.NoError(t, err)
	tenant.ConfigurePool(pcfg)
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	require.NoError(t, err)
	defer pool.Close()
	var user string
	require.NoError(t, pool.QueryRow(ctx, "SELECT current_user").Scan(&user))
	require.Equal(t, config.AppDBRole, user)
	require.NoError(t, tenant.VerifyRole(ctx, pool))

	// Sin APP_DB_PASSWORD ni APP_DATABASE_URL la API usaría el propietario: VerifyRole lo detecta (en producción no arranca).
	owner, err := pgxpool.New(ctx, config.Config{DatabaseURL: dsn}.RuntimeDatabaseURL())
	require.NoError(t, err)
	defer owner.Close()
	require.ErrorIs(t, tenant.VerifyRole(ctx, owner), tenant.ErrRoleBypassesRLS)
}
