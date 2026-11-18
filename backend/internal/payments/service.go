package payments

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
	"github.com/nutri/app-nutricional/backend/internal/plans"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

// TrialDays: prueba gratuita con tarjeta, una por consulta. Sin cobro hasta que termina.
const TrialDays = 14

// TrialNoticeDays: aviso por correo antes del primer cobro.
const TrialNoticeDays = 3

var (
	ErrInvalid           = errors.New("solicitud de cobro inválida")
	ErrAlreadySubscribed = errors.New("ya tienes ese plan")
	ErrNoSubscription    = errors.New("aún no tienes una suscripción de pago")
	ErrComped            = errors.New("tu plan fue concedido sin cobro; escríbenos para cambiarlo")
	ErrUnknownEvent      = errors.New("el evento no corresponde a ninguna suscripción")
)

// TrialNotifier avisa que la prueba termina pronto (lo implementa el correo; opcional).
type TrialNotifier interface {
	SendTrialEnding(ctx context.Context, to, planName string, endsAt time.Time) error
}

type Service struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	plans    *plans.Service
	prov     Provider
	audit    audit.Recorder
	log      *slog.Logger
	now      func() time.Time
	notifier TrialNotifier
}

func NewService(pool *pgxpool.Pool, ps *plans.Service, prov Provider, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{pool: pool, q: q, plans: ps, prov: prov, audit: audit.Recorder{Q: q, Log: log}, log: log, now: time.Now}
}

func (s *Service) SetClock(f func() time.Time) { s.now = f }
func (s *Service) SetNotifier(n TrialNotifier) { s.notifier = n }
func (s *Service) Provider() Provider          { return s.prov }

var rank = map[string]int{"free": 0, "standard": 1, "pro": 2}

func amountFor(p plans.Plan, period string) int {
	if period == "annual" {
		return p.AnnualMXN
	}
	return p.MonthlyMXN
}

func paidPlan(code, period string) (plans.Plan, error) {
	p, err := plans.ByCode(code)
	if err != nil || p.Code == "free" {
		return plans.Plan{}, fmt.Errorf("%w: elige un plan de pago", ErrInvalid)
	}
	if period != "monthly" && period != "annual" {
		return plans.Plan{}, fmt.Errorf("%w: elige mensual o anual", ErrInvalid)
	}
	return p, nil
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: !t.IsZero()} }

func (s *Service) rec(ctx context.Context, actor uuid.UUID, action string, meta map[string]any) {
	s.audit.Record(ctx, audit.Event{Actor: actor, Action: action, ResourceType: "subscription", Metadata: meta})
}

type Actor struct {
	ID    uuid.UUID
	Email string
	Name  string
}

type CheckoutInput struct {
	Plan      string
	Period    string
	CardToken string
}

// PaymentInfo es lo que la pantalla necesita además del resumen del plan.
type PaymentInfo struct {
	Provider        string            `json:"provider"`
	ProviderConfig  map[string]string `json:"provider_config"`
	Card            *Card             `json:"card"`
	TrialAvailable  bool              `json:"trial_available"`
	TrialDays       int               `json:"trial_days"`
	HasSubscription bool              `json:"has_subscription"`
	Payments        []PaymentRow      `json:"payments"`
}

type PaymentRow struct {
	ID            uuid.UUID `json:"id"`
	Status        string    `json:"status"`
	AmountMXN     int       `json:"amount_mxn"`
	Plan          string    `json:"plan"`
	BillingPeriod string    `json:"billing_period,omitempty"`
	FailureReason string    `json:"failure_reason,omitempty"`
	OccurredAt    time.Time `json:"occurred_at"`
}

func (s *Service) Info(ctx context.Context) (PaymentInfo, error) {
	sub, err := s.q.GetSubscription(ctx)
	if err != nil {
		return PaymentInfo{}, err
	}
	rows, err := s.q.ListPayments(ctx)
	if err != nil {
		return PaymentInfo{}, err
	}
	info := PaymentInfo{Provider: s.prov.Name(), ProviderConfig: s.prov.Config(), TrialAvailable: !sub.TrialUsed, TrialDays: TrialDays,
		HasSubscription: sub.ProviderSubscriptionID.Valid, Payments: []PaymentRow{}}
	if sub.CardLast4.Valid {
		info.Card = &Card{Brand: sub.CardBrand.String, Last4: sub.CardLast4.String, ExpMonth: int(sub.CardExpMonth.Int32), ExpYear: int(sub.CardExpYear.Int32)}
	}
	for _, r := range rows {
		info.Payments = append(info.Payments, PaymentRow{ID: r.ID, Status: r.Status, AmountMXN: int(r.AmountMxn), Plan: r.Plan, BillingPeriod: r.BillingPeriod.String,
			FailureReason: r.FailureReason.String, OccurredAt: r.OccurredAt.Time})
	}
	return info, nil
}

// Checkout contrata un plan de pago: registra la tarjeta y crea la suscripción. La primera vez inicia la prueba gratuita
// (sin cobro); si ya se usó, cobra de inmediato.
func (s *Service) Checkout(ctx context.Context, a Actor, in CheckoutInput) error {
	plan, err := paidPlan(in.Plan, in.Period)
	if err != nil {
		return err
	}
	if in.CardToken == "" {
		return fmt.Errorf("%w: falta la tarjeta", ErrInvalid)
	}
	st, sub, err := s.plans.Standing(ctx)
	if err != nil {
		return err
	}
	if st.Comped && st.Plan.Code != "free" {
		return ErrComped
	}
	if sub.ProviderSubscriptionID.Valid && st.State != plans.StatusExpired && st.Plan.Code != "free" {
		return ErrAlreadySubscribed // para cambiar de plan existe ChangePlan
	}

	cust := sub.ProviderCustomerID.String
	if cust == "" {
		if cust, err = s.prov.CreateCustomer(ctx, a.Email, a.Name); err != nil {
			return err
		}
	}
	card, err := s.prov.AttachCard(ctx, cust, in.CardToken)
	if err != nil {
		s.rec(ctx, a.ID, "billing.card_rejected", map[string]any{"plan": plan.Code})
		return err
	}
	now := s.now()
	var trialEnd *time.Time
	if !sub.TrialUsed {
		t := now.AddDate(0, 0, TrialDays)
		trialEnd = &t
	}
	res, err := s.prov.Subscribe(ctx, SubscribeInput{CustomerID: cust, CardID: card.ID, Plan: plan.Code, Period: in.Period, AmountMXN: amountFor(plan, in.Period), TrialEnd: trialEnd})
	if err != nil {
		s.rec(ctx, a.ID, "billing.charge_failed", map[string]any{"plan": plan.Code, "period": in.Period})
		return err
	}

	if err := s.q.SetSubscriptionProvider(ctx, db.SetSubscriptionProviderParams{Provider: pgtype.Text{String: s.prov.Name(), Valid: true},
		ProviderCustomerID: pgtype.Text{String: cust, Valid: true}, ProviderSubscriptionID: pgtype.Text{String: res.ID, Valid: true}}); err != nil {
		return err
	}
	if err := s.setCard(ctx, card); err != nil {
		return err
	}
	ch := plans.Change{Plan: plan.Code, Period: in.Period}
	if res.Status == "trialing" {
		if err := s.q.MarkTrialUsed(ctx); err != nil {
			return err
		}
		ch.Status, ch.TrialEndsAt, ch.PeriodEnd = plans.StatusTrialing, &res.PeriodEnd, &res.PeriodEnd
	} else {
		ch.Status, ch.PeriodEnd = plans.StatusActive, &res.PeriodEnd
	}
	if err := s.plans.Apply(ctx, ch); err != nil {
		return err
	}
	if res.Paid {
		if err := s.q.InsertPayment(ctx, db.InsertPaymentParams{Provider: s.prov.Name(), ProviderChargeID: res.ChargeID, Status: "paid", AmountMxn: int32(res.AmountMXN),
			Plan: plan.Code, BillingPeriod: pgtype.Text{String: in.Period, Valid: true}, OccurredAt: ts(now)}); err != nil {
			return err
		}
	}
	s.rec(ctx, a.ID, "billing.checkout", map[string]any{"plan": plan.Code, "period": in.Period, "trial": res.Status == "trialing"})
	return nil
}

func (s *Service) setCard(ctx context.Context, c Card) error {
	return s.q.SetPaymentMethod(ctx, db.SetPaymentMethodParams{CardBrand: pgtype.Text{String: c.Brand, Valid: true}, CardLast4: pgtype.Text{String: c.Last4, Valid: true},
		CardExpMonth: pgtype.Int4{Int32: int32(c.ExpMonth), Valid: true}, CardExpYear: pgtype.Int4{Int32: int32(c.ExpYear), Valid: true}})
}

// UpdateCard cambia la tarjeta registrada (p. ej. tras un cobro fallido).
func (s *Service) UpdateCard(ctx context.Context, a Actor, token string) error {
	sub, err := s.q.GetSubscription(ctx)
	if err != nil {
		return err
	}
	if !sub.ProviderCustomerID.Valid {
		return ErrNoSubscription
	}
	card, err := s.prov.AttachCard(ctx, sub.ProviderCustomerID.String, token)
	if err != nil {
		return err
	}
	if err := s.setCard(ctx, card); err != nil {
		return err
	}
	s.rec(ctx, a.ID, "billing.card_updated", nil)
	return nil
}

// ChangePlan: subir de plan (o pasar de mensual a anual) surte efecto de inmediato; bajar, al terminar el periodo pagado.
func (s *Service) ChangePlan(ctx context.Context, a Actor, code, period string) error {
	plan, err := paidPlan(code, period)
	if err != nil {
		return err
	}
	st, sub, err := s.plans.Standing(ctx)
	if err != nil {
		return err
	}
	if st.Comped && st.Plan.Code != "free" {
		return ErrComped
	}
	if !sub.ProviderSubscriptionID.Valid || st.Plan.Code == "free" {
		return ErrNoSubscription
	}
	cur := st.Plan.Code
	if cur == code && sub.BillingPeriod.String == period {
		return ErrAlreadySubscribed
	}
	periodEnd := time.Time{}
	if sub.CurrentPeriodEnd.Valid {
		periodEnd = sub.CurrentPeriodEnd.Time
	}
	keep := plans.Change{Plan: cur, Period: sub.BillingPeriod.String, Status: sub.Status, PeriodEnd: tptr(periodEnd), TrialEndsAt: tptr(sub.TrialEndsAt.Time), GraceUntil: tptr(sub.GraceUntil.Time), CompReason: sub.CompReason.String}

	if rank[code] < rank[cur] { // bajar: se programa para el siguiente periodo
		keep.PendingPlan = code
		s.rec(ctx, a.ID, "billing.downgrade_scheduled", map[string]any{"from": cur, "to": code})
		return s.plans.Apply(ctx, keep)
	}
	res, err := s.prov.ChangePlan(ctx, sub.ProviderSubscriptionID.String, code, period, amountFor(plan, period))
	if err != nil {
		return err
	}
	if res.Paid {
		if err := s.q.InsertPayment(ctx, db.InsertPaymentParams{Provider: s.prov.Name(), ProviderChargeID: res.ChargeID, Status: "paid", AmountMxn: int32(res.AmountMXN),
			Plan: code, BillingPeriod: pgtype.Text{String: period, Valid: true}, OccurredAt: ts(s.now())}); err != nil {
			return err
		}
	}
	end := res.PeriodEnd
	if err := s.plans.Apply(ctx, plans.Change{Plan: code, Period: period, Status: plans.StatusActive, PeriodEnd: &end}); err != nil {
		return err
	}
	s.rec(ctx, a.ID, "billing.upgrade", map[string]any{"from": cur, "to": code, "period": period})
	return nil
}

func tptr(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

// Cancel cancela la renovación. Se conserva el plan hasta el fin del periodo pagado (o de la prueba); después, Gratuito.
func (s *Service) Cancel(ctx context.Context, a Actor) error {
	st, sub, err := s.plans.Standing(ctx)
	if err != nil {
		return err
	}
	if st.Comped && st.Plan.Code != "free" {
		return ErrComped
	}
	if !sub.ProviderSubscriptionID.Valid || st.Plan.Code == "free" {
		return ErrNoSubscription
	}
	if err := s.prov.Cancel(ctx, sub.ProviderSubscriptionID.String); err != nil {
		return err
	}
	end := st.EndsAt
	if end == nil && sub.CurrentPeriodEnd.Valid {
		end = &sub.CurrentPeriodEnd.Time
	}
	if end == nil {
		n := s.now()
		end = &n
	}
	if err := s.plans.Apply(ctx, plans.Change{Plan: sub.Plan, Period: sub.BillingPeriod.String, Status: plans.StatusCanceled, PeriodEnd: end, CancelAtPeriodEnd: true}); err != nil {
		return err
	}
	s.rec(ctx, a.ID, "billing.cancel", map[string]any{"plan": sub.Plan, "ends_at": end})
	return nil
}

// Refund devuelve un cobro pagado de la consulta del contexto (lo pide el CRM, con aprobación de una segunda persona).
func (s *Service) Refund(ctx context.Context, actor uuid.UUID, paymentID uuid.UUID) error {
	p, err := s.q.GetPayment(ctx, paymentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: el cobro no existe", ErrInvalid)
	}
	if err != nil {
		return err
	}
	if p.Status != "paid" {
		return fmt.Errorf("%w: solo se reembolsan cobros pagados", ErrInvalid)
	}
	if err := s.prov.Refund(ctx, p.ProviderChargeID); err != nil {
		return err
	}
	if _, err := s.q.MarkPaymentRefunded(ctx, paymentID); err != nil {
		return err
	}
	s.rec(ctx, actor, "billing.refund", map[string]any{"payment": paymentID, "amount_mxn": p.AmountMxn})
	return nil
}

// HandleEvent aplica un evento del proveedor ya verificado. Es idempotente: un reintento no repite el efecto.
func (s *Service) HandleEvent(ctx context.Context, ev Event) error {
	bypass := tenant.Bypass(ctx)
	sub, err := s.q.GetSubscriptionByProviderID(bypass, db.GetSubscriptionByProviderIDParams{Provider: pgtype.Text{String: s.prov.Name(), Valid: true},
		ProviderSubscriptionID: pgtype.Text{String: ev.SubscriptionID, Valid: true}})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUnknownEvent
	}
	if err != nil {
		return err
	}
	ctx = tenant.With(ctx, sub.PracticeID)
	n, err := s.q.InsertPaymentEvent(ctx, db.InsertPaymentEventParams{Provider: s.prov.Name(), EventID: ev.ID, EventType: ev.Type, PracticeID: uuid.NullUUID{UUID: sub.PracticeID, Valid: true}})
	if err != nil {
		return err
	}
	if n == 0 {
		return nil // ya procesado
	}
	now := s.now()
	when := ev.OccurredAt
	if when.IsZero() {
		when = now
	}
	period := ev.Period
	if period == "" {
		period = sub.BillingPeriod.String
	}
	plan := ev.Plan
	if plan == "" {
		plan = sub.Plan
	}
	switch ev.Type {
	case EventPaymentSucceeded:
		if err := s.q.InsertPayment(ctx, db.InsertPaymentParams{Provider: s.prov.Name(), ProviderChargeID: ev.ChargeID, Status: "paid", AmountMxn: int32(ev.AmountMXN),
			Plan: plan, BillingPeriod: pgtype.Text{String: period, Valid: period != ""}, OccurredAt: ts(when)}); err != nil {
			return err
		}
		if sub.Status == plans.StatusCanceled {
			return nil // la persona canceló: un cobro tardío no la reactiva
		}
		next := sub.Plan
		if sub.PendingPlan.Valid { // la bajada programada surte efecto al renovar
			next = sub.PendingPlan.String
		}
		end := ev.PeriodEnd
		if end.IsZero() {
			end = addPeriod(now, period)
		}
		s.rec(ctx, uuid.Nil, "billing.payment_succeeded", map[string]any{"plan": next, "event": ev.ID})
		return s.plans.Apply(ctx, plans.Change{Plan: next, Period: period, Status: plans.StatusActive, PeriodEnd: &end, CompReason: sub.CompReason.String})
	case EventPaymentFailed:
		if err := s.q.InsertPayment(ctx, db.InsertPaymentParams{Provider: s.prov.Name(), ProviderChargeID: ev.ChargeID, Status: "failed", AmountMxn: int32(ev.AmountMXN),
			Plan: plan, BillingPeriod: pgtype.Text{String: period, Valid: period != ""}, FailureReason: pgtype.Text{String: ev.Reason, Valid: ev.Reason != ""}, OccurredAt: ts(when)}); err != nil {
			return err
		}
		s.rec(ctx, uuid.Nil, "billing.payment_failed", map[string]any{"plan": sub.Plan, "event": ev.ID, "reason": ev.Reason})
		grace := plans.GraceUntil(now)
		if sub.Status == plans.StatusPastDue && sub.GraceUntil.Valid {
			grace = sub.GraceUntil.Time // el plazo corre desde el primer fallo, no se renueva con cada reintento
		}
		return s.plans.Apply(ctx, plans.Change{Plan: sub.Plan, Period: sub.BillingPeriod.String, Status: plans.StatusPastDue, GraceUntil: &grace, PeriodEnd: tptr(sub.CurrentPeriodEnd.Time), CompReason: sub.CompReason.String})
	case EventSubscriptionCanceled, EventChargeback:
		if ev.Type == EventChargeback {
			if err := s.q.InsertPayment(ctx, db.InsertPaymentParams{Provider: s.prov.Name(), ProviderChargeID: ev.ChargeID, Status: "chargeback", AmountMxn: int32(ev.AmountMXN),
				Plan: plan, BillingPeriod: pgtype.Text{String: period, Valid: period != ""}, OccurredAt: ts(when)}); err != nil {
				return err
			}
		}
		s.rec(ctx, uuid.Nil, "billing."+ev.Type, map[string]any{"plan": sub.Plan, "event": ev.ID})
		return s.plans.Apply(ctx, plans.Change{Plan: sub.Plan, Period: sub.BillingPeriod.String, Status: plans.StatusExpired})
	}
	return nil // tipos que no nos interesan se aceptan sin efecto
}

// NoticeDue manda el aviso previo al primer cobro a las pruebas que terminan en TrialNoticeDays o menos. Devuelve cuántos envió.
func (s *Service) NoticeDue(ctx context.Context) (int, error) {
	if s.notifier == nil {
		return 0, nil
	}
	ctx = tenant.Bypass(ctx)
	now := s.now()
	rows, err := s.q.ListTrialsEnding(ctx, db.ListTrialsEndingParams{TrialEndsAt: ts(now), TrialEndsAt_2: ts(now.AddDate(0, 0, TrialNoticeDays))})
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, r := range rows {
		email, err := s.q.GetPracticeOwnerEmail(ctx, r.PracticeID)
		if err != nil {
			continue
		}
		p, _ := plans.ByCode(r.Plan)
		if err := s.notifier.SendTrialEnding(ctx, email, p.Name, r.TrialEndsAt.Time); err != nil {
			s.log.WarnContext(ctx, "trial_notice_failed", slog.Any("error", err))
			continue
		}
		if err := s.q.MarkTrialNoticeSent(tenant.With(ctx, r.PracticeID), r.PracticeID); err != nil {
			return sent, err
		}
		sent++
	}
	return sent, nil
}
