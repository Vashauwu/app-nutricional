package payments_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/payments"
	"github.com/nutri/app-nutricional/backend/internal/plans"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type rig struct {
	pool *pgxpool.Pool
	ps   *plans.Service
	svc  *payments.Service
	sim  *payments.SimProvider
	now  time.Time
}

func newRig(t *testing.T) (*rig, context.Context) {
	t.Helper()
	pool := testsupport.NewPool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := &rig{now: time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)}
	now := func() time.Time { return r.now }
	r.ps = plans.NewService(pool)
	r.ps.SetClock(now)
	r.sim = payments.NewSimProvider("secreto-de-prueba")
	r.sim.SetClock(now)
	r.svc = payments.NewService(pool, r.ps, r.sim, log)
	r.svc.SetClock(now)
	r.pool = pool
	return r, testsupport.NewPractice(t, pool)
}

var who = payments.Actor{Email: "nutri@x.mx", Name: "Lic. Prueba"}

const (
	cardOK      = "sim:4242:12/2030"
	cardDecline = "sim:0002:12/2030"
	cardNoFunds = "sim:9995:12/2030"
)

func (r *rig) subID(t *testing.T, ctx context.Context) string {
	t.Helper()
	var id string
	require.NoError(t, r.pool.QueryRow(ctx, `SELECT provider_subscription_id FROM subscriptions`).Scan(&id))
	return id
}

func (r *rig) event(t *testing.T, ctx context.Context, e payments.Event) error {
	t.Helper()
	e.SubscriptionID = r.subID(t, ctx)
	return r.svc.HandleEvent(ctx, e)
}

func (r *rig) standing(t *testing.T, ctx context.Context) plans.Standing {
	t.Helper()
	st, _, err := r.ps.Standing(ctx)
	require.NoError(t, err)
	return st
}

func TestCheckoutStartsTrialOnce(t *testing.T) {
	r, ctx := newRig(t)

	// Una tarjeta rechazada no cambia nada.
	require.ErrorIs(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "pro", Period: "monthly", CardToken: cardDecline}), payments.ErrCardDeclined)
	require.Equal(t, "free", r.standing(t, ctx).Plan.Code)

	// Datos inválidos.
	for _, in := range []payments.CheckoutInput{{Plan: "free", Period: "monthly", CardToken: cardOK}, {Plan: "pro", Period: "semanal", CardToken: cardOK}, {Plan: "pro", Period: "monthly"}, {Plan: "nada", Period: "monthly", CardToken: cardOK}} {
		require.ErrorIs(t, r.svc.Checkout(ctx, who, in), payments.ErrInvalid, "%+v", in)
	}

	// Primera vez: prueba de 14 días, sin cobro.
	require.NoError(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "standard", Period: "monthly", CardToken: cardOK}))
	st := r.standing(t, ctx)
	require.Equal(t, "standard", st.Plan.Code)
	require.Equal(t, "trialing", st.State)
	require.WithinDuration(t, r.now.AddDate(0, 0, 14), *st.EndsAt, time.Second)
	info, err := r.svc.Info(ctx)
	require.NoError(t, err)
	require.False(t, info.TrialAvailable, "la prueba es una por consulta")
	require.Equal(t, "4242", info.Card.Last4)
	require.Empty(t, info.Payments, "durante la prueba no hay cobro")
	require.True(t, info.HasSubscription)

	require.ErrorIs(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "pro", Period: "monthly", CardToken: cardOK}), payments.ErrAlreadySubscribed)

	// Al terminar la prueba sin cobro, baja a Gratuito.
	r.now = r.now.AddDate(0, 0, 15)
	require.Equal(t, "free", r.standing(t, ctx).Plan.Code)
}

func TestCheckoutChargesWhenTrialAlreadyUsed(t *testing.T) {
	r, ctx := newRig(t)
	_, err := r.pool.Exec(ctx, `UPDATE subscriptions SET trial_used = true`)
	require.NoError(t, err)

	require.ErrorIs(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "pro", Period: "annual", CardToken: cardNoFunds}), payments.ErrCardDeclined, "el primer cobro falla")
	require.Equal(t, "free", r.standing(t, ctx).Plan.Code)

	require.NoError(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "pro", Period: "annual", CardToken: cardOK}))
	st := r.standing(t, ctx)
	require.Equal(t, "pro", st.Plan.Code)
	require.Equal(t, "active", st.State)
	require.WithinDuration(t, r.now.AddDate(1, 0, 0), *st.EndsAt, time.Second)
	info, _ := r.svc.Info(ctx)
	require.Len(t, info.Payments, 1)
	require.Equal(t, "paid", info.Payments[0].Status)
	require.Equal(t, 5270, info.Payments[0].AmountMXN)
}

func TestWebhookEventsDriveTheLifecycle(t *testing.T) {
	r, ctx := newRig(t)
	require.NoError(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "standard", Period: "monthly", CardToken: cardOK}))

	// Termina la prueba y se cobra: pasa a activa.
	r.now = r.now.AddDate(0, 0, 14)
	end := r.now.AddDate(0, 1, 0)
	require.NoError(t, r.event(t, ctx, payments.Event{ID: "evt_1", Type: payments.EventPaymentSucceeded, ChargeID: "ch_1", AmountMXN: 299, Period: "monthly", PeriodEnd: end}))
	st := r.standing(t, ctx)
	require.Equal(t, "active", st.State)
	require.Equal(t, "standard", st.Plan.Code)

	// Un evento repetido no duplica el cobro ni el efecto.
	require.NoError(t, r.event(t, ctx, payments.Event{ID: "evt_1", Type: payments.EventPaymentSucceeded, ChargeID: "ch_1", AmountMXN: 299, Period: "monthly", PeriodEnd: end.AddDate(1, 0, 0)}))
	info, _ := r.svc.Info(ctx)
	require.Len(t, info.Payments, 1)
	require.WithinDuration(t, end, *r.standing(t, ctx).EndsAt, time.Second, "el reintento no movió el periodo")

	// Cobro fallido: gracia de 7 días con el plan completo.
	r.now = end
	require.NoError(t, r.event(t, ctx, payments.Event{ID: "evt_2", Type: payments.EventPaymentFailed, ChargeID: "ch_2", AmountMXN: 299, Reason: "fondos insuficientes"}))
	st = r.standing(t, ctx)
	require.Equal(t, "past_due", st.State)
	require.Equal(t, "standard", st.Plan.Code)
	require.WithinDuration(t, end.AddDate(0, 0, 7), *st.EndsAt, time.Second)

	// Otro intento fallido no renueva la gracia.
	r.now = end.AddDate(0, 0, 3)
	require.NoError(t, r.event(t, ctx, payments.Event{ID: "evt_3", Type: payments.EventPaymentFailed, ChargeID: "ch_3", AmountMXN: 299}))
	require.WithinDuration(t, end.AddDate(0, 0, 7), *r.standing(t, ctx).EndsAt, time.Second)

	// Vencida la gracia: Gratuito, sin borrar nada.
	r.now = end.AddDate(0, 0, 8)
	st = r.standing(t, ctx)
	require.Equal(t, "free", st.Plan.Code)
	require.True(t, st.Downgraded)

	// Si luego se cobra (tarjeta actualizada), se restituye.
	require.NoError(t, r.event(t, ctx, payments.Event{ID: "evt_4", Type: payments.EventPaymentSucceeded, ChargeID: "ch_4", AmountMXN: 299, Period: "monthly", PeriodEnd: r.now.AddDate(0, 1, 0)}))
	require.Equal(t, "standard", r.standing(t, ctx).Plan.Code)

	// Cancelación del proveedor y contracargo.
	require.NoError(t, r.event(t, ctx, payments.Event{ID: "evt_5", Type: payments.EventSubscriptionCanceled}))
	require.Equal(t, "free", r.standing(t, ctx).Plan.Code)
	require.NoError(t, r.event(t, ctx, payments.Event{ID: "evt_6", Type: payments.EventChargeback, ChargeID: "ch_4", AmountMXN: 299}))
	info, _ = r.svc.Info(ctx)
	statuses := map[string]bool{}
	for _, p := range info.Payments {
		statuses[p.Status] = true
	}
	require.True(t, statuses["paid"] && statuses["failed"] && statuses["chargeback"], "el historial guarda cada cobro")
}

func TestCancelKeepsPlanUntilPeriodEnd(t *testing.T) {
	r, ctx := newRig(t)
	_, err := r.pool.Exec(ctx, `UPDATE subscriptions SET trial_used = true`)
	require.NoError(t, err)
	require.NoError(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "pro", Period: "monthly", CardToken: cardOK}))
	require.NoError(t, r.svc.Cancel(ctx, who))
	st := r.standing(t, ctx)
	require.Equal(t, "canceled", st.State)
	require.Equal(t, "pro", st.Plan.Code, "conserva el plan hasta el fin del periodo pagado")

	// Un cobro tardío no reactiva una cuenta cancelada.
	require.NoError(t, r.event(t, ctx, payments.Event{ID: "late", Type: payments.EventPaymentSucceeded, ChargeID: "ch_late", AmountMXN: 549, Period: "monthly"}))
	require.Equal(t, "canceled", r.standing(t, ctx).State)

	r.now = r.now.AddDate(0, 1, 1)
	require.Equal(t, "free", r.standing(t, ctx).Plan.Code)
}

func TestChangePlan(t *testing.T) {
	r, ctx := newRig(t)
	require.ErrorIs(t, r.svc.ChangePlan(ctx, who, "pro", "monthly"), payments.ErrNoSubscription)
	_, err := r.pool.Exec(ctx, `UPDATE subscriptions SET trial_used = true`)
	require.NoError(t, err)
	require.NoError(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "standard", Period: "monthly", CardToken: cardOK}))
	require.ErrorIs(t, r.svc.ChangePlan(ctx, who, "standard", "monthly"), payments.ErrAlreadySubscribed)

	// Subir: inmediato y con cobro.
	require.NoError(t, r.svc.ChangePlan(ctx, who, "pro", "monthly"))
	require.Equal(t, "pro", r.standing(t, ctx).Plan.Code)
	info, _ := r.svc.Info(ctx)
	require.Len(t, info.Payments, 2)

	// Bajar: se programa; hoy sigue siendo Pro.
	require.NoError(t, r.svc.ChangePlan(ctx, who, "standard", "monthly"))
	require.Equal(t, "pro", r.standing(t, ctx).Plan.Code)
	// Al renovar, surte efecto.
	require.NoError(t, r.event(t, ctx, payments.Event{ID: "ren", Type: payments.EventPaymentSucceeded, ChargeID: "ch_ren", AmountMXN: 299, Period: "monthly", PeriodEnd: r.now.AddDate(0, 2, 0)}))
	require.Equal(t, "standard", r.standing(t, ctx).Plan.Code)
}

func TestCompedAccountsCannotBeBilled(t *testing.T) {
	r, ctx := newRig(t)
	require.NoError(t, r.ps.Apply(ctx, plans.Change{Plan: "pro", Status: plans.StatusActive, CompReason: "cuenta fundadora"}))
	require.ErrorIs(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "pro", Period: "monthly", CardToken: cardOK}), payments.ErrComped)
	require.ErrorIs(t, r.svc.Cancel(ctx, who), payments.ErrComped)
}

func TestEventsOfOnePracticeDoNotTouchAnother(t *testing.T) {
	r, a := newRig(t)
	b := testsupport.NewPractice(t, r.pool)
	_, err := r.pool.Exec(tenant.Bypass(context.Background()), `UPDATE subscriptions SET trial_used = true`)
	require.NoError(t, err)
	require.NoError(t, r.svc.Checkout(a, who, payments.CheckoutInput{Plan: "pro", Period: "monthly", CardToken: cardOK}))
	require.NoError(t, r.svc.Checkout(b, who, payments.CheckoutInput{Plan: "standard", Period: "monthly", CardToken: cardOK}))
	require.NoError(t, r.event(t, a, payments.Event{ID: "x", Type: payments.EventSubscriptionCanceled}))
	require.Equal(t, "free", r.standing(t, a).Plan.Code)
	require.Equal(t, "standard", r.standing(t, b).Plan.Code, "el evento de A no toca a B")

	require.ErrorIs(t, r.svc.HandleEvent(a, payments.Event{ID: "y", Type: payments.EventPaymentFailed, SubscriptionID: "sub_que_no_existe"}), payments.ErrUnknownEvent)
}

type fakeNotifier struct{ sent []string }

func (f *fakeNotifier) SendTrialEnding(_ context.Context, to, plan string, _ time.Time) error {
	f.sent = append(f.sent, to+":"+plan)
	return nil
}

func TestTrialNoticeIsSentOnce(t *testing.T) {
	r, ctx := newRig(t)
	n := &fakeNotifier{}
	r.svc.SetNotifier(n)
	require.NoError(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "pro", Period: "monthly", CardToken: cardOK}))

	c, err := r.svc.NoticeDue(ctx)
	require.NoError(t, err)
	require.Zero(t, c, "a 14 días del cobro todavía no toca avisar")

	r.now = r.now.AddDate(0, 0, 12) // faltan 2 días
	// La consulta de prueba no tiene nutrióloga titular: sin correo no se puede avisar.
	_, err = r.pool.Exec(ctx, `INSERT INTO users (email, password_hash, display_name, practice_id) VALUES ('titular@x.mx','x','T',$1)`, tenant.From(ctx))
	require.NoError(t, err)
	_, err = r.pool.Exec(ctx, `INSERT INTO user_role_assignments (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = 'titular@x.mx' AND r.code = 'nutritionist'`)
	require.NoError(t, err)
	_, err = r.pool.Exec(ctx, `UPDATE users SET status = 'active' WHERE email = 'titular@x.mx'`)
	require.NoError(t, err)
	c, err = r.svc.NoticeDue(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, c)
	require.Equal(t, []string{"titular@x.mx:Pro"}, n.sent)
	c, _ = r.svc.NoticeDue(ctx)
	require.Zero(t, c, "el aviso sale una sola vez")
}

func TestWebhookEndpointVerifiesSignature(t *testing.T) {
	r, ctx := newRig(t)
	require.NoError(t, r.svc.Checkout(ctx, who, payments.CheckoutInput{Plan: "pro", Period: "monthly", CardToken: cardOK}))
	gin.SetMode(gin.TestMode)
	g := gin.New()
	payments.NewController(r.svc, nil, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(g.Group("/api/v1"))
	srv := httptest.NewServer(g)
	defer srv.Close()

	ev := payments.Event{ID: "wh_1", Type: payments.EventSubscriptionCanceled, SubscriptionID: r.subID(t, ctx), OccurredAt: r.now}
	body, sig := r.sim.Sign(ev)
	post := func(b []byte, s string) int {
		req, _ := http.NewRequest("POST", srv.URL+"/api/v1/webhooks/billing", bytes.NewReader(b))
		req.Header.Set(r.sim.SignatureHeader(), s)
		res, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		return res.StatusCode
	}
	require.Equal(t, 401, post(body, "00"+sig[2:]), "firma incorrecta")
	require.Equal(t, 401, post(body, ""), "sin firma")
	require.Equal(t, "pro", r.standing(t, ctx).Plan.Code, "un evento sin firma válida no cambia nada")
	require.Equal(t, 200, post(body, sig))
	require.Equal(t, "free", r.standing(t, ctx).Plan.Code)
	require.Equal(t, 200, post(body, sig), "reintento: se acepta sin repetir el efecto")

	unknown, usig := r.sim.Sign(payments.Event{ID: "wh_2", Type: payments.EventPaymentFailed, SubscriptionID: "sub_ajena"})
	require.Equal(t, 200, post(unknown, usig), "una suscripción desconocida se acusa de recibo para que no reintenten")
}
