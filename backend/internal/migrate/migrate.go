// Package migrate aplica las migraciones SQL versionadas (MVP_SPEC §21.8).
package migrate

import (
	"errors"
	"fmt"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // driver pgx5://
	"github.com/golang-migrate/migrate/v4/source/iofs"

	"github.com/nutri/app-nutricional/backend/migrations"
)

// Up aplica todas las migraciones pendientes. Es idempotente.
func Up(databaseURL string) error {
	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return err
	}
	url := databaseURL
	for _, prefix := range []string{"postgres://", "postgresql://"} {
		if strings.HasPrefix(url, prefix) {
			url = "pgx5://" + strings.TrimPrefix(url, prefix)
		}
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, url)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}
