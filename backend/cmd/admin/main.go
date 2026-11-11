// Command admin ejecuta tareas de administración que no tienen interfaz.
//
//	NEW_USER_PASSWORD='...' go run ./cmd/admin create-user -email a@b.mx -name "Lic. X" -role nutritionist
//	go run ./cmd/admin seed-demo-catalog            # catálogo SMAE de EJEMPLO (no oficial), activo
//	go run ./cmd/admin seed-demo-catalog -errata    # edición de ejemplo en borrador, para probar el recálculo
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/smae"
	"github.com/nutri/app-nutricional/backend/internal/smae/sample"
)

func usage() {
	fmt.Fprintln(os.Stderr, "uso:\n  admin create-user -email <correo> -name <nombre> -role <nutritionist|patient>  (contraseña en NEW_USER_PASSWORD)\n  admin seed-demo-catalog [-errata]")
	os.Exit(2)
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer pool.Close()
	log := slog.Default()

	switch os.Args[1] {
	case "create-user":
		createUser(ctx, pool, cfg, log)
	case "seed-demo-catalog":
		seedCatalog(ctx, pool, log)
	default:
		usage()
	}
}

func createUser(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log *slog.Logger) {
	fs := flag.NewFlagSet("create-user", flag.ExitOnError)
	email := fs.String("email", "", "correo")
	name := fs.String("name", "", "nombre para mostrar")
	role := fs.String("role", "nutritionist", "rol")
	_ = fs.Parse(os.Args[2:])
	pw := os.Getenv("NEW_USER_PASSWORD") // no se acepta por flag: quedaría en el historial del shell
	if *email == "" || pw == "" {
		fmt.Fprintln(os.Stderr, "faltan -email y/o la variable NEW_USER_PASSWORD")
		os.Exit(2)
	}
	if *role != "nutritionist" && *role != "patient" {
		fmt.Fprintln(os.Stderr, "rol inválido")
		os.Exit(2)
	}
	svc := auth.NewService(pool, cfg, auth.LogMailer{Log: log}, log)
	id, err := svc.CreateUser(ctx, *email, *name, *role, pw)
	if err != nil {
		fmt.Fprintln(os.Stderr, "no se pudo crear:", err)
		os.Exit(1)
	}
	fmt.Println("usuario creado:", id)
}

func seedCatalog(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	fs := flag.NewFlagSet("seed-demo-catalog", flag.ExitOnError)
	errata := fs.Bool("errata", false, "carga la edición de ejemplo con correcciones (borrador)")
	_ = fs.Parse(os.Args[2:])
	cat := smae.NewService(pool, log)
	dsh := dishes.NewService(pool, cat, log)
	payload := sample.Catalog()
	if *errata {
		payload = sample.Errata()
	}
	rep, err := cat.ImportEdition(ctx, smae.Actor{ID: uuid.Nil}, payload)
	if err != nil {
		fmt.Fprintln(os.Stderr, "no se pudo importar:", err)
		os.Exit(1)
	}
	fmt.Printf("edición importada: %s (%d alimentos, checksum %s)\n", rep.Edition.Name, rep.Foods, rep.Checksum[:12])
	if _, err := cat.ActiveEdition(ctx); err != nil && !*errata {
		if _, err := dsh.ActivateEdition(ctx, dishes.Actor{ID: uuid.Nil}, rep.Edition.ID); err != nil {
			fmt.Fprintln(os.Stderr, "importada, pero no se pudo activar:", err)
			os.Exit(1)
		}
		fmt.Println("edición activada")
	}
}
