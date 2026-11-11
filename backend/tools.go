//go:build tools

// Fija en go.mod las dependencias del stack (MVP_SPEC §21.1) que los módulos
// aún no importan, para que `go mod tidy` no las elimine. Quita cada línea
// cuando el módulo correspondiente la importe directamente.
package tools

import (
	_ "github.com/golang-migrate/migrate/v4"                         // migraciones SQL versionadas
	_ "github.com/swaggo/files"                                      // OpenAPI / Swagger UI
	_ "github.com/swaggo/gin-swagger"                                // OpenAPI / Swagger UI
	_ "github.com/testcontainers/testcontainers-go/modules/postgres" // pruebas de integración con PostgreSQL real
)
