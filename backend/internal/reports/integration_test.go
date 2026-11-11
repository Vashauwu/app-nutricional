package reports_test

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/reports"
	"github.com/nutri/app-nutricional/backend/internal/settings"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
	"github.com/nutri/app-nutricional/backend/internal/tracking"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }

func TestTableSafety(t *testing.T) {
	tb := reports.Table{Name: "T", Headers: []string{"a", "b", "c", "d"}, Rows: [][]string{{"=1+1", "-5.2", "@cmd", "+SUM(A1)"}, {"normal", "-texto", "ñandú", ""}}}
	raw, err := tb.CSV()
	require.NoError(t, err)
	require.True(t, bytes.HasPrefix(raw, []byte{0xEF, 0xBB, 0xBF}), "BOM para Excel")
	recs, err := csv.NewReader(bytes.NewReader(raw[3:])).ReadAll()
	require.NoError(t, err)
	require.Equal(t, []string{"'=1+1", "-5.2", "'@cmd", "'+SUM(A1)"}, recs[1], "las fórmulas se neutralizan y los números negativos se conservan")
	require.Equal(t, []string{"normal", "'-texto", "ñandú", ""}, recs[2])

	x, err := tb.XLSX()
	require.NoError(t, err)
	f, err := excelize.OpenReader(bytes.NewReader(x))
	require.NoError(t, err)
	v, _ := f.GetCellValue("T", "A2")
	require.Equal(t, "'=1+1", v)
	formula, _ := f.GetCellFormula("T", "A2")
	require.Empty(t, formula, "nada se guarda como fórmula")
}

func TestReportsIntegration(t *testing.T) {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute, Timezone: "America/Mexico_City"}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	set := settings.NewService(pool, log)
	trk := tracking.NewService(pool, nil, cfg.Timezone, log)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	reports.NewController(reports.NewService(pool, ps, trk, log), as, set, log).Register(v1)
	srv := httptest.NewServer(r)
	defer srv.Close()
	ctx := context.Background()

	_, err := as.CreateUser(ctx, "nutri@demo.mx", "Lic.", "nutritionist", "demo1234")
	require.NoError(t, err)
	nutri := testsupport.NewClient(t, srv.URL)
	nutri.Login("nutri@demo.mx", "demo1234")

	code, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": "=Ana", "last_name": "Pérez", "birth_date": "1990-01-01", "sex": "F", "email": "ana@demo.mx", "goal": "weight_loss"})
	require.Equal(t, 201, code, fmt.Sprint(p))
	pid := p["id"].(string)
	_, cs := nutri.Do("GET", "/api/v1/patients/"+pid+"/consents", nil)
	var ids []string
	for _, d := range cs["pending"].([]any) {
		ids = append(ids, d.(map[string]any)["id"].(string))
	}
	nutri.Do("POST", "/api/v1/patients/"+pid+"/consents/record", map[string]any{"document_ids": ids})
	code, m := nutri.Do("POST", "/api/v1/patients/"+pid+"/measurements", map[string]any{"measured_at": "2026-01-10", "weight_kg": "80.5", "height_cm": "165", "waist_cm": "90"})
	require.Equal(t, 201, code, fmt.Sprint(m))
	nutri.Do("POST", "/api/v1/patients/"+pid+"/measurements", map[string]any{"measured_at": "2026-02-10", "weight_kg": "78.9", "height_cm": "165"})

	t.Run("CSV de pacientes, con BOM y fórmulas neutralizadas", func(t *testing.T) {
		status, ct, body := nutri.GetRaw("/api/v1/exports/patients")
		require.Equal(t, 200, status)
		require.Contains(t, ct, "text/csv")
		require.True(t, bytes.HasPrefix(body, []byte{0xEF, 0xBB, 0xBF}))
		recs, err := csv.NewReader(bytes.NewReader(body[3:])).ReadAll()
		require.NoError(t, err)
		require.Len(t, recs, 2)
		require.Equal(t, "'=Ana", recs[1][0])
	})

	t.Run("Excel de mediciones con valores decimales exactos", func(t *testing.T) {
		status, ct, body := nutri.GetRaw("/api/v1/exports/patients/" + pid + "/measurements?format=xlsx")
		require.Equal(t, 200, status)
		require.Contains(t, ct, "spreadsheetml")
		f, err := excelize.OpenReader(bytes.NewReader(body))
		require.NoError(t, err)
		rows, err := f.GetRows("Mediciones")
		require.NoError(t, err)
		require.Len(t, rows, 3)
		require.Equal(t, "2026-02-10", rows[1][0], "más reciente primero")
		require.Equal(t, "78.9", rows[1][1])
		require.Equal(t, "80.5", rows[2][1])
	})

	t.Run("seguimiento CSV, PDF y validaciones", func(t *testing.T) {
		status, _, body := nutri.GetRaw("/api/v1/exports/patients/" + pid + "/tracking?format=csv")
		require.Equal(t, 200, status)
		require.Contains(t, string(body), "Platillo")

		status, ct, pdf := nutri.GetRaw("/api/v1/reports/patients/" + pid + "/summary.pdf")
		require.Equal(t, 200, status)
		require.Equal(t, "application/pdf", ct)
		require.True(t, strings.HasPrefix(string(pdf), "%PDF-"))
		require.Greater(t, len(pdf), 1000)

		status, _, _ = nutri.GetRaw("/api/v1/exports/patients?format=exe")
		require.Equal(t, 422, status)
		status, _, _ = nutri.GetRaw("/api/v1/exports/patients/00000000-0000-0000-0000-000000000001/measurements")
		require.Equal(t, 404, status)
		status, _, _ = nutri.GetRaw("/api/v1/reports/patients/" + pid + "/summary.pdf?from=ayer")
		require.Equal(t, 422, status)
	})

	t.Run("cada exportación queda en la bitácora de auditoría", func(t *testing.T) {
		var n int
		require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE action LIKE 'export.%'`).Scan(&n))
		require.GreaterOrEqual(t, n, 4)
	})

	t.Run("solo con permiso reports:read y sesión", func(t *testing.T) {
		status, _, _ := testsupport.NewClient(t, srv.URL).GetRaw("/api/v1/exports/patients")
		require.Equal(t, 401, status)
		_, err := as.CreateUser(ctx, "pac@demo.mx", "Pac", "patient", "demo1234")
		require.NoError(t, err)
		pc := testsupport.NewClient(t, srv.URL)
		pc.Login("pac@demo.mx", "demo1234")
		status, _, _ = pc.GetRaw("/api/v1/exports/patients")
		require.Equal(t, 403, status)
		status, _, _ = pc.GetRaw("/api/v1/reports/patients/" + pid + "/summary.pdf")
		require.Equal(t, 403, status)
	})
}
