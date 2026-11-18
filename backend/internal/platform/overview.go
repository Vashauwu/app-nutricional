package platform

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/plans"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

// Días de la serie de altas y ventana de los indicadores de cobro.
const overviewDays = 30

// TrialSoonDays: una prueba que termina en este plazo se muestra como «por vencer».
const trialSoonDays = 7

type DayCount struct {
	Day   string `json:"day"` // AAAA-MM-DD (hora de la Ciudad de México)
	Total int64  `json:"total"`
}

type PaymentStats struct {
	PaidCount   int64 `json:"paid_count"`
	PaidMXN     int64 `json:"paid_mxn"`
	FailedCount int64 `json:"failed_count"`
	ReturnedMXN int64 `json:"returned_mxn"`
}

type RecentPayment struct {
	ID           uuid.UUID `json:"id"`
	PracticeID   uuid.UUID `json:"practice_id"`
	PracticeName string    `json:"practice_name"`
	Status       string    `json:"status"`
	AmountMXN    int       `json:"amount_mxn"`
	Plan         string    `json:"plan"`
	At           time.Time `json:"occurred_at"`
}

// Attention: cuentas que piden atención (cobro fallido o prueba por vencer).
type Attention struct {
	ID         uuid.UUID  `json:"id"`
	Name       string     `json:"name"`
	OwnerEmail string     `json:"owner_email"`
	Reason     string     `json:"reason"` // past_due | trial_ending
	EndsAt     *time.Time `json:"ends_at"`
	Plan       string     `json:"plan"`
}

type Usage struct {
	ActivePatients int64 `json:"active_patients"`
	Users          int64 `json:"users"`
	StorageBytes   int64 `json:"storage_bytes"`
}

// Overview es el resumen del panel. Todo sale de datos reales; el ingreso mensual recurrente (MRR) es una ESTIMACIÓN con el
// precio de lista de cada plan (anual / 12) de las cuentas que pagan: no incluye cortesías ni cuentas en prueba.
type Overview struct {
	GeneratedAt      time.Time       `json:"generated_at"`
	Accounts         int             `json:"accounts"`
	Suspended        int             `json:"suspended"`
	Comped           int             `json:"comped"`
	ByState          map[string]int  `json:"by_state"`
	ByPlan           map[string]int  `json:"by_plan"`
	PayingAccounts   int             `json:"paying_accounts"`
	MRRMXN           int             `json:"mrr_mxn"`
	TrialsEndingSoon int             `json:"trials_ending_soon"`
	PendingActions   int64           `json:"pending_actions"`
	SignupsDaily     []DayCount      `json:"signups_daily"`
	Signups30        int64           `json:"signups_30d"`
	SignupsPrev30    int64           `json:"signups_prev_30d"`
	Payments30       PaymentStats    `json:"payments_30d"`
	RecentPayments   []RecentPayment `json:"recent_payments"`
	Attention        []Attention     `json:"attention"`
	Usage            Usage           `json:"usage"`
}

func (s *Service) Overview(ctx context.Context) (Overview, error) {
	b := tenant.Bypass(ctx)
	now := s.now()
	o := Overview{GeneratedAt: now, ByState: map[string]int{}, ByPlan: map[string]int{}, SignupsDaily: []DayCount{}, RecentPayments: []RecentPayment{}, Attention: []Attention{}}

	subs, err := s.q.PlatformOverviewSubs(b)
	if err != nil {
		return o, err
	}
	soon := now.AddDate(0, 0, trialSoonDays)
	for _, r := range subs {
		sub := db.Subscription{Plan: r.Plan, Status: r.SubStatus, BillingPeriod: r.BillingPeriod, TrialEndsAt: r.TrialEndsAt, GraceUntil: r.GraceUntil, CurrentPeriodEnd: r.CurrentPeriodEnd, CompReason: r.CompReason}
		st, err := plans.Resolve(sub, now)
		if err != nil {
			return o, err
		}
		o.Accounts++
		o.ByState[st.State]++
		o.ByPlan[st.Plan.Code]++
		if r.Status != "active" {
			o.Suspended++
		}
		if st.Comped {
			o.Comped++
		}
		if (st.State == "active" || st.State == "past_due") && !st.Comped && st.Plan.MonthlyMXN > 0 {
			o.PayingAccounts++
			if r.BillingPeriod.String == "annual" {
				o.MRRMXN += st.Plan.AnnualMXN / 12
			} else {
				o.MRRMXN += st.Plan.MonthlyMXN
			}
		}
		trialEnding := st.State == "trialing" && st.EndsAt != nil && !st.EndsAt.After(soon)
		if trialEnding {
			o.TrialsEndingSoon++
		}
		if (st.State == "past_due" || trialEnding) && len(o.Attention) < 8 {
			reason := "past_due"
			if trialEnding {
				reason = "trial_ending"
			}
			o.Attention = append(o.Attention, Attention{ID: r.ID, Name: r.Name, OwnerEmail: r.OwnerEmail, Reason: reason, EndsAt: st.EndsAt, Plan: r.Plan})
		}
	}

	mx, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		mx = time.UTC
	}
	today := now.In(mx)
	toDay := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	fromDay := toDay.AddDate(0, 0, -(2*overviewDays - 1)) // 60 días: los últimos 30 y los 30 anteriores, para comparar
	days, err := s.q.PlatformSignupsByDay(b, db.PlatformSignupsByDayParams{FromDay: pgtype.Date{Time: fromDay, Valid: true}, ToDay: pgtype.Date{Time: toDay, Valid: true}})
	if err != nil {
		return o, err
	}
	for i, d := range days {
		if i < overviewDays {
			o.SignupsPrev30 += d.Total
			continue
		}
		o.Signups30 += d.Total
		o.SignupsDaily = append(o.SignupsDaily, DayCount{Day: d.Day.Time.Format("2006-01-02"), Total: d.Total})
	}

	ps, err := s.q.PlatformPaymentStats(b, pgtype.Timestamptz{Time: now.AddDate(0, 0, -overviewDays), Valid: true})
	if err != nil {
		return o, err
	}
	o.Payments30 = PaymentStats{PaidCount: ps.PaidCount, PaidMXN: ps.PaidMxn, FailedCount: ps.FailedCount, ReturnedMXN: ps.ReturnedMxn}

	rp, err := s.q.PlatformRecentPayments(b)
	if err != nil {
		return o, err
	}
	for _, p := range rp {
		o.RecentPayments = append(o.RecentPayments, RecentPayment{ID: p.ID, PracticeID: p.PracticeID, PracticeName: p.PracticeName, Status: p.Status, AmountMXN: int(p.AmountMxn), Plan: p.Plan, At: p.OccurredAt.Time})
	}

	u, err := s.q.PlatformUsageTotals(b)
	if err != nil {
		return o, err
	}
	o.Usage = Usage{ActivePatients: u.ActivePatients, Users: u.Users, StorageBytes: u.StorageBytes}
	o.PendingActions = u.PendingActions
	return o, nil
}
