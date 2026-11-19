package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/plans"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
func text(s string) pgtype.Text         { return pgtype.Text{String: s, Valid: s != ""} }

// Params de cada tipo de acción (se validan al pedirla y otra vez al ejecutarla).
type Params struct {
	// comp_plan
	Plan   string `json:"plan,omitempty"`
	Period string `json:"period,omitempty"`
	Days   int    `json:"days,omitempty"` // comp_plan: duración; extend_trial: días extra
	// refund
	PaymentID uuid.UUID `json:"payment_id,omitempty"`
}

type ActionRow struct {
	ID            uuid.UUID  `json:"id"`
	PracticeID    uuid.UUID  `json:"practice_id"`
	PracticeName  string     `json:"practice_name,omitempty"`
	Kind          string     `json:"kind"`
	Params        Params     `json:"params"`
	Reason        string     `json:"reason"`
	Status        string     `json:"status"`
	RequestedBy   uuid.UUID  `json:"requested_by"`
	RequesterMail string     `json:"requested_by_email,omitempty"`
	DeciderMail   string     `json:"decided_by_email,omitempty"`
	RequestedAt   time.Time  `json:"requested_at"`
	DecidedAt     *time.Time `json:"decided_at,omitempty"`
	DecisionNote  string     `json:"decision_note,omitempty"`
	Error         string     `json:"error,omitempty"`
}

func validateParams(kind string, p Params) error {
	switch kind {
	case KindCompPlan:
		pl, err := plans.ByCode(p.Plan)
		if err != nil || pl.Code == "free" {
			return fmt.Errorf("%w: elige un plan de pago", ErrInvalid)
		}
		if p.Days < 1 || p.Days > MaxCompDays {
			return fmt.Errorf("%w: la cortesía dura de 1 a %d días", ErrInvalid, MaxCompDays)
		}
		if p.Period != "" && p.Period != "monthly" && p.Period != "annual" {
			return fmt.Errorf("%w: periodo inválido", ErrInvalid)
		}
	case KindExtendTrial:
		if p.Days < 1 || p.Days > MaxTrialExtraDays {
			return fmt.Errorf("%w: la prórroga es de 1 a %d días", ErrInvalid, MaxTrialExtraDays)
		}
	case KindRefund:
		if p.PaymentID == uuid.Nil {
			return fmt.Errorf("%w: elige el cobro a reembolsar", ErrInvalid)
		}
	default:
		return fmt.Errorf("%w: tipo de acción desconocido", ErrInvalid)
	}
	return nil
}

func rowOf(a db.PlatformAction, name, mail string) ActionRow {
	var p Params
	_ = json.Unmarshal(a.Params, &p)
	r := ActionRow{ID: a.ID, PracticeID: a.PracticeID, PracticeName: name, Kind: a.Kind, Params: p, Reason: a.Reason, Status: a.Status, RequestedBy: a.RequestedBy,
		RequesterMail: mail, RequestedAt: a.RequestedAt.Time, DecisionNote: a.DecisionNote.String, Error: a.Error.String}
	if a.DecidedAt.Valid {
		t := a.DecidedAt.Time
		r.DecidedAt = &t
	}
	return r
}

// Request pide una acción que cuesta dinero. No hace nada hasta que otra persona la apruebe.
func (s *Service) Request(ctx context.Context, a Actor, practice uuid.UUID, kind string, p Params, reason string) (ActionRow, error) {
	reason, err := validReason(reason)
	if err != nil {
		return ActionRow{}, err
	}
	if err := validateParams(kind, p); err != nil {
		return ActionRow{}, err
	}
	b := tenant.Bypass(ctx)
	if _, err := s.q.PlatformGetAccount(b, practice); errors.Is(err, pgx.ErrNoRows) {
		return ActionRow{}, ErrNotFound
	} else if err != nil {
		return ActionRow{}, err
	}
	raw, _ := json.Marshal(p)
	row, err := s.q.PlatformInsertAction(b, db.PlatformInsertActionParams{PracticeID: practice, Kind: kind, Params: raw, Reason: reason, RequestedBy: a.ID})
	if err != nil {
		return ActionRow{}, err
	}
	s.rec(ctx, practice, a, "platform.action_requested", map[string]any{"kind": kind, "action": row.ID, "reason": reason})
	return rowOf(row, "", a.Email), nil
}

// Actions lista las solicitudes (todas, o de una consulta), de la más reciente a la más antigua.
func (s *Service) Actions(ctx context.Context, status string, practice uuid.UUID) ([]ActionRow, error) {
	rows, err := s.q.PlatformListActions(tenant.Bypass(ctx), status)
	if err != nil {
		return nil, err
	}
	out := []ActionRow{}
	for _, r := range rows {
		if practice != uuid.Nil && r.PracticeID != practice {
			continue
		}
		row := rowOf(db.PlatformAction{ID: r.ID, PracticeID: r.PracticeID, Kind: r.Kind, Params: r.Params, Reason: r.Reason, Status: r.Status, RequestedBy: r.RequestedBy,
			RequestedAt: r.RequestedAt, DecidedBy: r.DecidedBy, DecidedAt: r.DecidedAt, DecisionNote: r.DecisionNote, ExecutedAt: r.ExecutedAt, Error: r.Error}, r.PracticeName, r.RequesterEmail)
		row.DeciderMail = r.DeciderEmail
		out = append(out, row)
	}
	return out, nil
}

// Decide aprueba o rechaza una solicitud. Quien la pidió no puede aprobarla (salvo equipos de una persona con la excepción
// activada, que queda registrada). Al aprobar se ejecuta de inmediato; si falla, queda como «failed» con el motivo.
func (s *Service) Decide(ctx context.Context, a Actor, id uuid.UUID, approve bool, note string) (ActionRow, error) {
	b := tenant.Bypass(ctx)
	act, err := s.q.PlatformGetAction(b, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ActionRow{}, ErrNotFound
	}
	if err != nil {
		return ActionRow{}, err
	}
	if act.Status != "pending" {
		return ActionRow{}, ErrAlreadyDecided
	}
	self := act.RequestedBy == a.ID
	if approve && self && !s.allowSelf {
		return ActionRow{}, ErrSelfApproval
	}
	status := "rejected"
	if approve {
		status = "approved"
	}
	n, err := s.q.PlatformDecideAction(b, db.PlatformDecideActionParams{ID: id, Status: status, DecidedBy: uuid.NullUUID{UUID: a.ID, Valid: true}, DecisionNote: text(note)})
	if err != nil {
		return ActionRow{}, err
	}
	if n == 0 {
		return ActionRow{}, ErrAlreadyDecided // otra persona la resolvió al mismo tiempo
	}
	meta := map[string]any{"kind": act.Kind, "action": act.ID, "self_approval": approve && self}
	if !approve {
		s.rec(ctx, act.PracticeID, a, "platform.action_rejected", meta)
		return s.reload(ctx, id)
	}
	s.rec(ctx, act.PracticeID, a, "platform.action_approved", meta)
	if execErr := s.execute(ctx, a, act); execErr != nil {
		_ = s.q.PlatformFinishAction(b, db.PlatformFinishActionParams{ID: id, Status: "failed", Error: text(execErr.Error())})
		s.rec(ctx, act.PracticeID, a, "platform.action_failed", map[string]any{"kind": act.Kind, "action": act.ID, "error": execErr.Error()})
	} else {
		_ = s.q.PlatformFinishAction(b, db.PlatformFinishActionParams{ID: id, Status: "executed"})
		s.rec(ctx, act.PracticeID, a, "platform.action_executed", map[string]any{"kind": act.Kind, "action": act.ID})
	}
	return s.reload(ctx, id)
}

func (s *Service) reload(ctx context.Context, id uuid.UUID) (ActionRow, error) {
	act, err := s.q.PlatformGetAction(tenant.Bypass(ctx), id)
	if err != nil {
		return ActionRow{}, err
	}
	return rowOf(act, "", ""), nil
}

func (s *Service) execute(ctx context.Context, a Actor, act db.PlatformAction) error {
	var p Params
	if err := json.Unmarshal(act.Params, &p); err != nil {
		return err
	}
	if err := validateParams(act.Kind, p); err != nil { // el servidor no confía en lo guardado: se valida otra vez
		return err
	}
	pctx := tenant.With(ctx, act.PracticeID)
	switch act.Kind {
	case KindCompPlan:
		// Una cuenta con suscripción viva en la pasarela seguiría cobrando (y un cobro posterior volvería a cambiar el plan):
		// se cancela primero allá. Si no se puede cancelar, la cortesía no se concede.
		_, sub, err := s.plans.Standing(pctx)
		if err != nil {
			return err
		}
		if sub.ProviderSubscriptionID.Valid && sub.Status != plans.StatusCanceled && sub.Status != plans.StatusExpired {
			if s.pay == nil {
				return ErrNoPayments
			}
			if err := s.pay.Provider().Cancel(pctx, sub.ProviderSubscriptionID.String); err != nil {
				return fmt.Errorf("no se pudo cancelar la suscripción de pago antes de la cortesía: %w", err)
			}
			s.rec(ctx, act.PracticeID, a, "platform.provider_subscription_canceled", map[string]any{"action": act.ID, "plan": sub.Plan})
		}
		end := s.now().AddDate(0, 0, p.Days)
		return s.plans.Apply(pctx, plans.Change{Plan: p.Plan, Period: p.Period, Status: plans.StatusActive, PeriodEnd: &end, CompReason: act.Reason})
	case KindExtendTrial:
		st, sub, err := s.plans.Standing(pctx)
		if err != nil {
			return err
		}
		if st.State != plans.StatusTrialing {
			return fmt.Errorf("%w: la cuenta no está en prueba gratuita", ErrInvalid)
		}
		end := sub.TrialEndsAt.Time.AddDate(0, 0, p.Days)
		return s.plans.Apply(pctx, plans.Change{Plan: sub.Plan, Period: sub.BillingPeriod.String, Status: plans.StatusTrialing, TrialEndsAt: &end, PeriodEnd: &end, CompReason: sub.CompReason.String})
	case KindRefund:
		if s.pay == nil {
			return ErrNoPayments
		}
		return s.pay.Refund(pctx, a.ID, p.PaymentID)
	}
	return ErrInvalid
}
