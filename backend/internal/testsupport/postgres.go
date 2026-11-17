// Package testsupport levanta un PostgreSQL real en contenedor para pruebas de integración (§22).
// Solo lo importan archivos _test.go; no forma parte del binario de la API.
package testsupport

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

// NewPool devuelve un pool con todas las migraciones aplicadas y conectado como el rol de la API (`nutri_app`, sin
// superusuario ni BYPASSRLS), con el contexto de consulta activo: así las pruebas ejercen el aislamiento real.
// Omite la prueba si Docker no está disponible.
func NewPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	app, _ := NewPools(t)
	return app
}

// NewPools devuelve además un pool de administración (propietario/superusuario, ve todo y no depende del contexto) para
// preparar o comprobar datos por encima del aislamiento.
func NewPools(t *testing.T) (app, admin *pgxpool.Pool) {
	t.Helper()
	admin, dsn := newDatabase(t)
	applyMigrations(t, admin, 0, 0)
	return appPool(t, admin, dsn), admin
}

// NewAdminAt devuelve un pool de administración con las migraciones aplicadas SOLO hasta `upTo` (inclusive), para probar
// cómo una migración transforma datos que ya existían. Con ApplyMigration se aplica una versión concreta después.
func NewAdminAt(t *testing.T, upTo int) *pgxpool.Pool {
	t.Helper()
	admin, _ := newDatabase(t)
	applyMigrations(t, admin, 0, upTo)
	return admin
}

// ApplyMigration aplica una sola migración (por su número) sobre el pool de administración.
func ApplyMigration(t *testing.T, admin *pgxpool.Pool, version int) {
	t.Helper()
	applyMigrations(t, admin, version, version)
}

func newDatabase(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	testcontainers.SkipIfProviderIsNotHealthy(t)
	ctx := context.Background()
	ctr, err := postgres.Run(ctx, "postgres:17-alpine",
		postgres.WithDatabase("nutri"), postgres.WithUsername("nutri"), postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(90*time.Second)))
	require.NoError(t, err)
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(ctr) })
	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	admin, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(admin.Close)
	return admin, dsn
}

// applyMigrations aplica las migraciones con número en [from, to]; to == 0 significa «todas».
func applyMigrations(t *testing.T, admin *pgxpool.Pool, from, to int) {
	t.Helper()
	_, here, _, _ := runtime.Caller(0)
	files, err := filepath.Glob(filepath.Join(filepath.Dir(here), "..", "..", "migrations", "*.up.sql"))
	require.NoError(t, err)
	sort.Strings(files)
	require.NotEmpty(t, files)
	for _, f := range files {
		n, _ := strconv.Atoi(strings.SplitN(filepath.Base(f), "_", 2)[0])
		if n < from || (to != 0 && n > to) {
			continue
		}
		sql, err := os.ReadFile(f)
		require.NoError(t, err)
		_, err = admin.Exec(context.Background(), string(sql))
		require.NoError(t, err, f)
	}
}

// appPool conecta como el rol de la API. La migración lo crea sin inicio de sesión; el despliegue le da contraseña. Aquí igual.
func appPool(t *testing.T, admin *pgxpool.Pool, dsn string) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	_, err := admin.Exec(ctx, "ALTER ROLE nutri_app LOGIN PASSWORD 'test'")
	require.NoError(t, err)
	u, err := url.Parse(dsn)
	require.NoError(t, err)
	u.User = url.UserPassword("nutri_app", "test")
	pcfg, err := pgxpool.ParseConfig(u.String())
	require.NoError(t, err)
	tenant.ConfigurePool(pcfg)
	app, err := pgxpool.NewWithConfig(ctx, pcfg)
	require.NoError(t, err)
	t.Cleanup(app.Close)
	return app
}

// CtxOf devuelve un contexto limitado a la consulta de la persona con ese correo. `users` no está sujeta al aislamiento,
// así que se puede consultar sin contexto.
func CtxOf(t *testing.T, pool *pgxpool.Pool, email string) context.Context {
	t.Helper()
	var id uuid.UUID
	require.NoError(t, pool.QueryRow(context.Background(), "SELECT practice_id FROM users WHERE email = $1", email).Scan(&id))
	return tenant.With(context.Background(), id)
}

// NewPractice crea una consulta (como lo hace la plataforma) y devuelve un contexto limitado a ella: las cuentas que se
// creen con él se unen a esa consulta y todo lo que se haga con él ve y escribe solo en ese espacio.
func NewPractice(t *testing.T, pool *pgxpool.Pool) context.Context {
	t.Helper()
	var id uuid.UUID
	require.NoError(t, pool.QueryRow(tenant.Bypass(context.Background()), "SELECT create_practice('Consulta de prueba')").Scan(&id))
	return tenant.With(context.Background(), id)
}

// NewOwnerDSN devuelve la cadena de conexión del propietario de una base nueva con TODAS las migraciones aplicadas (sin
// haberle dado contraseña al rol de la API): reproduce el estado en que queda un ambiente tras migrar, antes de EnsureAppRole.
func NewOwnerDSN(t *testing.T) string {
	t.Helper()
	admin, dsn := newDatabase(t)
	applyMigrations(t, admin, 0, 0)
	return dsn
}

// GrantPlatformAdmin da a una cuenta la administración del catálogo SMAE global (en producción solo la plataforma la tiene).
func GrantPlatformAdmin(t *testing.T, pool *pgxpool.Pool, email string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `INSERT INTO user_role_assignments (user_id, role_id)
		SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.code = 'platform_admin' ON CONFLICT DO NOTHING`, email)
	require.NoError(t, err)
}
