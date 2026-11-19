// Package platform es la operación interna de la plataforma sobre las cuentas (consultas y suscripciones): buscarlas,
// ver su plan y uso, suspenderlas por abuso y conceder cortesías o reembolsos. Todo lo que cuesta dinero necesita que lo pida
// una persona y lo apruebe OTRA, y todo queda en la bitácora.
//
// Lo opera el equipo propio del CRM con roles finos (dueño, soporte, solo lectura, contenido; staff.go). La verificación en
// dos pasos y la vista de varios ambientes están pendientes (docs/interno/crm-cuentas.md).
package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/payments"
	"github.com/nutri/app-nutricional/backend/internal/plans"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

var (
	ErrNotFound       = errors.New("no existe")
	ErrInvalid        = errors.New("solicitud inválida")
	ErrSelfApproval   = errors.New("quien pidió la acción no puede aprobarla: la aprueba otra persona")
	ErrAlreadyDecided = errors.New("la solicitud ya fue resuelta")
	ErrNoPayments     = errors.New("el cobro en línea no está activo en este ambiente")
)

const (
	KindCompPlan    = "comp_plan"
	KindExtendTrial = "extend_trial"
	KindRefund      = "refund"

	// MaxCompDays: una cortesía no se concede por más de un año; se renueva con otra solicitud.
	MaxCompDays = 366
	// MaxTrialExtraDays: tope de prórroga de una prueba.
	MaxTrialExtraDays = 30
)

type Actor struct {
	ID    uuid.UUID
	Email string
}

type Service struct {
	pool  *pgxpool.Pool
	q     *db.Queries
	plans *plans.Service
	pay   *payments.Service // nil si no hay cobro en línea
	auth  *auth.Service     // alta e invitación del equipo; nil en pruebas que no lo usan
	audit audit.Recorder
	log   *slog.Logger
	now   func() time.Time
	// allowSelf: permite que una sola persona pida y apruebe (equipos de una persona). Desactivado por omisión; cada uso queda
	// registrado como autoaprobación.
	allowSelf bool
}

func NewService(pool *pgxpool.Pool, ps *plans.Service, pay *payments.Service, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{pool: pool, q: q, plans: ps, pay: pay, audit: audit.Recorder{Q: q, Log: log}, log: log, now: time.Now}
}

func (s *Service) SetClock(f func() time.Time) { s.now = f }
func (s *Service) AllowSelfApproval(v bool)    { s.allowSelf = v }

// rec escribe en la bitácora de la consulta afectada (la fila queda con su practice_id).
func (s *Service) rec(ctx context.Context, practice uuid.UUID, actor Actor, action string, meta map[string]any) {
	if meta == nil {
		meta = map[string]any{}
	}
	meta["by"] = actor.Email
	s.audit.Record(tenant.With(ctx, practice), audit.Event{Actor: actor.ID, Action: action, ResourceType: "practice", ResourceID: practice, Metadata: meta})
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(s))
}

type AccountRow struct {
	ID              uuid.UUID `json:"id"`
	Name            string    `json:"name"`
	Status          string    `json:"status"`
	SuspendedReason string    `json:"suspended_reason,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	OwnerEmail      string    `json:"owner_email"`
	Plan            string    `json:"plan"`
	// State es el estado efectivo (free, trialing, active, past_due, canceled, expired).
	State          string     `json:"state"`
	EffectivePlan  string     `json:"effective_plan"`
	EndsAt         *time.Time `json:"ends_at"`
	Comped         bool       `json:"comped"`
	ActivePatients int64      `json:"active_patients"`
}

type AccountsPage struct {
	Items  []AccountRow `json:"items"`
	Total  int64        `json:"total"`
	Limit  int          `json:"limit"`
	Offset int          `json:"offset"`
}

type ListQuery struct {
	Search, Plan, Status string
	// Sort: name, plan, patients o created (omisión: las más recientes primero). Desc invierte el orden.
	Sort          string
	Desc          bool
	Limit, Offset int
}

// sortKey acepta solo las columnas conocidas: cualquier otro valor cae al orden por omisión.
func sortKey(k string) string {
	switch k {
	case "name", "plan", "patients", "created":
		return k
	}
	return ""
}

func (s *Service) ListAccounts(ctx context.Context, q ListQuery) (AccountsPage, error) {
	if q.Limit < 1 || q.Limit > 100 {
		q.Limit = 25
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	rows, err := s.q.PlatformListAccounts(tenant.Bypass(ctx), db.PlatformListAccountsParams{Search: escapeLike(q.Search), Plan: q.Plan, PracticeStatus: q.Status, SortKey: sortKey(q.Sort), SortDesc: q.Desc, PageLimit: int32(q.Limit), PageOffset: int32(q.Offset)})
	if err != nil {
		return AccountsPage{}, err
	}
	out := AccountsPage{Items: []AccountRow{}, Limit: q.Limit, Offset: q.Offset}
	for _, r := range rows {
		out.Total = r.Total
		sub := db.Subscription{Plan: r.Plan, Status: r.SubStatus, BillingPeriod: r.BillingPeriod, TrialEndsAt: r.TrialEndsAt, GraceUntil: r.GraceUntil, CurrentPeriodEnd: r.CurrentPeriodEnd, CompReason: r.CompReason}
		st, err := plans.Resolve(sub, s.now())
		if err != nil {
			return AccountsPage{}, err
		}
		out.Items = append(out.Items, AccountRow{ID: r.ID, Name: r.Name, Status: r.Status, SuspendedReason: r.SuspendedReason.String, CreatedAt: r.CreatedAt.Time, OwnerEmail: r.OwnerEmail,
			Plan: r.Plan, State: st.State, EffectivePlan: st.Plan.Code, EndsAt: st.EndsAt, Comped: st.Comped, ActivePatients: r.ActivePatients})
	}
	return out, nil
}

type PaymentRow struct {
	ID        uuid.UUID `json:"id"`
	Status    string    `json:"status"`
	AmountMXN int       `json:"amount_mxn"`
	Plan      string    `json:"plan"`
	Reason    string    `json:"failure_reason,omitempty"`
	At        time.Time `json:"occurred_at"`
}

type AuditRow struct {
	Action string         `json:"action"`
	Actor  string         `json:"actor"`
	At     time.Time      `json:"occurred_at"`
	Meta   map[string]any `json:"metadata"`
}

type AccountDetail struct {
	AccountRow
	BillingPeriod     string       `json:"billing_period,omitempty"`
	CompReason        string       `json:"comp_reason,omitempty"`
	CancelAtPeriodEnd bool         `json:"cancel_at_period_end"`
	TrialUsed         bool         `json:"trial_used"`
	Provider          string       `json:"provider,omitempty"`
	Card              string       `json:"card,omitempty"`
	StorageBytes      int64        `json:"storage_bytes"`
	Users             int64        `json:"users"`
	Limits            plans.Limits `json:"limits"`
	Payments          []PaymentRow `json:"payments"`
	Audit             []AuditRow   `json:"audit"`
	Actions           []ActionRow  `json:"actions"`
}

func (s *Service) Account(ctx context.Context, id uuid.UUID) (AccountDetail, error) {
	b := tenant.Bypass(ctx)
	r, err := s.q.PlatformGetAccount(b, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return AccountDetail{}, ErrNotFound
	}
	if err != nil {
		return AccountDetail{}, err
	}
	sub := db.Subscription{Plan: r.Plan, Status: r.SubStatus, BillingPeriod: r.BillingPeriod, TrialEndsAt: r.TrialEndsAt, GraceUntil: r.GraceUntil, CurrentPeriodEnd: r.CurrentPeriodEnd, CompReason: r.CompReason}
	st, err := plans.Resolve(sub, s.now())
	if err != nil {
		return AccountDetail{}, err
	}
	d := AccountDetail{
		AccountRow: AccountRow{ID: r.ID, Name: r.Name, Status: r.Status, SuspendedReason: r.SuspendedReason.String, CreatedAt: r.CreatedAt.Time, OwnerEmail: r.OwnerEmail, Plan: r.Plan, State: st.State,
			EffectivePlan: st.Plan.Code, EndsAt: st.EndsAt, Comped: st.Comped, ActivePatients: r.ActivePatients},
		BillingPeriod: r.BillingPeriod.String, CompReason: r.CompReason.String, CancelAtPeriodEnd: r.CancelAtPeriodEnd, TrialUsed: r.TrialUsed, Provider: r.Provider.String,
		StorageBytes: r.StorageBytes, Users: r.Users, Limits: st.Plan.Limits, Payments: []PaymentRow{}, Audit: []AuditRow{}, Actions: []ActionRow{},
	}
	if r.CardLast4.Valid {
		d.Card = r.CardBrand.String + " ···· " + r.CardLast4.String
	}
	pays, err := s.q.PlatformListPayments(b, id)
	if err != nil {
		return AccountDetail{}, err
	}
	for _, p := range pays {
		d.Payments = append(d.Payments, PaymentRow{ID: p.ID, Status: p.Status, AmountMXN: int(p.AmountMxn), Plan: p.Plan, Reason: p.FailureReason.String, At: p.OccurredAt.Time})
	}
	au, err := s.q.PlatformListAudit(b, uuid.NullUUID{UUID: id, Valid: true})
	if err != nil {
		return AccountDetail{}, err
	}
	for _, a := range au {
		var meta map[string]any
		_ = json.Unmarshal(a.Metadata, &meta)
		d.Audit = append(d.Audit, AuditRow{Action: a.Action, Actor: a.ActorEmail, At: a.OccurredAt.Time, Meta: meta})
	}
	acts, err := s.Actions(ctx, "", id)
	if err != nil {
		return AccountDetail{}, err
	}
	d.Actions = acts
	return d, nil
}

func validReason(r string) (string, error) {
	r = strings.TrimSpace(r)
	if len([]rune(r)) < 10 {
		return "", fmt.Errorf("%w: explica el motivo (al menos 10 caracteres)", ErrInvalid)
	}
	if len([]rune(r)) > 500 {
		return "", fmt.Errorf("%w: el motivo es demasiado largo", ErrInvalid)
	}
	return r, nil
}

// Suspend bloquea el acceso de todas las personas de la consulta y cierra sus sesiones. No borra nada.
func (s *Service) Suspend(ctx context.Context, a Actor, practice uuid.UUID, reason string) error {
	reason, err := validReason(reason)
	if err != nil {
		return err
	}
	b := tenant.Bypass(ctx)
	n, err := s.q.PlatformSetPracticeStatus(b, db.PlatformSetPracticeStatusParams{ID: practice, Status: "suspended", SuspendedAt: ts(s.now()), SuspendedReason: text(reason)})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if err := s.q.PlatformRevokePracticeSessions(b, practice); err != nil {
		return err
	}
	s.rec(ctx, practice, a, "platform.suspend", map[string]any{"reason": reason})
	return nil
}

func (s *Service) Reactivate(ctx context.Context, a Actor, practice uuid.UUID) error {
	n, err := s.q.PlatformSetPracticeStatus(tenant.Bypass(ctx), db.PlatformSetPracticeStatusParams{ID: practice, Status: "active"})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.rec(ctx, practice, a, "platform.reactivate", nil)
	return nil
}
