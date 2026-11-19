package platform_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/payments"
	"github.com/nutri/app-nutricional/backend/internal/plans"
	"github.com/nutri/app-nutricional/backend/internal/platform"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type env struct {
	pool *pgxpool.Pool
	ps   *plans.Service
	pay  *payments.Service
	svc  *platform.Service
	auth *auth.Service
	srv  *httptest.Server
	now  time.Time
}

func start(t *testing.T, withPayments bool) *env {
	t.Helper()
	pool := testsupport.NewPool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute, AppBaseURL: "http://app.test"}
	e := &env{pool: pool, now: time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)}
	now := func() time.Time { return e.now }
	e.auth = auth.NewService(pool, cfg, auth.LogMailer{Log: log}, log)
	e.ps = plans.NewService(pool)
	e.ps.SetClock(now)
	var pay *payments.Service
	if withPayments {
		sim := payments.NewSimProvider("s")
		sim.SetClock(now)
		pay = payments.NewService(pool, e.ps, sim, log)
		pay.SetClock(now)
		e.pay = pay
	}
	e.svc = platform.NewService(pool, e.ps, pay, log)
	e.svc.SetClock(now)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(e.auth, cfg).Register(v1)
	platform.NewController(e.svc, e.auth, log).Register(v1)
	e.srv = httptest.NewServer(r)
	t.Cleanup(e.srv.Close)
	return e
}

// staff crea una persona del equipo de plataforma (en su propia consulta) y devuelve su actor.
func (e *env) staff(t *testing.T, email string) platform.Actor {
	t.Helper()
	ctx := testsupport.NewPractice(t, e.pool)
	id, err := e.auth.CreateUser(ctx, email, "Equipo", "nutritionist", "demo1234")
	require.NoError(t, err)
	testsupport.GrantPlatformAdmin(t, e.pool, email)
	return platform.Actor{ID: id, Email: email}
}

// account crea una consulta cliente con una nutrióloga titular.
func (e *env) account(t *testing.T, name, email string) (context.Context, uuid.UUID) {
	t.Helper()
	ctx := testsupport.NewPractice(t, e.pool)
	_, err := e.pool.Exec(tenant.Bypass(ctx), `UPDATE practices SET name = $1 WHERE id = $2`, name, tenant.From(ctx))
	require.NoError(t, err)
	_, err = e.auth.CreateUser(ctx, email, "Titular", "nutritionist", "demo1234")
	require.NoError(t, err)
	return ctx, tenant.From(ctx)
}

func (e *env) standing(t *testing.T, ctx context.Context) plans.Standing {
	t.Helper()
	st, _, err := e.ps.Standing(ctx)
	require.NoError(t, err)
	return st
}

const why = "Cliente fundador de la prueba piloto"

func TestFourEyesOnMoneyActions(t *testing.T) {
	e := start(t, false)
	ana, beto := e.staff(t, "ana@plataforma.mx"), e.staff(t, "beto@plataforma.mx")
	ctx, pid := e.account(t, "Consulta Luna", "luna@clinica.mx")
	bg := context.Background()

	// Validaciones al pedir.
	_, err := e.svc.Request(bg, ana, pid, platform.KindCompPlan, platform.Params{Plan: "pro", Days: 30}, "corto")
	require.ErrorIs(t, err, platform.ErrInvalid, "el motivo es obligatorio")
	for _, p := range []platform.Params{{Plan: "free", Days: 30}, {Plan: "pro", Days: 0}, {Plan: "pro", Days: 400}, {Plan: "nada", Days: 5}} {
		_, err = e.svc.Request(bg, ana, pid, platform.KindCompPlan, p, why)
		require.ErrorIs(t, err, platform.ErrInvalid, "%+v", p)
	}
	_, err = e.svc.Request(bg, ana, uuid.New(), platform.KindCompPlan, platform.Params{Plan: "pro", Days: 30}, why)
	require.ErrorIs(t, err, platform.ErrNotFound)

	req, err := e.svc.Request(bg, ana, pid, platform.KindCompPlan, platform.Params{Plan: "pro", Days: 30}, why)
	require.NoError(t, err)
	require.Equal(t, "pending", req.Status)
	require.Equal(t, "free", e.standing(t, ctx).Plan.Code, "pedir no cambia nada")

	// Quien la pidió no la aprueba.
	_, err = e.svc.Decide(bg, ana, req.ID, true, "")
	require.ErrorIs(t, err, platform.ErrSelfApproval)
	require.Equal(t, "free", e.standing(t, ctx).Plan.Code)

	// Otra persona sí; se ejecuta y la cuenta queda con el plan de cortesía hasta la fecha.
	done, err := e.svc.Decide(bg, beto, req.ID, true, "ok")
	require.NoError(t, err)
	require.Equal(t, "executed", done.Status)
	st := e.standing(t, ctx)
	require.Equal(t, "pro", st.Plan.Code)
	require.True(t, st.Comped)
	require.WithinDuration(t, e.now.AddDate(0, 0, 30), *st.EndsAt, time.Second)
	// Pasada la cortesía, baja sola al Gratuito.
	e.now = e.now.AddDate(0, 0, 33)
	require.Equal(t, "free", e.standing(t, ctx).Plan.Code)

	// Una solicitud ya resuelta no se resuelve dos veces.
	_, err = e.svc.Decide(bg, beto, req.ID, true, "")
	require.ErrorIs(t, err, platform.ErrAlreadyDecided)

	// Rechazar no cambia nada.
	r2, _ := e.svc.Request(bg, ana, pid, platform.KindCompPlan, platform.Params{Plan: "standard", Days: 10}, why)
	rej, err := e.svc.Decide(bg, beto, r2.ID, false, "no corresponde")
	require.NoError(t, err)
	require.Equal(t, "rejected", rej.Status)
	require.Equal(t, "free", e.standing(t, ctx).Plan.Code)

	// Equipo de una persona: con la excepción activada puede aprobar lo suyo, y queda marcado.
	e.svc.AllowSelfApproval(true)
	r3, _ := e.svc.Request(bg, ana, pid, platform.KindCompPlan, platform.Params{Plan: "standard", Days: 10}, why)
	_, err = e.svc.Decide(bg, ana, r3.ID, true, "")
	require.NoError(t, err)
	var flagged int
	require.NoError(t, e.pool.QueryRow(tenant.Bypass(bg), `SELECT count(*) FROM audit_logs WHERE action = 'platform.action_approved' AND metadata->>'self_approval' = 'true'`).Scan(&flagged))
	require.Equal(t, 1, flagged, "la autoaprobación queda registrada")

	// La bitácora de la consulta conserva cada paso, con quién lo hizo.
	d, err := e.svc.Account(bg, pid)
	require.NoError(t, err)
	actions := map[string]bool{}
	for _, a := range d.Audit {
		actions[a.Action] = true
		require.Contains(t, a.Meta, "by")
	}
	for _, want := range []string{"platform.action_requested", "platform.action_approved", "platform.action_executed", "platform.action_rejected"} {
		require.True(t, actions[want], want)
	}
}

func TestExtendTrial(t *testing.T) {
	e := start(t, true)
	ana, beto := e.staff(t, "ana@plataforma.mx"), e.staff(t, "beto@plataforma.mx")
	ctx, pid := e.account(t, "Consulta Sol", "sol@clinica.mx")
	bg := context.Background()

	// Sin prueba en curso, la ejecución falla de forma visible (no se pierde en silencio).
	r, _ := e.svc.Request(bg, ana, pid, platform.KindExtendTrial, platform.Params{Days: 7}, why)
	res, err := e.svc.Decide(bg, beto, r.ID, true, "")
	require.NoError(t, err)
	require.Equal(t, "failed", res.Status)
	require.Contains(t, res.Error, "prueba")

	require.NoError(t, e.pay.Checkout(ctx, payments.Actor{Email: "sol@clinica.mx"}, payments.CheckoutInput{Plan: "pro", Period: "monthly", CardToken: "sim:4242:12/2030"}))
	before := *e.standing(t, ctx).EndsAt
	r, _ = e.svc.Request(bg, ana, pid, platform.KindExtendTrial, platform.Params{Days: 7}, why)
	res, err = e.svc.Decide(bg, beto, r.ID, true, "")
	require.NoError(t, err)
	require.Equal(t, "executed", res.Status)
	st := e.standing(t, ctx)
	require.Equal(t, "trialing", st.State)
	require.WithinDuration(t, before.AddDate(0, 0, 7), *st.EndsAt, time.Second)

	_, err = e.svc.Request(bg, ana, pid, platform.KindExtendTrial, platform.Params{Days: 31}, why)
	require.ErrorIs(t, err, platform.ErrInvalid)
}

func TestRefund(t *testing.T) {
	e := start(t, true)
	ana, beto := e.staff(t, "ana@plataforma.mx"), e.staff(t, "beto@plataforma.mx")
	ctx, pid := e.account(t, "Consulta Mar", "mar@clinica.mx")
	bg := context.Background()
	_, err := e.pool.Exec(ctx, `UPDATE subscriptions SET trial_used = true WHERE practice_id = $1`, pid)
	require.NoError(t, err)
	require.NoError(t, e.pay.Checkout(ctx, payments.Actor{Email: "mar@clinica.mx"}, payments.CheckoutInput{Plan: "standard", Period: "monthly", CardToken: "sim:4242:12/2030"}))
	var payID uuid.UUID
	require.NoError(t, e.pool.QueryRow(ctx, `SELECT id FROM payments WHERE practice_id = $1`, pid).Scan(&payID))

	r, _ := e.svc.Request(bg, ana, pid, platform.KindRefund, platform.Params{PaymentID: payID}, why)
	res, err := e.svc.Decide(bg, beto, r.ID, true, "")
	require.NoError(t, err)
	require.Equal(t, "executed", res.Status)
	var st string
	require.NoError(t, e.pool.QueryRow(ctx, `SELECT status FROM payments WHERE id = $1`, payID).Scan(&st))
	require.Equal(t, "refunded", st)

	// Reembolsar dos veces el mismo cobro no se puede.
	r, _ = e.svc.Request(bg, ana, pid, platform.KindRefund, platform.Params{PaymentID: payID}, why)
	res, _ = e.svc.Decide(bg, beto, r.ID, true, "")
	require.Equal(t, "failed", res.Status)

	// Sin cobro en línea en el ambiente, tampoco.
	e2 := start(t, false)
	a2, b2 := e2.staff(t, "ana@plataforma.mx"), e2.staff(t, "beto@plataforma.mx")
	_, pid2 := e2.account(t, "Otra", "otra@clinica.mx")
	r, _ = e2.svc.Request(bg, a2, pid2, platform.KindRefund, platform.Params{PaymentID: uuid.New()}, why)
	res, _ = e2.svc.Decide(bg, b2, r.ID, true, "")
	require.Equal(t, "failed", res.Status)
}

func TestSuspendBlocksAccessAndKeepsData(t *testing.T) {
	e := start(t, false)
	ana := e.staff(t, "ana@plataforma.mx")
	_, pid := e.account(t, "Consulta Rio", "rio@clinica.mx")
	bg := context.Background()

	c := testsupport.NewClient(t, e.srv.URL)
	c.Login("rio@clinica.mx", "demo1234")
	code, _ := c.Do("GET", "/api/v1/auth/me", nil)
	require.Equal(t, 200, code)

	require.ErrorIs(t, e.svc.Suspend(bg, ana, pid, "corto"), platform.ErrInvalid)
	require.NoError(t, e.svc.Suspend(bg, ana, pid, "Subida masiva de archivos ajenos a la nutrición"))
	code, _ = c.Do("GET", "/api/v1/auth/me", nil)
	require.Equal(t, 401, code, "la sesión abierta deja de servir (se revocaron las sesiones)")
	c2 := testsupport.NewClient(t, e.srv.URL)
	code, b := c2.Do("POST", "/api/v1/auth/login", map[string]string{"email": "rio@clinica.mx", "password": "demo1234"})
	require.Equal(t, 403, code, "tampoco se puede abrir otra")
	require.Equal(t, "account_suspended", testsupport.ErrCode(b))

	d, err := e.svc.Account(bg, pid)
	require.NoError(t, err)
	require.Equal(t, "suspended", d.Status)
	require.Contains(t, d.SuspendedReason, "archivos ajenos")

	require.NoError(t, e.svc.Reactivate(bg, ana, pid))
	c3 := testsupport.NewClient(t, e.srv.URL)
	c3.Login("rio@clinica.mx", "demo1234")

	// Si la consulta se suspende por otra vía sin cerrar sesiones, el acceso también se corta, con explicación.
	_, err = e.pool.Exec(tenant.Bypass(bg), `UPDATE practices SET status = 'suspended' WHERE id = $1`, pid)
	require.NoError(t, err)
	code, b = c3.Do("GET", "/api/v1/auth/me", nil)
	require.Equal(t, 403, code)
	require.Equal(t, "account_suspended", testsupport.ErrCode(b))
	_, err = e.pool.Exec(tenant.Bypass(bg), `UPDATE practices SET status = 'active' WHERE id = $1`, pid)
	require.NoError(t, err)
	require.ErrorIs(t, e.svc.Suspend(bg, ana, uuid.New(), "motivo suficientemente largo"), platform.ErrNotFound)
}

func TestListAccounts(t *testing.T) {
	e := start(t, false)
	e.staff(t, "ana@plataforma.mx")
	_, pid := e.account(t, "Nutrición Aurora", "aurora@clinica.mx")
	e.account(t, "Clínica 100% Vida", "vida@correo.mx")
	_, err := e.pool.Exec(tenant.Bypass(context.Background()), `UPDATE subscriptions SET plan = 'pro', status = 'active', comp_reason = 'fundadora' WHERE practice_id = $1`, pid)
	require.NoError(t, err)
	bg := context.Background()

	all, err := e.svc.ListAccounts(bg, platform.ListQuery{})
	require.NoError(t, err)
	require.GreaterOrEqual(t, all.Total, int64(3))

	r, err := e.svc.ListAccounts(bg, platform.ListQuery{Search: "aurora"})
	require.NoError(t, err)
	require.Len(t, r.Items, 1)
	require.Equal(t, "aurora@clinica.mx", r.Items[0].OwnerEmail)
	require.Equal(t, "pro", r.Items[0].EffectivePlan)
	require.True(t, r.Items[0].Comped)

	r, _ = e.svc.ListAccounts(bg, platform.ListQuery{Search: "vida@correo"})
	require.Len(t, r.Items, 1, "se busca también por correo")
	r, _ = e.svc.ListAccounts(bg, platform.ListQuery{Search: "100%"})
	require.Len(t, r.Items, 1, "el % se busca literal, no como comodín")
	r, _ = e.svc.ListAccounts(bg, platform.ListQuery{Search: "%"})
	require.Len(t, r.Items, 1, "un % suelto no trae todas las cuentas")
	r, _ = e.svc.ListAccounts(bg, platform.ListQuery{Plan: "pro", Search: "aurora"})
	require.Len(t, r.Items, 1)
	r, _ = e.svc.ListAccounts(bg, platform.ListQuery{Plan: "standard", Search: "aurora"})
	require.Empty(t, r.Items)
}

func TestConsoleAndPermissions(t *testing.T) {
	e := start(t, false)
	e.staff(t, "ana@plataforma.mx")
	e.account(t, "Consulta Bosque", "bosque@clinica.mx")

	// Una nutrióloga cualquiera no entra ni a la consola ni a la API de plataforma.
	nutri := testsupport.NewClient(t, e.srv.URL)
	nutri.Login("bosque@clinica.mx", "demo1234")
	for _, p := range []string{"/api/v1/platform/accounts", "/api/v1/platform/actions", "/api/v1/platform/console", "/api/v1/platform/console.js"} {
		code, _ := nutri.Do("GET", p, nil)
		require.Equal(t, 403, code, p)
	}
	code, _ := nutri.Do("POST", "/api/v1/platform/accounts/"+uuid.NewString()+"/suspend", map[string]string{"reason": "intento no autorizado de suspensión"})
	require.Equal(t, 403, code)
	anon := testsupport.NewClient(t, e.srv.URL)
	code, _ = anon.Do("GET", "/api/v1/platform/console", nil)
	require.Equal(t, 401, code, "sin sesión no se entrega ni el HTML")

	// La plataforma sí, y la consola lleva una política de contenido estricta.
	ana := testsupport.NewClient(t, e.srv.URL)
	ana.Login("ana@plataforma.mx", "demo1234")
	code, b := ana.Do("GET", "/api/v1/platform/accounts", nil)
	require.Equal(t, 200, code, fmt.Sprint(b))
	code, ctype, body := ana.GetRaw("/api/v1/platform/console")
	require.Equal(t, 200, code)
	require.Contains(t, ctype, "text/html")
	require.Contains(t, string(body), "console.js")
	code, _, js := ana.GetRaw("/api/v1/platform/console.js")
	require.Equal(t, 200, code)
	require.NotContains(t, string(js), "innerHTML", "los datos de las cuentas nunca se insertan como HTML")
}

func TestPlatformActionsAreInvisibleToTenants(t *testing.T) {
	e := start(t, false)
	ana := e.staff(t, "ana@plataforma.mx")
	ctx, pid := e.account(t, "Consulta Valle", "valle@clinica.mx")
	_, err := e.svc.Request(context.Background(), ana, pid, platform.KindCompPlan, platform.Params{Plan: "pro", Days: 5}, why)
	require.NoError(t, err)
	var n int
	require.NoError(t, e.pool.QueryRow(ctx, `SELECT count(*) FROM platform_actions`).Scan(&n))
	require.Zero(t, n, "la consulta afectada no ve las solicitudes sobre ella")
}

func TestOverviewCountsWhatIsThere(t *testing.T) {
	e := start(t, false)
	e.now = time.Now() // las altas se fechan con el reloj de la base: la ventana del resumen debe usar el mismo
	ana, beto := e.staff(t, "ana@plataforma.mx"), e.staff(t, "beto@plataforma.mx")
	bg := context.Background()
	before, err := e.svc.Overview(bg)
	require.NoError(t, err)

	_, pagaID := e.account(t, "Consulta Paga", "paga@clinica.mx")
	_, cortesiaID := e.account(t, "Consulta Cortesía", "cortesia@clinica.mx")
	_, bloqueadaID := e.account(t, "Consulta Bloqueada", "bloqueada@clinica.mx")

	// Una cuenta que paga el Estándar mensual.
	_, err = e.pool.Exec(tenant.Bypass(bg), `UPDATE subscriptions SET plan = 'standard', status = 'active', billing_period = 'monthly', current_period_end = $2 WHERE practice_id = $1`, pagaID, e.now.AddDate(0, 0, 20))
	require.NoError(t, err)
	// Una con cortesía Pro (no cuenta como ingreso).
	req, err := e.svc.Request(bg, ana, cortesiaID, platform.KindCompPlan, platform.Params{Plan: "pro", Days: 30}, why)
	require.NoError(t, err)
	_, err = e.svc.Decide(bg, beto, req.ID, true, "ok")
	require.NoError(t, err)
	// Una suspendida.
	require.NoError(t, e.svc.Suspend(bg, ana, bloqueadaID, "Uso indebido de la cuenta"))

	after, err := e.svc.Overview(bg)
	require.NoError(t, err)
	require.Equal(t, before.Accounts+3, after.Accounts)
	require.Equal(t, before.Suspended+1, after.Suspended)
	require.Equal(t, before.Comped+1, after.Comped)
	require.Equal(t, before.ByPlan["standard"]+1, after.ByPlan["standard"])
	require.Equal(t, before.ByPlan["pro"]+1, after.ByPlan["pro"])
	require.Equal(t, before.PayingAccounts+1, after.PayingAccounts)
	require.Equal(t, before.MRRMXN+299, after.MRRMXN, "la cortesía no suma ingreso")
	require.Equal(t, before.MRRByPlan["standard"]+299, after.MRRByPlan["standard"])
	require.Equal(t, before.MRRByPlan["pro"], after.MRRByPlan["pro"])
	require.Equal(t, before.Signups30+3, after.Signups30)
	require.Len(t, after.SignupsDaily, 30)
	require.Equal(t, before.Usage.Users+3, after.Usage.Users)
	require.Equal(t, before.PendingActions, after.PendingActions, "la solicitud ya se resolvió")
	acts, err := e.svc.Actions(bg, "executed", uuid.Nil)
	require.NoError(t, err)
	require.NotEmpty(t, acts)
	require.Equal(t, "beto@plataforma.mx", acts[0].DeciderMail, "el historial dice quién decidió")
}

func TestListAccountsSorting(t *testing.T) {
	e := start(t, false)
	e.staff(t, "ana@plataforma.mx")
	_, p1 := e.account(t, "Zeta Nutrición", "zeta@clinica.mx")
	e.account(t, "Alfa Nutrición", "alfa@clinica.mx")
	_, err := e.pool.Exec(tenant.Bypass(context.Background()), `UPDATE subscriptions SET plan = 'pro', status = 'active' WHERE practice_id = $1`, p1)
	require.NoError(t, err)
	bg := context.Background()

	names := func(q platform.ListQuery) []string {
		q.Search = "Nutrición"
		r, err := e.svc.ListAccounts(bg, q)
		require.NoError(t, err)
		var out []string
		for _, it := range r.Items {
			out = append(out, it.Name)
		}
		return out
	}
	require.Equal(t, []string{"Alfa Nutrición", "Zeta Nutrición"}, names(platform.ListQuery{Sort: "name"}))
	require.Equal(t, []string{"Zeta Nutrición", "Alfa Nutrición"}, names(platform.ListQuery{Sort: "name", Desc: true}))
	require.Equal(t, []string{"Zeta Nutrición", "Alfa Nutrición"}, names(platform.ListQuery{Sort: "plan", Desc: true}), "pro antes que gratuito")
	require.Len(t, names(platform.ListQuery{Sort: "'; DROP TABLE practices;--"}), 2, "una columna desconocida cae al orden por omisión")
}

func TestActivityIsGlobalFilterableAndOperationalOnly(t *testing.T) {
	e := start(t, false)
	ana, beto := e.staff(t, "ana@plataforma.mx"), e.staff(t, "beto@plataforma.mx")
	_, p1 := e.account(t, "Consulta Luna", "luna@clinica.mx")
	_, p2 := e.account(t, "Consulta Sol", "sol@clinica.mx")
	bg := context.Background()
	require.NoError(t, e.svc.Suspend(bg, ana, p1, "Subida masiva de archivos ajenos"))
	require.NoError(t, e.svc.Reactivate(bg, beto, p1))
	require.NoError(t, e.svc.Suspend(bg, beto, p2, "Uso de la cuenta para spam"))
	// Un evento clínico de la misma consulta no debe aparecer jamás.
	_, err := e.pool.Exec(tenant.Bypass(bg), `INSERT INTO audit_logs (action, resource_type, practice_id) VALUES ('patient.create', 'patient', $1)`, p1)
	require.NoError(t, err)

	all, err := e.svc.Activity(bg, platform.ActivityQuery{Until: time.Now().Add(time.Hour), Category: "platform"})
	require.NoError(t, err)
	require.GreaterOrEqual(t, all.Total, int64(3))
	for _, it := range all.Items {
		require.Equal(t, "platform", it.Action[:8], it.Action)
	}

	every, err := e.svc.Activity(bg, platform.ActivityQuery{Until: time.Now().Add(time.Hour), Limit: 100})
	require.NoError(t, err)
	for _, it := range every.Items {
		require.NotEqual(t, "patient.create", it.Action, "los eventos clínicos no se listan")
	}

	one, err := e.svc.Activity(bg, platform.ActivityQuery{Until: time.Now().Add(time.Hour), Practice: p2})
	require.NoError(t, err)
	require.Len(t, one.Items, 1)
	require.Equal(t, "platform.suspend", one.Items[0].Action)
	require.Equal(t, "Consulta Sol", one.Items[0].PracticeName)

	byText, err := e.svc.Activity(bg, platform.ActivityQuery{Until: time.Now().Add(time.Hour), Search: "reactivate"})
	require.NoError(t, err)
	require.Len(t, byText.Items, 1)

	future, err := e.svc.Activity(bg, platform.ActivityQuery{Since: time.Now().AddDate(0, 0, 3), Until: time.Now().AddDate(0, 0, 4)})
	require.NoError(t, err)
	require.Empty(t, future.Items)

	_, err = e.svc.Activity(bg, platform.ActivityQuery{Until: time.Now().Add(time.Hour), Category: "patient"})
	require.ErrorIs(t, err, platform.ErrInvalid, "no se puede pedir una categoría clínica")
}

func TestCompOverPayingAccountCancelsProviderFirst(t *testing.T) {
	e := start(t, true)
	ana, beto := e.staff(t, "ana@plataforma.mx"), e.staff(t, "beto@plataforma.mx")
	ctx, pid := e.account(t, "Consulta Mar", "mar@clinica.mx")
	bg := context.Background()
	_, err := e.pool.Exec(ctx, `UPDATE subscriptions SET trial_used = true WHERE practice_id = $1`, pid)
	require.NoError(t, err)
	require.NoError(t, e.pay.Checkout(ctx, payments.Actor{Email: "mar@clinica.mx"}, payments.CheckoutInput{Plan: "standard", Period: "monthly", CardToken: "sim:4242:12/2030"}))
	_, sub, err := e.ps.Standing(ctx)
	require.NoError(t, err)
	require.True(t, sub.ProviderSubscriptionID.Valid, "la cuenta paga con suscripción en la pasarela")

	r, err := e.svc.Request(bg, ana, pid, platform.KindCompPlan, platform.Params{Plan: "pro", Days: 30}, why)
	require.NoError(t, err)
	res, err := e.svc.Decide(bg, beto, r.ID, true, "")
	require.NoError(t, err)
	require.Equal(t, "executed", res.Status, res.Error)
	require.Equal(t, "pro", e.standing(t, ctx).Plan.Code)

	act, err := e.svc.Activity(bg, platform.ActivityQuery{Until: time.Now().Add(time.Hour), Practice: pid, Search: "provider_subscription_canceled"})
	require.NoError(t, err)
	require.Len(t, act.Items, 1, "queda en la bitácora que se canceló el cobro automático")
}
