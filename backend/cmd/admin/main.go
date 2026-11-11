// Command admin ejecuta tareas de administración que no tienen interfaz.
//
//	NEW_USER_PASSWORD='...' go run ./cmd/admin set-password -email a@b.mx    # cambia la contraseña y cierra sus sesiones
//	NEW_USER_PASSWORD='...' go run ./cmd/admin create-user -email a@b.mx -name "Lic. X" -role nutritionist
//	go run ./cmd/admin seed-demo-catalog            # catálogo SMAE de EJEMPLO (no oficial), activo
//	go run ./cmd/admin seed-demo-catalog -errata    # edición de ejemplo en borrador, para probar el recálculo
//	ALLOW_DEMO_ACCOUNTS=true go run ./cmd/admin seed-demo-accounts   # cuentas de ejemplo (SOLO staging/desarrollo)
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/smae"
	"github.com/nutri/app-nutricional/backend/internal/smae/sample"
)

func usage() {
	fmt.Fprintln(os.Stderr, "uso:\n  admin set-password -email <correo>  (nueva contraseña en NEW_USER_PASSWORD)\n  admin create-user -email <correo> -name <nombre> -role <nutritionist|patient>  (contraseña en NEW_USER_PASSWORD)\n  admin seed-demo-catalog [-errata]\n  admin seed-demo-accounts   (solo con ALLOW_DEMO_ACCOUNTS=true)")
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
	case "set-password":
		setPassword(ctx, pool, cfg, log)
	case "seed-demo-catalog":
		seedCatalog(ctx, pool, log)
	case "seed-demo-accounts":
		seedAccounts(ctx, pool, cfg, log)
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

// seedAccounts crea las cuentas de ejemplo del ingreso de staging (contraseña demo1234). Se niega a correr si
// ALLOW_DEMO_ACCOUNTS no es "true": en producción esa variable no existe y las contraseñas conocidas no deben crearse.
func seedAccounts(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log *slog.Logger) {
	if os.Getenv("ALLOW_DEMO_ACCOUNTS") != "true" {
		fmt.Fprintln(os.Stderr, "rechazado: las cuentas de ejemplo tienen una contraseña conocida y solo se crean con ALLOW_DEMO_ACCOUNTS=true (staging o desarrollo)")
		os.Exit(2)
	}
	const pw = "demo1234"
	svc := auth.NewService(pool, cfg, auth.LogMailer{Log: log}, log)
	q := db.New(pool)
	exists := func(email string) bool {
		var n int
		_ = pool.QueryRow(ctx, "SELECT count(*) FROM users WHERE email = $1", email).Scan(&n)
		return n > 0
	}
	nutri := uuid.Nil
	if !exists("nutri@demo.mx") {
		id, err := svc.CreateUser(ctx, "nutri@demo.mx", "Lic. Valeria Ruiz", "nutritionist", pw)
		if err != nil {
			fmt.Fprintln(os.Stderr, "nutrióloga:", err)
			os.Exit(1)
		}
		nutri = id
		fmt.Println("creada: nutri@demo.mx")
	}
	if nutri == uuid.Nil {
		_ = pool.QueryRow(ctx, "SELECT id FROM users WHERE email = 'nutri@demo.mx'").Scan(&nutri)
	}
	docs, err := q.ListActiveConsentDocuments(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "documentos legales:", err)
		os.Exit(1)
	}
	for _, p := range []struct {
		email, first, last string
		consent            bool
	}{{"ana@demo.mx", "Ana", "Lucía Torres", true}, {"daniela@demo.mx", "Daniela", "Soto", false}} {
		if exists(p.email) {
			continue
		}
		uid, err := svc.CreateUser(ctx, p.email, p.first+" "+p.last, "patient", pw)
		if err != nil {
			fmt.Fprintln(os.Stderr, p.email+":", err)
			os.Exit(1)
		}
		pt, err := q.CreatePatient(ctx, db.CreatePatientParams{UserID: uuid.NullUUID{UUID: uid, Valid: true}, Status: "active", FirstName: p.first, LastName: p.last,
			BirthDate: pgtype.Date{Time: time.Date(1990, 5, 12, 0, 0, 0, 0, time.UTC), Valid: true}, Sex: "F", Email: p.email, Phone: "5555550000", Goal: "maintenance", CreatedBy: nutri})
		if err != nil {
			fmt.Fprintln(os.Stderr, "paciente:", err)
			os.Exit(1)
		}
		if p.consent {
			for _, d := range docs {
				if _, err := q.InsertAcceptance(ctx, db.InsertAcceptanceParams{PatientID: pt.ID, ConsentDocumentID: d.ID, AcceptanceMethod: "in_person", EvidenceMetadata: []byte("{}")}); err != nil {
					fmt.Fprintln(os.Stderr, "consentimiento:", err)
					os.Exit(1)
				}
			}
		}
		fmt.Println("creada:", p.email)
	}
	fmt.Println("listo. Contraseña de las tres cuentas: demo1234")
}

func setPassword(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log *slog.Logger) {
	fs := flag.NewFlagSet("set-password", flag.ExitOnError)
	email := fs.String("email", "", "correo de la cuenta")
	_ = fs.Parse(os.Args[2:])
	pw := os.Getenv("NEW_USER_PASSWORD") // por variable de entorno: por flag quedaría en el historial del shell
	if *email == "" || pw == "" {
		fmt.Fprintln(os.Stderr, "faltan -email y/o la variable NEW_USER_PASSWORD")
		os.Exit(2)
	}
	svc := auth.NewService(pool, cfg, auth.LogMailer{Log: log}, log)
	if err := svc.SetPasswordByEmail(ctx, *email, pw); err != nil {
		fmt.Fprintln(os.Stderr, "no se pudo cambiar:", err)
		os.Exit(1)
	}
	fmt.Println("contraseña actualizada; se cerraron las sesiones abiertas de esa cuenta")
}
