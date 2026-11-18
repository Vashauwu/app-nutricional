package plans

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/generated/db"
)

// Service resuelve el plan de la consulta del contexto (tenant.With) y valida sus límites.
type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
	now  func() time.Time
	// smae: el catálogo oficial está encendido. Apagado, la lista de funciones no lo anuncia.
	smae bool
	// paymentsReady: hay cobro en línea (la pantalla ofrece contratar en vez de solo anotar el interés).
	paymentsReady bool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, q: db.New(pool), now: time.Now, smae: true}
}

// SetPaymentsReady indica si hay cobro en línea.
func (s *Service) SetPaymentsReady(v bool) { s.paymentsReady = v }

// SetSMAE indica si el catálogo SMAE oficial está encendido (para no anunciarlo si no lo está).
func (s *Service) SetSMAE(v bool) { s.smae = v }

// catalog devuelve los planes con la lista de funciones ajustada a lo que la plataforma ofrece hoy.
func (s *Service) catalog() []Plan {
	out := make([]Plan, len(Catalog))
	for i, p := range Catalog {
		p.Features = append([]string(nil), p.Features...)
		if !s.smae {
			for j, f := range p.Features {
				if f == featPlatillosSMAE {
					p.Features[j] = featPlatillosPropios
				}
			}
		}
		out[i] = p
	}
	return out
}

// SetClock fija el reloj (pruebas del ciclo de vida).
func (s *Service) SetClock(now func() time.Time) { s.now = now }

type Usage struct {
	ActivePatients int   `json:"active_patients"`
	StorageBytes   int64 `json:"storage_bytes"`
}

type Summary struct {
	// Plan es el EFECTIVO: el que valida límites. Contracted es el elegido aunque ya no esté vigente.
	Plan          Plan   `json:"plan"`
	Contracted    Plan   `json:"contracted"`
	BillingPeriod string `json:"billing_period"`
	// State: free | trialing | active | past_due | canceled | expired.
	State             string     `json:"state"`
	EndsAt            *time.Time `json:"ends_at"`
	Downgraded        bool       `json:"downgraded"`
	Comped            bool       `json:"comped"`
	CompReason        string     `json:"comp_reason,omitempty"`
	CancelAtPeriodEnd bool       `json:"cancel_at_period_end"`
	PendingPlan       string     `json:"pending_plan,omitempty"`
	Usage             Usage      `json:"usage"`
	Catalog           []Plan     `json:"catalog"`
	PaymentsReady     bool       `json:"payments_ready"`
}

// Standing devuelve la situación de la consulta del contexto: plan contratado, plan efectivo y estado.
func (s *Service) Standing(ctx context.Context) (Standing, db.Subscription, error) {
	sub, err := s.q.GetSubscription(ctx)
	if err != nil {
		return Standing{}, db.Subscription{}, err
	}
	st, err := Resolve(sub, s.now())
	return st, sub, err
}

// Current devuelve el plan EFECTIVO de la consulta del contexto: la única puerta que consultan los límites. Si la
// suscripción venció, es Gratuito; nada se borra, solo se bloquea crear por encima de sus cupos.
func (s *Service) Current(ctx context.Context) (Plan, db.Subscription, error) {
	st, sub, err := s.Standing(ctx)
	return st.Plan, sub, err
}

func (s *Service) Usage(ctx context.Context) (Usage, error) {
	n, err := s.q.CountActivePatients(ctx)
	if err != nil {
		return Usage{}, err
	}
	b, err := s.q.PracticeStorageUsed(ctx)
	if err != nil {
		return Usage{}, err
	}
	return Usage{ActivePatients: int(n), StorageBytes: b}, nil
}

func (s *Service) Summary(ctx context.Context) (Summary, error) {
	st, sub, err := s.Standing(ctx)
	if err != nil {
		return Summary{}, err
	}
	u, err := s.Usage(ctx)
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		Plan: st.Plan, Contracted: st.Contracted, BillingPeriod: sub.BillingPeriod.String, State: st.State, EndsAt: st.EndsAt,
		Downgraded: st.Downgraded, Comped: st.Comped, CompReason: sub.CompReason.String, CancelAtPeriodEnd: sub.CancelAtPeriodEnd,
		PendingPlan: sub.PendingPlan.String, Usage: u, Catalog: s.catalog(), PaymentsReady: s.paymentsReady,
	}, nil
}

// CanAddPatient falla con *LimitError si un paciente más rebasaría el plan.
func (s *Service) CanAddPatient(ctx context.Context) error {
	p, _, err := s.Current(ctx)
	if err != nil {
		return err
	}
	if p.Limits.ActivePatients == Unlimited {
		return nil
	}
	u, err := s.Usage(ctx)
	if err != nil {
		return err
	}
	if u.ActivePatients >= p.Limits.ActivePatients {
		return &LimitError{Code: "patients", Message: fmt.Sprintf("Tu plan %s incluye hasta %d pacientes activos. Archiva pacientes o cambia de plan en Facturación.", p.Name, p.Limits.ActivePatients)}
	}
	return nil
}

// CanStore falla con *LimitError si guardar `add` bytes más rebasaría el espacio del plan.
func (s *Service) CanStore(ctx context.Context, add int64) error {
	p, _, err := s.Current(ctx)
	if err != nil {
		return err
	}
	if p.Limits.StorageBytes == Unlimited {
		return nil
	}
	u, err := s.Usage(ctx)
	if err != nil {
		return err
	}
	if u.StorageBytes+add > p.Limits.StorageBytes {
		return &LimitError{Code: "storage", Message: fmt.Sprintf("Tu plan %s incluye %d MB de archivos y ya no hay espacio. Libera espacio o cambia de plan en Facturación.", p.Name, p.Limits.StorageBytes/mb)}
	}
	return nil
}

// CanUseTrackingPhotos falla si el plan no incluye las fotografías de seguimiento.
func (s *Service) CanUseTrackingPhotos(ctx context.Context) error {
	p, _, err := s.Current(ctx)
	if err != nil {
		return err
	}
	if !p.Limits.TrackingPhotos {
		return &LimitError{Code: "tracking_photos", Message: fmt.Sprintf("Las fotografías de seguimiento no están en el plan %s. Cambia de plan en Facturación para usarlas.", p.Name)}
	}
	return nil
}

// Change describe el estado completo de una suscripción. Lo usan la CLI de administración, el CRM y el cobro (webhooks).
type Change struct {
	Plan              string
	Period            string // monthly | annual | ""
	Status            string // por omisión: active
	TrialEndsAt       *time.Time
	GraceUntil        *time.Time
	PeriodEnd         *time.Time
	CancelAtPeriodEnd bool
	PendingPlan       string
	CompReason        string
}

var (
	ErrInvalidChange = errors.New("cambio de suscripción inválido")
	// ErrNoSubscription: no hay consulta en el contexto o no tiene suscripción: no se cambió nada.
	ErrNoSubscription = errors.New("la consulta no tiene suscripción")
)

func ts(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// Apply fija el estado de la suscripción de la consulta del contexto. Valida que el estado tenga sus fechas: una prueba sin
// fin, una gracia sin fin o una cancelada sin fin de periodo vencerían de inmediato.
func (s *Service) Apply(ctx context.Context, c Change) error {
	if _, err := ByCode(c.Plan); err != nil {
		return err
	}
	if c.PendingPlan != "" {
		if _, err := ByCode(c.PendingPlan); err != nil {
			return err
		}
	}
	if c.Status == "" {
		c.Status = StatusActive
	}
	switch c.Status {
	case StatusActive, StatusExpired:
	case StatusTrialing:
		if c.TrialEndsAt == nil {
			return fmt.Errorf("%w: la prueba necesita fecha de fin", ErrInvalidChange)
		}
	case StatusPastDue:
		if c.GraceUntil == nil {
			return fmt.Errorf("%w: la gracia necesita fecha de fin", ErrInvalidChange)
		}
	case StatusCanceled:
		if c.PeriodEnd == nil {
			return fmt.Errorf("%w: la cancelada necesita el fin del periodo pagado", ErrInvalidChange)
		}
	default:
		return fmt.Errorf("%w: estado %q", ErrInvalidChange, c.Status)
	}
	if c.Period != "" && c.Period != "monthly" && c.Period != "annual" {
		return fmt.Errorf("%w: periodo %q", ErrInvalidChange, c.Period)
	}
	n, err := s.q.ApplySubscription(ctx, db.ApplySubscriptionParams{
		Plan: c.Plan, BillingPeriod: pgtype.Text{String: c.Period, Valid: c.Period != ""}, Status: c.Status,
		TrialEndsAt: ts(c.TrialEndsAt), GraceUntil: ts(c.GraceUntil), CurrentPeriodEnd: ts(c.PeriodEnd),
		CancelAtPeriodEnd: c.CancelAtPeriodEnd, PendingPlan: pgtype.Text{String: c.PendingPlan, Valid: c.PendingPlan != ""},
		CompReason: pgtype.Text{String: c.CompReason, Valid: c.CompReason != ""},
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNoSubscription
	}
	return nil
}

// SetPlan asigna un plan sin cobro ni vencimiento (cuenta de ejemplo, ajuste manual). Conserva el motivo si ya lo había.
func (s *Service) SetPlan(ctx context.Context, code, period string) error {
	return s.Apply(ctx, Change{Plan: code, Period: period, Status: StatusActive})
}
