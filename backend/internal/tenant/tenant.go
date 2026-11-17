// Package tenant lleva «de qué consulta» es cada operación y se lo comunica a PostgreSQL.
//
// El aislamiento entre consultas lo impone la base de datos con seguridad por filas (RLS): cada tabla con datos de una
// consulta tiene `practice_id` y una política que solo deja ver y escribir las filas de la consulta de la sesión
// (`app.practice_id`). Ese valor sale del contexto de cada petición y se fija en la conexión justo al tomarla del pool
// (ver ConfigurePool), de modo que el código de los módulos no puede «olvidar» filtrar.
//
// Falla cerrado: sin consulta en el contexto (y sin Bypass) la base no devuelve ni acepta ninguna fila de consulta.
package tenant

import (
	"context"
	"errors"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ctxKey int

const (
	keyPractice ctxKey = iota
	keyBypass
)

// With devuelve un contexto cuyas operaciones de base de datos pertenecen a la consulta indicada.
func With(ctx context.Context, practice uuid.UUID) context.Context {
	return context.WithValue(ctx, keyPractice, practice)
}

// From devuelve la consulta del contexto (uuid.Nil si no hay).
func From(ctx context.Context) uuid.UUID {
	id, _ := ctx.Value(keyPractice).(uuid.UUID)
	return id
}

// Bypass marca un contexto como «de plataforma»: ve todas las consultas. Solo para tareas internas que cruzan
// consultas por diseño (buscar una cuenta al iniciar sesión, trabajos en segundo plano, migraciones de datos).
// Nunca debe construirse a partir de datos de la petición del usuario.
func Bypass(ctx context.Context) context.Context { return context.WithValue(ctx, keyBypass, true) }

// IsBypass indica si el contexto es de plataforma.
func IsBypass(ctx context.Context) bool { b, _ := ctx.Value(keyBypass).(bool); return b }

type sessionState struct{ practice, bypass string }

func wanted(ctx context.Context) sessionState {
	s := sessionState{}
	if id := From(ctx); id != uuid.Nil {
		s.practice = id.String()
	}
	if IsBypass(ctx) {
		s.bypass = "on"
	}
	return s
}

// ConfigurePool hace que cada conexión salga del pool ya configurada con la consulta del contexto de quien la pide.
// Usa BeforeAcquire (recibe el contexto de la llamada) y recuerda lo último fijado en cada conexión para no repetir
// el viaje a la base cuando no cambia.
func ConfigurePool(cfg *pgxpool.Config) {
	var last sync.Map // *pgx.Conn -> sessionState
	prevClose := cfg.BeforeClose
	cfg.BeforeClose = func(c *pgx.Conn) {
		last.Delete(c)
		if prevClose != nil {
			prevClose(c)
		}
	}
	cfg.BeforeAcquire = func(ctx context.Context, c *pgx.Conn) bool {
		want := wanted(ctx)
		if v, ok := last.Load(c); ok && v.(sessionState) == want {
			return true
		}
		if _, err := c.Exec(ctx, "SELECT set_config('app.practice_id', $1, false), set_config('app.bypass', $2, false)", want.practice, want.bypass); err != nil {
			last.Delete(c)
			return false
		}
		last.Store(c, want)
		return true
	}
}

// VerifyRole falla si el rol de la conexión puede saltarse la seguridad por filas (superusuario o BYPASSRLS): en ese caso
// el aislamiento entre consultas no se cumpliría aunque las políticas existan.
func VerifyRole(ctx context.Context, pool *pgxpool.Pool) error {
	var super, bypass bool
	if err := pool.QueryRow(ctx, "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user").Scan(&super, &bypass); err != nil {
		return err
	}
	if super || bypass {
		return ErrRoleBypassesRLS
	}
	return nil
}

// ErrRoleBypassesRLS indica que la API corre con un rol que ignora las políticas de aislamiento.
var ErrRoleBypassesRLS = errors.New("el rol de base de datos de la API puede saltarse la seguridad por filas: usa APP_DATABASE_URL con el rol nutri_app")

// ScopeTx cambia la consulta de una transacción ya abierta, solo hasta que termine. Sirve cuando la consulta se conoce
// a mitad de la operación (p. ej. al canjear un enlace de invitación, que llega sin sesión).
func ScopeTx(ctx context.Context, tx pgx.Tx, practice uuid.UUID) error {
	_, err := tx.Exec(ctx, "SELECT set_config('app.practice_id', $1, true)", practice.String())
	return err
}

// EnsureAppRole le da inicio de sesión y contraseña al rol de la API tras aplicar las migraciones (que lo crean sin
// inicio de sesión). Se ejecuta con la conexión del propietario; la contraseña va escapada por PostgreSQL, no concatenada.
func EnsureAppRole(ctx context.Context, ownerURL, role, password string) error {
	conn, err := pgx.Connect(ctx, ownerURL)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	var stmt string
	if err := conn.QueryRow(ctx, "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text)", role, password).Scan(&stmt); err != nil {
		return err
	}
	_, err = conn.Exec(ctx, stmt)
	return err
}
