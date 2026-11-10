//go:build tools

// Fija en go.mod las dependencias del stack (MVP_SPEC §21.1) que los módulos
// aún no importan, para que `go mod tidy` no las elimine. Quita cada línea
// cuando el módulo correspondiente la importe directamente.
package tools

import (
	_ "github.com/alexedwards/argon2id"                              // auth: hash de contraseñas
	_ "github.com/aws/aws-sdk-go-v2/config"                          // storage: S3-compatible
	_ "github.com/aws/aws-sdk-go-v2/service/s3"                      // storage: S3-compatible
	_ "github.com/disintegration/imaging"                            // storage: redimensionado y miniaturas
	_ "github.com/golang-jwt/jwt/v5"                                 // auth: access tokens
	_ "github.com/golang-migrate/migrate/v4"                         // migraciones SQL versionadas
	_ "github.com/jung-kurt/gofpdf"                                  // reports: PDF
	_ "github.com/swaggo/files"                                      // OpenAPI / Swagger UI
	_ "github.com/swaggo/gin-swagger"                                // OpenAPI / Swagger UI
	_ "github.com/testcontainers/testcontainers-go/modules/postgres" // pruebas de integración con PostgreSQL real
	_ "github.com/xuri/excelize/v2"                                  // reports: Excel
)
