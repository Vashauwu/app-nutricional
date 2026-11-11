package agenda_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/agenda"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }

func iso(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func TestAgenda(t *testing.T) {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute, Timezone: "America/Mexico_City"}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	svc := agenda.NewService(pool, log)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	agenda.NewController(svc, as, func(c *gin.Context, uid uuid.UUID) (uuid.UUID, error) {
		p, err := ps.ForUser(c.Request.Context(), uid)
		return p.ID, err
	}, log).Register(v1)
	srv := httptest.NewServer(r)
	defer srv.Close()
	ctx := context.Background()

	_, err := as.CreateUser(ctx, "nutri@demo.mx", "Lic.", "nutritionist", "demo1234")
	require.NoError(t, err)
	nutri := testsupport.NewClient(t, srv.URL)
	nutri.Login("nutri@demo.mx", "demo1234")
	mk := func(email, first string) string {
		_, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": first, "last_name": "Prueba", "birth_date": "1990-01-01", "sex": "F", "email": email, "goal": "maintenance"})
		return p["id"].(string)
	}
	ana, beto := mk("ana@demo.mx", "Ana"), mk("beto@demo.mx", "Beto")
	uid, err := as.CreateUser(ctx, "ana.login@demo.mx", "Ana", "patient", "demo1234")
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE patients SET user_id=$1 WHERE id=$2`, uid, ana)
	require.NoError(t, err)

	start := time.Now().Add(48 * time.Hour).Truncate(time.Hour)
	body := func(pid string, from time.Time, mins int, extra map[string]any) map[string]any {
		m := map[string]any{"patient_id": pid, "starts_at": iso(from), "ends_at": iso(from.Add(time.Duration(mins) * time.Minute)), "place": "Consultorio 2", "notes": "Llevar estudios"}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}

	var firstID string
	t.Run("crear y listar por rango", func(t *testing.T) {
		code, b := nutri.Do("POST", "/api/v1/appointments", body(ana, start, 45, map[string]any{"kind": "first"}))
		require.Equal(t, 201, code, fmt.Sprint(b))
		firstID = b["id"].(string)
		require.Equal(t, "Ana Prueba", b["patient_name"])
		require.Equal(t, "scheduled", b["status"])
		code, b = nutri.Do("GET", "/api/v1/appointments?from="+iso(start.Add(-time.Hour))+"&to="+iso(start.Add(24*time.Hour)), nil)
		require.Equal(t, 200, code, fmt.Sprint(b))
		require.Len(t, b["items"], 1)
		_, b = nutri.Do("GET", "/api/v1/appointments?from="+iso(start.Add(72*time.Hour))+"&to="+iso(start.Add(96*time.Hour)), nil)
		require.Empty(t, b["items"])
	})

	t.Run("validaciones", func(t *testing.T) {
		for name, m := range map[string]map[string]any{
			"termina antes":     body(beto, start.Add(5*time.Hour), -30, nil),
			"muy corta":         body(beto, start.Add(5*time.Hour), 2, nil),
			"muy larga":         body(beto, start.Add(5*time.Hour), 600, nil),
			"tipo inválido":     body(beto, start.Add(5*time.Hour), 30, map[string]any{"kind": "x"}),
			"paciente inválido": body(uuid.NewString(), start.Add(5*time.Hour), 30, nil),
			"fecha mal escrita": {"patient_id": beto, "starts_at": "mañana", "ends_at": "pasado"},
		} {
			code, _ := nutri.Do("POST", "/api/v1/appointments", m)
			require.Equal(t, 422, code, name)
		}
	})

	t.Run("no se empalman dos consultas programadas", func(t *testing.T) {
		code, b := nutri.Do("POST", "/api/v1/appointments", body(beto, start.Add(30*time.Minute), 45, nil))
		require.Equal(t, 409, code, fmt.Sprint(b))
		code, _ = nutri.Do("POST", "/api/v1/appointments", body(beto, start.Add(45*time.Minute), 30, nil))
		require.Equal(t, 201, code, "pegada al final de la anterior sí cabe")
	})

	t.Run("reprogramar, cancelar y liberar el horario", func(t *testing.T) {
		code, b := nutri.Do("PUT", "/api/v1/appointments/"+firstID, body(ana, start.Add(3*time.Hour), 45, nil))
		require.Equal(t, 200, code, fmt.Sprint(b))
		code, _ = nutri.Do("POST", "/api/v1/appointments", body(beto, start.Add(3*time.Hour), 30, nil))
		require.Equal(t, 409, code)
		code, _ = nutri.Do("PUT", "/api/v1/appointments/"+firstID, body(ana, start.Add(3*time.Hour), 45, map[string]any{"status": "cancelled"}))
		require.Equal(t, 200, code)
		code, _ = nutri.Do("POST", "/api/v1/appointments", body(beto, start.Add(3*time.Hour), 30, nil))
		require.Equal(t, 201, code, "una consulta cancelada libera el horario")
		code, _ = nutri.Do("PUT", "/api/v1/appointments/"+uuid.NewString(), body(ana, start, 30, nil))
		require.Equal(t, 404, code)
	})

	t.Run("el paciente ve sus consultas, sin notas ni canceladas", func(t *testing.T) {
		code, _ := nutri.Do("POST", "/api/v1/appointments", body(ana, start.Add(24*time.Hour), 30, nil))
		require.Equal(t, 201, code)
		pc := testsupport.NewClient(t, srv.URL)
		pc.Login("ana.login@demo.mx", "demo1234")
		code, b := pc.Do("GET", "/api/v1/me/appointments", nil)
		require.Equal(t, 200, code, fmt.Sprint(b))
		items := b["items"].([]any)
		require.Len(t, items, 1, "la cancelada y las de otros pacientes no aparecen")
		require.NotContains(t, items[0], "notes")
		require.NotContains(t, items[0], "patient_name")
		code, _ = pc.Do("GET", "/api/v1/appointments?from="+iso(start)+"&to="+iso(start.Add(time.Hour)), nil)
		require.Equal(t, 403, code, "el paciente no puede usar la agenda de la nutrióloga")
		code, _ = pc.Do("POST", "/api/v1/appointments", body(ana, start.Add(72*time.Hour), 30, nil))
		require.Equal(t, 403, code)
	})

	t.Run("enlace .ics: secreto, estable y regenerable", func(t *testing.T) {
		code, b := nutri.Do("GET", "/api/v1/calendar-feed", nil)
		require.Equal(t, 200, code, fmt.Sprint(b))
		path := b["path"].(string)
		_, b2 := nutri.Do("GET", "/api/v1/calendar-feed", nil)
		require.Equal(t, path, b2["path"], "el enlace no cambia solo")

		resp, err := http.Get(srv.URL + path)
		require.NoError(t, err)
		raw, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		require.Equal(t, 200, resp.StatusCode)
		require.Contains(t, resp.Header.Get("Content-Type"), "text/calendar")
		require.Equal(t, "no-store", resp.Header.Get("Cache-Control"))
		ics := string(raw)
		require.True(t, strings.HasPrefix(ics, "BEGIN:VCALENDAR\r\n"))
		require.Contains(t, ics, "SUMMARY:Consulta de seguimiento · Ana Prueba")
		require.Contains(t, ics, "STATUS:CANCELLED", "las canceladas se publican como canceladas")
		require.Contains(t, ics, "LOCATION:Consultorio 2")
		require.NotContains(t, ics, "Llevar estudios", "las notas internas no salen en el calendario")
		require.True(t, strings.HasSuffix(ics, "END:VCALENDAR\r\n"))

		bad, err := http.Get(srv.URL + "/api/v1/calendar/" + strings.Repeat("a", 64) + "/consultas.ics")
		require.NoError(t, err)
		_ = bad.Body.Close()
		require.Equal(t, 404, bad.StatusCode)

		code, b3 := nutri.Do("POST", "/api/v1/calendar-feed/rotate", nil)
		require.Equal(t, 200, code)
		require.NotEqual(t, path, b3["path"])
		old, err := http.Get(srv.URL + path)
		require.NoError(t, err)
		_ = old.Body.Close()
		require.Equal(t, 404, old.StatusCode, "el enlace anterior deja de funcionar")
		nw, err := http.Get(srv.URL + b3["path"].(string))
		require.NoError(t, err)
		_ = nw.Body.Close()
		require.Equal(t, 200, nw.StatusCode)
	})
}
