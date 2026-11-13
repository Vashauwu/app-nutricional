package patients_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type mailer struct {
	mu          sync.Mutex
	invitations []string
	deliver     bool
}

func (m *mailer) Delivers() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.deliver
}

func (m *mailer) setDeliver(v bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deliver = v
}

func (m *mailer) SendPasswordReset(context.Context, string, string) error { return nil }
func (m *mailer) SendPasswordChanged(context.Context, string) error       { return nil }
func (m *mailer) SendInvitation(_ context.Context, _ string, link string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.invitations = append(m.invitations, link)
	return nil
}
func (m *mailer) lastInvitation() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.invitations) == 0 {
		return ""
	}
	return m.invitations[len(m.invitations)-1]
}

type env struct {
	pool *pgxpool.Pool
	auth *auth.Service
	srv  *httptest.Server
	mail *mailer
}

func start(t *testing.T) *env {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour,
		PasswordResetTTL: 30 * time.Minute, CookieSecure: false, AppBaseURL: "http://app.test"}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	m := &mailer{}
	as := auth.NewService(pool, cfg, m, log)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(patients.NewService(pool, as, log), as, log).Register(v1)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return &env{pool: pool, auth: as, srv: srv, mail: m}
}

type client struct {
	t  *testing.T
	e  *env
	hc *http.Client
	u  *url.URL
}

func (e *env) client(t *testing.T) *client {
	jar, _ := cookiejar.New(nil)
	u, _ := url.Parse(e.srv.URL)
	return &client{t: t, e: e, hc: &http.Client{Jar: jar}, u: u}
}

func (c *client) xsrf() string {
	for _, ck := range c.hc.Jar.Cookies(c.u) {
		if ck.Name == auth.XSRFCookie {
			return ck.Value
		}
	}
	return ""
}

func (c *client) do(method, path string, body any) (int, map[string]any) {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.e.srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(auth.XSRFHeader, c.xsrf())
	res, err := c.hc.Do(req)
	require.NoError(c.t, err)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

func (c *client) login(email, pw string) {
	c.t.Helper()
	code, body := c.do("POST", "/api/v1/auth/login", map[string]string{"email": email, "password": pw})
	require.Equal(c.t, 200, code, fmt.Sprint(body))
}

func (e *env) staff(t *testing.T, email string) *client {
	_, err := e.auth.CreateUser(context.Background(), email, "Lic. Prueba", "nutritionist", "demo1234")
	require.NoError(t, err)
	c := e.client(t)
	c.login(email, "demo1234")
	return c
}

func errCode(b map[string]any) string {
	m, _ := b["error"].(map[string]any)
	s, _ := m["code"].(string)
	return s
}
func fields(b map[string]any) map[string]any {
	m, _ := b["error"].(map[string]any)
	f, _ := m["fields"].(map[string]any)
	return f
}

func newPatient(email, first, last string) map[string]any {
	return map[string]any{"first_name": first, "last_name": last, "birth_date": "1990-04-12", "sex": "F", "email": email, "phone": "5512345678", "goal": "weight_loss"}
}

func (c *client) createPatient(email, first, last string) string {
	c.t.Helper()
	code, b := c.do("POST", "/api/v1/patients", newPatient(email, first, last))
	require.Equal(c.t, 201, code, fmt.Sprint(b))
	return b["id"].(string)
}

func (c *client) acceptAll(pid string) {
	c.t.Helper()
	code, b := c.do("GET", "/api/v1/patients/"+pid+"/consents", nil)
	require.Equal(c.t, 200, code)
	var ids []string
	for _, d := range b["pending"].([]any) {
		ids = append(ids, d.(map[string]any)["id"].(string))
	}
	code, _ = c.do("POST", "/api/v1/patients/"+pid+"/consents/record", map[string]any{"document_ids": ids})
	require.Equal(c.t, 204, code)
}

func TestPatientsIntegration(t *testing.T) {
	e := start(t)
	nutri := e.staff(t, "nutri@demo.mx")

	t.Run("alta: valida adultos, correo único y campos", func(t *testing.T) {
		id := nutri.createPatient("ana@demo.mx", "Ana", "Ramírez")
		require.NotEmpty(t, id)

		p := newPatient("menor@demo.mx", "Menor", "Edad")
		p["birth_date"] = time.Now().AddDate(-17, 0, 0).Format("2006-01-02")
		code, b := nutri.do("POST", "/api/v1/patients", p)
		require.Equal(t, 422, code)
		require.Equal(t, "not_adult", errCode(b))

		code, b = nutri.do("POST", "/api/v1/patients", newPatient("ANA@demo.mx", "Otra", "Ana"))
		require.Equal(t, 409, code, "el correo se compara sin importar mayúsculas")
		require.Equal(t, "email_taken", errCode(b))

		bad := newPatient("x", "A", "B")
		code, b = nutri.do("POST", "/api/v1/patients", bad)
		require.Equal(t, 422, code)
		require.Equal(t, "validation_failed", errCode(b))
		bad = newPatient("fecha@demo.mx", "A", "B")
		bad["birth_date"] = "12/04/1990"
		code, b = nutri.do("POST", "/api/v1/patients", bad)
		require.Equal(t, 422, code)
		require.Contains(t, fields(b), "birth_date")
	})

	t.Run("autorización: anónimo 401, paciente 403 y CSRF obligatorio", func(t *testing.T) {
		code, _ := e.client(t).do("GET", "/api/v1/patients", nil)
		require.Equal(t, 401, code)

		pid := nutri.createPatient("auth1@demo.mx", "Aut", "Uno")
		_, err := e.auth.CreateUser(context.Background(), "pacrol@demo.mx", "Pac", "patient", "demo1234")
		require.NoError(t, err)
		p := e.client(t)
		p.login("pacrol@demo.mx", "demo1234")
		for _, path := range []string{"/api/v1/patients", "/api/v1/patients/" + pid} {
			code, b := p.do("GET", path, nil)
			require.Equal(t, 403, code, path)
			require.Equal(t, "forbidden", errCode(b))
		}

		req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/patients", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		res, err := nutri.hc.Do(req) // sin X-XSRF-TOKEN
		require.NoError(t, err)
		res.Body.Close()
		require.Equal(t, 403, res.StatusCode)
	})

	t.Run("listado: búsqueda sin acentos, filtros y paginación en el servidor", func(t *testing.T) {
		for i, n := range []string{"Zoe", "Yara", "Xena"} {
			nutri.createPatient(fmt.Sprintf("lst%d@demo.mx", i), n, "Muñoz Lista")
		}
		_, b := nutri.do("GET", "/api/v1/patients?search=munoz%20lista&page_size=2", nil)
		require.EqualValues(t, 3, b["total"])
		require.Len(t, b["items"], 2)
		_, b = nutri.do("GET", "/api/v1/patients?search=munoz%20lista&page_size=2&page=2", nil)
		require.Len(t, b["items"], 1)
		_, b = nutri.do("GET", "/api/v1/patients?search=%25", nil)
		require.EqualValues(t, 0, b["total"], "el comodín % se trata como texto literal")
		_, b = nutri.do("GET", "/api/v1/patients?goal=muscle_gain&search=munoz%20lista", nil)
		require.EqualValues(t, 0, b["total"])
	})

	t.Run("expediente clínico bloqueado hasta aceptar los consentimientos", func(t *testing.T) {
		pid := nutri.createPatient("lock@demo.mx", "Lola", "Bloqueo")
		base := "/api/v1/patients/" + pid
		for _, path := range []string{"/measurements", "/clinical", "/notes"} {
			code, b := nutri.do("GET", base+path, nil)
			require.Equal(t, 423, code, path)
			require.Equal(t, "consent_pending", errCode(b))
		}
		code, _ := nutri.do("POST", base+"/notes", map[string]string{"body": "x"})
		require.Equal(t, 423, code)
		code, _ = nutri.do("PATCH", base, map[string]any{"clinical_indications": "x"})
		require.Equal(t, 423, code, "las indicaciones clínicas también están restringidas")
		code, _ = nutri.do("PATCH", base, map[string]any{"phone": "5599999999"})
		require.Equal(t, 200, code, "los datos administrativos sí se pueden editar")

		nutri.acceptAll(pid)
		code, _ = nutri.do("GET", base+"/clinical", nil)
		require.Equal(t, 200, code)

		_, b := nutri.do("GET", base+"/consents", nil)
		acc := b["acceptances"].([]any)[0].(map[string]any)
		require.Equal(t, "in_person", acc["method"])
		require.NotContains(t, acc, "evidence_metadata", "la evidencia no se expone al cliente")
		code, _ = nutri.do("POST", base+"/consents/"+acc["id"].(string)+"/revoke", nil)
		require.Equal(t, 204, code)
		code, _ = nutri.do("GET", base+"/clinical", nil)
		require.Equal(t, 423, code, "al revocar, el expediente vuelve a restringirse")

		code, _ = nutri.do("POST", base+"/consents/record", map[string]any{"document_ids": []string{"00000000-0000-0000-0000-000000000000"}})
		require.Equal(t, 422, code, "no se aceptan documentos inexistentes")
	})

	t.Run("las listas vacías son [] y nunca null", func(t *testing.T) {
		pid := nutri.createPatient("vacio@demo.mx", "Vera", "Vacía")
		nutri.acceptAll(pid)
		base := "/api/v1/patients/" + pid
		for _, path := range []string{"/measurements", "/notes"} {
			_, b := nutri.do("GET", base+path, nil)
			require.NotNil(t, b["items"], path)
			require.Empty(t, b["items"], path)
		}
		_, cl := nutri.do("GET", base+"/clinical", nil)
		for _, k := range []string{"conditions", "allergies", "medications", "preferences"} {
			require.NotNil(t, cl[k], k)
		}
		_, cs := nutri.do("GET", base+"/consents", nil)
		require.NotNil(t, cs["pending"])
	})

	t.Run("mediciones: IMC con política decimal, rangos y solo inserción", func(t *testing.T) {
		pid := nutri.createPatient("med@demo.mx", "Mia", "Medidas")
		nutri.acceptAll(pid)
		base := "/api/v1/patients/" + pid + "/measurements"
		code, b := nutri.do("POST", base, map[string]any{"measured_at": "2026-01-10", "weight_kg": "70", "height_cm": "170", "waist_cm": "80.5", "body_fat_pct": "25.5"})
		require.Equal(t, 201, code, fmt.Sprint(b))
		require.Equal(t, "24.22", b["bmi"], "70 / 1.70² = 24.2214… → 24.22")
		require.Equal(t, "70", b["weight_kg"], "los decimales viajan como string")

		code, b = nutri.do("POST", base, map[string]any{"measured_at": "2026-02-10", "weight_kg": "5", "height_cm": "900"})
		require.Equal(t, 422, code)
		require.Contains(t, fields(b), "weight_kg")
		require.Contains(t, fields(b), "height_cm")
		code, b = nutri.do("POST", base, map[string]any{"measured_at": "2026-02-10", "weight_kg": "abc", "height_cm": "170"})
		require.Equal(t, 422, code)
		require.Contains(t, fields(b), "weight_kg")
		code, _ = nutri.do("POST", base, map[string]any{"measured_at": "2999-01-01", "weight_kg": "70", "height_cm": "170"})
		require.Equal(t, 422, code, "no se admiten fechas futuras")

		nutri.do("POST", base, map[string]any{"measured_at": "2026-03-10", "weight_kg": "68.4", "height_cm": "170"})
		_, b = nutri.do("GET", base, nil)
		items := b["items"].([]any)
		require.Len(t, items, 2, "las mediciones se acumulan, no se sobrescriben")
		require.Equal(t, "2026-03-10", items[0].(map[string]any)["measured_at"], "más reciente primero")

		_, err := e.pool.Exec(context.Background(), `UPDATE patient_measurements SET weight_kg = 1`)
		require.ErrorContains(t, err, "solo insercion")
		_, err = e.pool.Exec(context.Background(), `DELETE FROM patient_measurements`)
		require.ErrorContains(t, err, "solo insercion")
	})

	t.Run("condiciones, alergias, medicamentos y preferencias: CRUD con aislamiento entre pacientes", func(t *testing.T) {
		a := nutri.createPatient("cl_a@demo.mx", "Clara", "A")
		b := nutri.createPatient("cl_b@demo.mx", "Beto", "B")
		nutri.acceptAll(a)
		nutri.acceptAll(b)

		code, al := nutri.do("POST", "/api/v1/patients/"+a+"/allergies", map[string]any{"allergen": "Mariscos", "aliases": []string{"camarón", " ", "langosta"}, "severity": "severe"})
		require.Equal(t, 201, code, fmt.Sprint(al))
		require.Equal(t, []any{"camarón", "langosta"}, al["aliases"])
		aid := al["id"].(string)

		code, _ = nutri.do("PUT", "/api/v1/patients/"+b+"/allergies/"+aid, map[string]any{"allergen": "Hackeado", "severity": "mild", "status": "active"})
		require.Equal(t, 404, code, "no se puede editar un registro de otro paciente")
		code, _ = nutri.do("DELETE", "/api/v1/patients/"+b+"/allergies/"+aid, nil)
		require.Equal(t, 404, code)

		code, out := nutri.do("PUT", "/api/v1/patients/"+a+"/allergies/"+aid, map[string]any{"allergen": "Mariscos", "severity": "moderate", "status": "resolved"})
		require.Equal(t, 200, code, fmt.Sprint(out))
		require.Equal(t, "resolved", out["status"])
		code, bad := nutri.do("POST", "/api/v1/patients/"+a+"/allergies", map[string]any{"allergen": "", "severity": "gigante"})
		require.Equal(t, 422, code)
		require.Contains(t, fields(bad), "allergen")
		require.Contains(t, fields(bad), "severity")

		code, _ = nutri.do("POST", "/api/v1/patients/"+a+"/conditions", map[string]any{"name": "Hipertensión", "details": "controlada"})
		require.Equal(t, 201, code)
		code, med := nutri.do("POST", "/api/v1/patients/"+a+"/medications", map[string]any{"name": "Losartán", "dose": "50 mg", "start_date": "2024-01-01", "end_date": "2023-01-01"})
		require.Equal(t, 422, code, fmt.Sprint(med))
		code, _ = nutri.do("POST", "/api/v1/patients/"+a+"/medications", map[string]any{"name": "Losartán", "dose": "50 mg", "start_date": "2023-01-01"})
		require.Equal(t, 201, code)
		code, _ = nutri.do("POST", "/api/v1/patients/"+a+"/preferences", map[string]any{"food_name": "Hígado", "preference_type": "avoid"})
		require.Equal(t, 201, code)

		_, cl := nutri.do("GET", "/api/v1/patients/"+a+"/clinical", nil)
		require.Len(t, cl["conditions"], 1)
		require.Len(t, cl["allergies"], 1)
		require.Len(t, cl["medications"], 1)
		require.Len(t, cl["preferences"], 1)
		_, clb := nutri.do("GET", "/api/v1/patients/"+b+"/clinical", nil)
		require.Empty(t, clb["allergies"], "el otro paciente no hereda registros")

		code, _ = nutri.do("DELETE", "/api/v1/patients/"+a+"/allergies/"+aid, nil)
		require.Equal(t, 204, code)
	})

	t.Run("notas privadas: eliminación lógica y nunca visibles para el paciente", func(t *testing.T) {
		pid := nutri.createPatient("nota@demo.mx", "Nora", "Notas")
		nutri.acceptAll(pid)
		base := "/api/v1/patients/" + pid + "/notes"
		code, n := nutri.do("POST", base, map[string]string{"body": "Observación privada"})
		require.Equal(t, 201, code)
		_, list := nutri.do("GET", base, nil)
		require.Len(t, list["items"], 1)
		code, _ = nutri.do("DELETE", base+"/"+n["id"].(string), nil)
		require.Equal(t, 204, code)
		_, list = nutri.do("GET", base, nil)
		require.Empty(t, list["items"])
		var kept int
		require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM patient_notes WHERE id = $1 AND deleted_at IS NOT NULL`, n["id"]).Scan(&kept))
		require.Equal(t, 1, kept, "la nota se conserva con deleted_at")
	})

	t.Run("invitación: la paciente crea su contraseña, acepta consentimientos y solo ve lo suyo", func(t *testing.T) {
		inv := newPatient("invitada@demo.mx", "Ines", "Invitada")
		inv["invite"] = true
		code, b := nutri.do("POST", "/api/v1/patients", inv)
		require.Equal(t, 201, code, fmt.Sprint(b))
		require.Equal(t, "invited", b["status"])
		other := nutri.createPatient("otra@demo.mx", "Otra", "Paciente")
		nutri.do("PATCH", "/api/v1/patients/"+other, map[string]any{"phone": "1"})

		pc := e.client(t)
		code, _ = pc.do("POST", "/api/v1/auth/login", map[string]string{"email": "invitada@demo.mx", "password": "cualquiera1"})
		require.Equal(t, 401, code, "no se puede entrar hasta crear la contraseña")

		link := e.mail.lastInvitation()
		require.True(t, strings.HasPrefix(link, "http://app.test/restablecer/"))
		token := strings.TrimPrefix(link, "http://app.test/restablecer/")
		code, _ = pc.do("POST", "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "MiClave2026"})
		require.Equal(t, 204, code)
		pc.login("invitada@demo.mx", "MiClave2026")

		// Al crear su contraseña con la invitación, el paciente deja de estar «invitado».
		_, seen := nutri.do("GET", "/api/v1/patients/"+b["id"].(string), nil)
		require.Equal(t, "active", seen["status"], "aceptar la invitación activa al paciente")

		code, me := pc.do("GET", "/api/v1/me/patient", nil)
		require.Equal(t, 200, code)
		require.Equal(t, "Ines", me["first_name"])
		require.NotEmpty(t, me["birth_date"], "el perfil de la paciente incluye su fecha de nacimiento (para calcular la edad)")
		require.NotEmpty(t, me["sex"])
		require.Contains(t, me, "phone")
		require.Equal(t, false, me["consent_complete"])
		require.NotContains(t, me, "clinical_indications")
		require.NotContains(t, me, "quota_override_bytes")
		require.NotContains(t, me, "notes")

		code, mm := pc.do("GET", "/api/v1/me/measurements", nil)
		require.Equal(t, 423, code, fmt.Sprint(mm))

		_, pend := pc.do("GET", "/api/v1/me/consents/pending", nil)
		items := pend["items"].([]any)
		require.Len(t, items, 2)
		var ids []string
		for _, it := range items {
			ids = append(ids, it.(map[string]any)["id"].(string))
		}
		code, _ = pc.do("POST", "/api/v1/me/consents/accept", map[string]any{"document_ids": ids})
		require.Equal(t, 204, code)
		code, _ = pc.do("POST", "/api/v1/me/consents/accept", map[string]any{"document_ids": ids})
		require.Equal(t, 422, code, "no se puede aceptar dos veces el mismo documento")
		_, me = pc.do("GET", "/api/v1/me/patient", nil)
		require.Equal(t, true, me["consent_complete"])

		code, mine := pc.do("GET", "/api/v1/me/consents", nil)
		require.Equal(t, 200, code, fmt.Sprint(mine))
		acc := mine["acceptances"].([]any)
		require.Len(t, acc, 2, "la paciente ve sus propias aceptaciones")
		first := acc[0].(map[string]any)
		require.NotEmpty(t, first["title"])
		require.NotEmpty(t, first["accepted_at"])
		require.NotContains(t, first, "evidence_metadata", "la evidencia técnica (IP, navegador) no se expone")

		// Aislamiento: un paciente no puede tocar rutas de la nutrióloga ni ver a otro por URL.
		code, _ = pc.do("GET", "/api/v1/patients/"+other, nil)
		require.Equal(t, 403, code)
		code, _ = pc.do("GET", "/api/v1/patients/"+other+"/clinical", nil)
		require.Equal(t, 403, code)
		code, _ = pc.do("GET", "/api/v1/patients/"+b["id"].(string)+"/notes", nil)
		require.Equal(t, 403, code)

		// La evidencia de aceptación queda registrada.
		var evidence string
		require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT evidence_metadata::text FROM consent_acceptances WHERE patient_id = $1 LIMIT 1`, b["id"]).Scan(&evidence))
		require.Contains(t, evidence, "user_agent")

		// La nutrióloga controla la visibilidad de las mediciones.
		nutri.do("POST", "/api/v1/patients/"+b["id"].(string)+"/measurements", map[string]any{"measured_at": "2026-01-10", "weight_kg": "70", "height_cm": "170"})
		code, _ = pc.do("GET", "/api/v1/me/measurements", nil)
		require.Equal(t, 200, code)
		nutri.do("PATCH", "/api/v1/patients/"+b["id"].(string), map[string]any{"measurements_visible": false})
		code, mv := pc.do("GET", "/api/v1/me/measurements", nil)
		require.Equal(t, 403, code)
		require.Equal(t, "not_available", errCode(mv))
	})

	t.Run("desactivar y restaurar conserva el historial y evita choques de correo", func(t *testing.T) {
		a := nutri.createPatient("soft@demo.mx", "Sara", "Soft")
		nutri.acceptAll(a)
		nutri.do("POST", "/api/v1/patients/"+a+"/notes", map[string]string{"body": "historia"})

		code, p := nutri.do("POST", "/api/v1/patients/"+a+"/deactivate", nil)
		require.Equal(t, 200, code)
		require.Equal(t, "inactive", p["status"])
		_, list := nutri.do("GET", "/api/v1/patients?search=soft%40demo", nil)
		require.EqualValues(t, 0, list["total"], "no aparece en las consultas habituales")
		_, list = nutri.do("GET", "/api/v1/patients?status=deleted&search=soft%40demo", nil)
		require.EqualValues(t, 1, list["total"], "la nutrióloga puede consultarlo")

		// Mientras está desactivado, otro paciente puede usar el correo…
		nutri.createPatient("soft@demo.mx", "Sofía", "Segunda")
		// …y entonces restaurar al primero genera un conflicto claro.
		code, b := nutri.do("POST", "/api/v1/patients/"+a+"/restore", nil)
		require.Equal(t, 409, code)
		require.Equal(t, "email_taken", errCode(b))
	})

	t.Run("cuota individual: 0 la elimina", func(t *testing.T) {
		pid := nutri.createPatient("cuota@demo.mx", "Cuco", "Cuota")
		code, p := nutri.do("PATCH", "/api/v1/patients/"+pid, map[string]any{"quota_override_bytes": 104857600})
		require.Equal(t, 200, code)
		require.EqualValues(t, 104857600, p["quota_override_bytes"])
		_, p = nutri.do("PATCH", "/api/v1/patients/"+pid, map[string]any{"quota_override_bytes": 0})
		require.Nil(t, p["quota_override_bytes"])
	})

	t.Run("documentos vigentes y exportaciones sensibles auditadas", func(t *testing.T) {
		code, docs := nutri.do("GET", "/api/v1/consent-documents", nil)
		require.Equal(t, 200, code)
		require.Len(t, docs["items"], 2)
		code, _ = e.client(t).do("GET", "/api/v1/consent-documents", nil)
		require.Equal(t, 401, code)

		pid := nutri.createPatient("export@demo.mx", "Eva", "Exporta")
		code, _ = nutri.do("POST", "/api/v1/patients/"+pid+"/exports", map[string]string{"kind": "measurements"})
		require.Equal(t, 204, code)
		code, _ = nutri.do("POST", "/api/v1/patients/"+pid+"/exports", map[string]string{"kind": "todo"})
		require.Equal(t, 422, code)
	})

	t.Run("auditoría: registra cambios sin datos personales ni clínicos", func(t *testing.T) {
		rows, err := e.pool.Query(context.Background(), `SELECT action, metadata::text FROM audit_logs WHERE resource_type = 'patient'`)
		require.NoError(t, err)
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			var a, m string
			require.NoError(t, rows.Scan(&a, &m))
			seen[a] = true
			for _, secret := range []string{"@demo.mx", "Hipertensión", "Mariscos", "Observación", "Losartán", "Hígado"} {
				require.NotContains(t, m, secret, a)
			}
		}
		for _, want := range []string{"patient.create", "patient.update", "patient.deactivate", "consent.accepted", "consent.revoked", "measurement.create", "note.create", "note.delete", "patient.allergy"} {
			require.True(t, seen[want], want)
		}
	})
}

func TestBMIUsesDecimalPolicy(t *testing.T) {
	// Verificación pura (sin base de datos) de la fórmula y el redondeo bancario.
	for _, c := range []struct{ w, h, want string }{
		{"70", "170", "24.22"}, {"60", "160", "23.44"}, {"100", "200", "25"}, {"54.5", "150", "24.22"},
	} {
		w, _ := decimalFrom(c.w)
		h, _ := decimalFrom(c.h)
		got, err := patients.BMI(w, h)
		require.NoError(t, err)
		require.Equal(t, c.want, got.String(), c.w+"/"+c.h)
	}
}

// Sin correo configurado la nutrióloga recibe el enlace (y queda en auditoría); con correo real, nunca se expone.
func TestInviteLinkExposure(t *testing.T) {
	e := start(t)
	nutri := e.staff(t, "nutri@demo.mx")

	e.mail.setDeliver(false)
	body := newPatient("sin.correo@demo.mx", "Sin", "Correo")
	body["invite"] = true
	code, b := nutri.do("POST", "/api/v1/patients", body)
	require.Equal(t, 201, code, fmt.Sprint(b))
	require.NotEmpty(t, b["invite_link"], "sin correo configurado se muestra el enlace")
	require.Equal(t, e.mail.lastInvitation(), b["invite_link"])
	id := b["id"].(string)

	var shown int
	require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action='patient.invitation_link_shown' AND resource_id=$1`, id).Scan(&shown))
	require.Equal(t, 1, shown, "mostrar el enlace queda registrado")

	code, r := nutri.do("POST", "/api/v1/patients/"+id+"/invite", nil)
	require.Equal(t, 202, code, fmt.Sprint(r))
	require.Equal(t, false, r["emailed"])
	require.NotEmpty(t, r["invite_link"])
	_, again := nutri.do("GET", "/api/v1/patients/"+id, nil)
	require.NotContains(t, again, "invite_link", "el enlace no se guarda ni reaparece al consultar al paciente")

	e.mail.setDeliver(true)
	body2 := newPatient("con.correo@demo.mx", "Con", "Correo")
	body2["invite"] = true
	code, b2 := nutri.do("POST", "/api/v1/patients", body2)
	require.Equal(t, 201, code)
	require.NotContains(t, b2, "invite_link", "con correo real el enlace solo llega a la paciente")
	code, r2 := nutri.do("POST", "/api/v1/patients/"+b2["id"].(string)+"/invite", nil)
	require.Equal(t, 202, code)
	require.Equal(t, true, r2["emailed"])
	require.NotContains(t, r2, "invite_link")
}

// Un paciente registrado a mano puede recibir acceso después: se crea su cuenta y se envía la invitación.
func TestInviteManualPatient(t *testing.T) {
	e := start(t)
	nutri := e.staff(t, "nutri@demo.mx")

	t.Run("con consentimientos ya registrados en persona, entra directo a la app", func(t *testing.T) {
		pid := nutri.createPatient("manual@demo.mx", "Mario", "Manual")
		_, before := nutri.do("GET", "/api/v1/patients/"+pid, nil)
		require.Equal(t, "active", before["status"])
		require.Nil(t, before["user_id"], "registrado a mano: sin cuenta")
		nutri.acceptAll(pid)

		code, r := nutri.do("POST", "/api/v1/patients/"+pid+"/invite", nil)
		require.Equal(t, 202, code, fmt.Sprint(r))
		require.NotEmpty(t, r["invite_link"], "sin correo real configurado se entrega el enlace")
		_, after := nutri.do("GET", "/api/v1/patients/"+pid, nil)
		require.Equal(t, "invited", after["status"])
		require.NotNil(t, after["user_id"], "ahora tiene cuenta")

		token := strings.TrimPrefix(e.mail.lastInvitation(), "http://app.test/restablecer/")
		pc := e.client(t)
		code, _ = pc.do("POST", "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "MiClave2026"})
		require.Equal(t, 204, code)
		pc.login("manual@demo.mx", "MiClave2026")

		_, seen := nutri.do("GET", "/api/v1/patients/"+pid, nil)
		require.Equal(t, "active", seen["status"], "al crear su contraseña pasa a activo")
		_, me := pc.do("GET", "/api/v1/me/patient", nil)
		require.Equal(t, true, me["consent_complete"], "los consentimientos presenciales siguen vigentes")
		_, pend := pc.do("GET", "/api/v1/me/consents/pending", nil)
		require.Empty(t, pend["items"], "no se le piden de nuevo")
		code, _ = pc.do("GET", "/api/v1/me/measurements", nil)
		require.NotEqual(t, 423, code, "el expediente no está bloqueado")
	})

	t.Run("sin consentimientos, la app se los pide al ingresar", func(t *testing.T) {
		pid := nutri.createPatient("pendiente@demo.mx", "Paola", "Pendiente")
		code, _ := nutri.do("POST", "/api/v1/patients/"+pid+"/invite", nil)
		require.Equal(t, 202, code)
		token := strings.TrimPrefix(e.mail.lastInvitation(), "http://app.test/restablecer/")
		pc := e.client(t)
		code, _ = pc.do("POST", "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "MiClave2026"})
		require.Equal(t, 204, code)
		pc.login("pendiente@demo.mx", "MiClave2026")
		_, pend := pc.do("GET", "/api/v1/me/consents/pending", nil)
		require.Len(t, pend["items"], 2)
	})

	t.Run("reinvitar mientras está pendiente reenvía; con cuenta activa se rechaza", func(t *testing.T) {
		pid := nutri.createPatient("repite@demo.mx", "Rita", "Repite")
		code, _ := nutri.do("POST", "/api/v1/patients/"+pid+"/invite", nil)
		require.Equal(t, 202, code)
		first := e.mail.lastInvitation()
		code, _ = nutri.do("POST", "/api/v1/patients/"+pid+"/invite", nil)
		require.Equal(t, 202, code, "reenvío")
		require.NotEqual(t, first, e.mail.lastInvitation(), "el enlace anterior queda invalidado por uno nuevo")

		token := strings.TrimPrefix(e.mail.lastInvitation(), "http://app.test/restablecer/")
		pc := e.client(t)
		code, _ = pc.do("POST", "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "MiClave2026"})
		require.Equal(t, 204, code)
		code, b := nutri.do("POST", "/api/v1/patients/"+pid+"/invite", nil)
		require.Equal(t, 422, code, fmt.Sprint(b))
	})

	t.Run("un correo que ya es una cuenta del sistema no se puede reutilizar", func(t *testing.T) {
		_, err := e.auth.CreateUser(context.Background(), "equipo@demo.mx", "Equipo", "nutritionist", "Clave12345")
		require.NoError(t, err)
		pid := nutri.createPatient("equipo@demo.mx", "Eva", "Equipo")
		code, b := nutri.do("POST", "/api/v1/patients/"+pid+"/invite", nil)
		require.Equal(t, 409, code, fmt.Sprint(b))
		require.Equal(t, "account_exists", errCode(b))
		_, after := nutri.do("GET", "/api/v1/patients/"+pid, nil)
		require.Equal(t, "active", after["status"], "no se cambió nada")
		require.Nil(t, after["user_id"])
	})

	t.Run("un paciente desactivado no se invita, y restaurar a uno manual lo deja activo", func(t *testing.T) {
		pid := nutri.createPatient("baja@demo.mx", "Beto", "Baja")
		code, _ := nutri.do("POST", "/api/v1/patients/"+pid+"/deactivate", nil)
		require.Equal(t, 200, code)
		code, _ = nutri.do("POST", "/api/v1/patients/"+pid+"/invite", nil)
		require.Equal(t, 422, code)
		code, _ = nutri.do("POST", "/api/v1/patients/"+pid+"/restore", nil)
		require.Equal(t, 200, code)
		_, back := nutri.do("GET", "/api/v1/patients/"+pid, nil)
		require.Equal(t, "active", back["status"], "un paciente registrado a mano no queda como «invitado» al restaurarlo")
	})

	t.Run("la invitación queda en la auditoría", func(t *testing.T) {
		var n int
		require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action = 'patient.invited'`).Scan(&n))
		require.GreaterOrEqual(t, n, 3)
	})
}

func TestBodyCompositionAndMedicationKind(t *testing.T) {
	e := start(t)
	nutri := e.staff(t, "nutri@demo.mx")
	pid := nutri.createPatient("comp@demo.mx", "Carla", "Composición")
	nutri.acceptAll(pid)
	base := "/api/v1/patients/" + pid + "/measurements"

	code, b := nutri.do("POST", base, map[string]any{
		"measured_at": "2026-01-10", "weight_kg": "96.05", "height_cm": "177",
		"body_fat_pct": "29.5", "fat_mass_kg": "28.3", "muscle_pct": "67.9", "muscle_mass_kg": "65.2",
		"visceral_fat": "16.5", "bone_kg": "2.57", "obesity_pct": "41.5",
		"girths": map[string]string{"shoulders": "120", "bicep_relaxed_l": "35.5", "bicep_relaxed_r": "36", "calf_flexed_r": "41", "wrist_l": ""},
	})
	require.Equal(t, 201, code, fmt.Sprint(b))
	require.Equal(t, "28.3", b["fat_mass_kg"])
	require.Equal(t, "2.57", b["bone_kg"])
	g := b["girths"].(map[string]any)
	require.Equal(t, "35.5", g["bicep_relaxed_l"])
	require.NotContains(t, g, "wrist_l", "un campo vacío no se guarda")

	_, list := nutri.do("GET", base, nil)
	first := list["items"].([]any)[0].(map[string]any)
	require.Equal(t, "120", first["girths"].(map[string]any)["shoulders"])

	code, b = nutri.do("POST", base, map[string]any{"measured_at": "2026-02-10", "weight_kg": "70", "height_cm": "170", "girths": map[string]string{"cuello": "40"}})
	require.Equal(t, 422, code)
	require.Contains(t, fields(b), "girths")
	code, b = nutri.do("POST", base, map[string]any{"measured_at": "2026-02-10", "weight_kg": "70", "height_cm": "170", "muscle_pct": "140"})
	require.Equal(t, 422, code)
	require.Contains(t, fields(b), "muscle_pct")
	code, b = nutri.do("POST", base, map[string]any{"measured_at": "2026-02-10", "weight_kg": "70", "height_cm": "170", "girths": map[string]string{"chest": "abc"}})
	require.Equal(t, 422, code)
	require.Contains(t, fields(b), "girths.chest")

	code, b = nutri.do("POST", base, map[string]any{"measured_at": "2026-02-10", "weight_kg": "70", "height_cm": "170"})
	require.Equal(t, 201, code, "una medición solo con peso y talla sigue siendo válida")
	require.Empty(t, b["girths"].(map[string]any))

	code, med := nutri.do("POST", "/api/v1/patients/"+pid+"/medications", map[string]any{"name": "Metformina", "dose": "850 mg", "kind": "Antidiabético"})
	require.Equal(t, 201, code, fmt.Sprint(med))
	require.Equal(t, "Antidiabético", med["kind"])
	_, clin := nutri.do("GET", "/api/v1/patients/"+pid+"/clinical", nil)
	require.Equal(t, "Antidiabético", clin["medications"].([]any)[0].(map[string]any)["kind"])
}

func TestLabs(t *testing.T) {
	e := start(t)
	nutri := e.staff(t, "nutri@demo.mx")
	pid := nutri.createPatient("lab@demo.mx", "Lola", "Laboratorio")
	base := "/api/v1/patients/" + pid + "/labs"

	code, _ := nutri.do("GET", base, nil)
	require.Equal(t, 423, code, "sin consentimientos el expediente está bloqueado")
	nutri.acceptAll(pid)

	_, none := nutri.do("GET", base, nil)
	require.Empty(t, none["items"])

	code, b := nutri.do("POST", base, map[string]any{
		"taken_at": "2026-05-02", "lab_name": "Laboratorio Azteca", "notes": "En ayuno de 12 h",
		"results": []map[string]any{
			{"name": "Glucosa", "value": "112.5", "unit": "mg/dL", "ref_min": "70", "ref_max": "99"},
			{"name": "Colesterol total", "value": "185", "unit": "mg/dL", "ref_max": "200"},
			{"name": "Hemoglobina glucosilada", "value": "5.4", "unit": "%"},
		}})
	require.Equal(t, 201, code, fmt.Sprint(b))
	res := b["results"].([]any)
	require.Len(t, res, 3)
	require.Equal(t, "112.5", res[0].(map[string]any)["value"], "los decimales viajan como texto")
	require.Nil(t, res[1].(map[string]any)["ref_min"], "el rango es opcional")

	code, _ = nutri.do("POST", base, map[string]any{"taken_at": "2026-03-01", "results": []map[string]any{{"name": "Glucosa", "value": "90", "unit": "mg/dL"}}})
	require.Equal(t, 201, code)
	_, list := nutri.do("GET", base, nil)
	items := list["items"].([]any)
	require.Len(t, items, 2)
	require.Equal(t, "2026-05-02", items[0].(map[string]any)["taken_at"], "más reciente primero")
	require.Len(t, items[0].(map[string]any)["results"], 3)
	require.Len(t, items[1].(map[string]any)["results"], 1)

	one := func(name, value string) map[string]any { return map[string]any{"name": name, "value": value} }
	for name, body := range map[string]map[string]any{
		"vacío":             {"taken_at": "2026-05-02", "results": []map[string]any{}},
		"valor inválido":    {"taken_at": "2026-05-02", "results": []map[string]any{one("Glucosa", "abc")}},
		"sin nombre":        {"taken_at": "2026-05-02", "results": []map[string]any{one(" ", "1")}},
		"repetido":          {"taken_at": "2026-05-02", "results": []map[string]any{one("Glucosa", "1"), one("Glucosa", "2")}},
		"rango invertido":   {"taken_at": "2026-05-02", "results": []map[string]any{{"name": "Glucosa", "value": "1", "ref_min": "100", "ref_max": "70"}}},
		"fecha futura":      {"taken_at": "2999-01-01", "results": []map[string]any{one("Glucosa", "1")}},
		"valor negativo":    {"taken_at": "2026-05-02", "results": []map[string]any{one("Glucosa", "-1")}},
		"fecha mal escrita": {"taken_at": "02/05/2026", "results": []map[string]any{one("Glucosa", "1")}},
	} {
		code, _ := nutri.do("POST", base, body)
		require.Equal(t, 422, code, name)
	}

	code, _ = nutri.do("DELETE", base+"/"+items[1].(map[string]any)["id"].(string), nil)
	require.Equal(t, 204, code)
	_, list = nutri.do("GET", base, nil)
	require.Len(t, list["items"], 1)
	var left int
	require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM patient_lab_results`).Scan(&left))
	require.Equal(t, 3, left, "al borrar un estudio se borran sus resultados")
	code, _ = nutri.do("DELETE", base+"/"+items[1].(map[string]any)["id"].(string), nil)
	require.Equal(t, 404, code)
}

func TestPatientDeletesOwnAccount(t *testing.T) {
	e := start(t)
	nutri := e.staff(t, "nutri.baja@demo.mx")
	pid := nutri.createPatient("baja@demo.mx", "Bea", "Baja")
	nutri.acceptAll(pid)
	code, _ := nutri.do("POST", "/api/v1/patients/"+pid+"/measurements", map[string]any{"measured_at": "2026-05-01", "weight_kg": "70", "height_cm": "165"})
	require.Equal(t, 201, code)

	// La paciente crea su contraseña con la invitación y entra.
	code, _ = nutri.do("POST", "/api/v1/patients/"+pid+"/invite", nil)
	require.Equal(t, 202, code)
	token := strings.TrimPrefix(e.mail.lastInvitation(), "http://app.test/restablecer/")
	pc := e.client(t)
	code, _ = pc.do("POST", "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "MiClave2026"})
	require.Equal(t, 204, code)
	pc.login("baja@demo.mx", "MiClave2026")

	code, b := pc.do("POST", "/api/v1/me/account/delete", map[string]string{})
	require.Equal(t, 422, code, "sin contraseña no procede")
	code, b = pc.do("POST", "/api/v1/me/account/delete", map[string]string{"password": "incorrecta1"})
	require.Equal(t, 403, code, fmt.Sprint(b))
	require.Equal(t, "invalid_password", errCode(b))
	code, _ = pc.do("GET", "/api/v1/me/patient", nil)
	require.Equal(t, 200, code, "una contraseña errónea no cierra nada")

	code, b = pc.do("POST", "/api/v1/me/account/delete", map[string]string{"password": "MiClave2026"})
	require.Equal(t, 204, code, fmt.Sprint(b))
	code, _ = pc.do("GET", "/api/v1/me/patient", nil)
	require.Equal(t, 401, code, "sus sesiones se cierran al instante")
	other := e.client(t)
	code, _ = other.do("POST", "/api/v1/auth/login", map[string]string{"email": "baja@demo.mx", "password": "MiClave2026"})
	require.Equal(t, 401, code, "ya no puede iniciar sesión")

	_, seen := nutri.do("GET", "/api/v1/patients/"+pid, nil)
	require.Equal(t, "inactive", seen["status"], "la nutrióloga lo ve desactivado")
	var n int
	require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM patient_measurements WHERE patient_id = $1`, pid).Scan(&n))
	require.Equal(t, 1, n, "el expediente clínico se conserva (NOM-004)")
	require.NoError(t, e.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action = 'patient.self_delete' AND resource_id = $1`, pid).Scan(&n))
	require.Equal(t, 1, n, "queda constancia en la auditoría")
}
