// Package sample incluye un catálogo SINTÉTICO para desarrollo, demostración y pruebas.
// No reproduce tablas del libro SMAE ni son datos oficiales (MVP_SPEC §25.1, §30).
// La carga real requiere una fuente licenciada y su proceso de importación autorizado.
package sample

import (
	"embed"
	"encoding/json"

	"github.com/nutri/app-nutricional/backend/internal/smae"
)

//go:embed sample_catalog.json sample_errata.json
var files embed.FS

func load(name string) smae.ImportPayload {
	b, err := files.ReadFile(name)
	if err != nil {
		panic(err)
	}
	var p smae.ImportPayload
	if err := json.Unmarshal(b, &p); err != nil {
		panic(err)
	}
	return p
}

// Catalog es la edición base de ejemplo.
func Catalog() smae.ImportPayload { return load("sample_catalog.json") }

// Errata es una edición de ejemplo que corrige cuatro alimentos (para probar el recálculo).
func Errata() smae.ImportPayload { return load("sample_errata.json") }
