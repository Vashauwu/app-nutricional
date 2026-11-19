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
	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

// Ciclo de la landing (docs/interno/crm-landing.md): borrador → pendiente (se pidió publicar, con motivo) → publicada. Quien pide
// NO aprueba (cuatro ojos, como las acciones que cuestan dinero). Cada versión publicada es inmutable; volver atrás crea un
// borrador nuevo con el contenido viejo y pasa por el mismo camino.

var (
	ErrLandingPending = errors.New("hay una publicación pendiente de aprobación: retírala o espera la decisión")
	ErrNoDraft        = errors.New("no hay un borrador")
	ErrNotPending     = errors.New("no hay una publicación pendiente")
)

// LandingInvalid lleva todos los problemas del contenido, cada uno con su campo.
type LandingInvalid struct{ Errors []LandingError }

func (e *LandingInvalid) Error() string {
	if len(e.Errors) == 0 {
		return "contenido inválido"
	}
	return fmt.Sprintf("el contenido no es válido (%d problema(s)): %s: %s", len(e.Errors), e.Errors[0].Path, e.Errors[0].Message)
}

type LandingVersion struct {
	ID           uuid.UUID      `json:"id"`
	Number       *int           `json:"number"`
	Status       string         `json:"status"` // draft | pending | published | superseded
	Content      LandingContent `json:"content"`
	BaseNumber   *int           `json:"base_number"`
	Reason       string         `json:"reason,omitempty"`
	RequestedBy  string         `json:"requested_by,omitempty"`
	RequestedAt  *time.Time     `json:"requested_at,omitempty"`
	DecidedBy    string         `json:"decided_by,omitempty"`
	DecidedAt    *time.Time     `json:"decided_at,omitempty"`
	DecisionNote string         `json:"decision_note,omitempty"`
	PublishedAt  *time.Time     `json:"published_at,omitempty"`
	requesterID  uuid.NullUUID
}

type LandingState struct {
	Published *LandingVersion `json:"published"`
	Draft     *LandingVersion `json:"draft"`
}

type LandingVersionRow struct {
	Number       int        `json:"number"`
	Status       string     `json:"status"`
	Reason       string     `json:"reason,omitempty"`
	RequestedBy  string     `json:"requested_by,omitempty"`
	RequestedAt  *time.Time `json:"requested_at,omitempty"`
	DecidedBy    string     `json:"decided_by,omitempty"`
	DecidedAt    *time.Time `json:"decided_at,omitempty"`
	DecisionNote string     `json:"decision_note,omitempty"`
	PublishedAt  *time.Time `json:"published_at,omitempty"`
}

func tptr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func iptr(i pgtype.Int4) *int {
	if !i.Valid {
		return nil
	}
	v := int(i.Int32)
	return &v
}

func toLandingVersion(r db.LandingFindRow) (LandingVersion, error) {
	v := LandingVersion{ID: r.ID, Number: iptr(r.Number), Status: r.Status, BaseNumber: iptr(r.BaseNumber), Reason: r.Reason.String, RequestedBy: r.RequesterEmail,
		RequestedAt: tptr(r.RequestedAt), DecidedBy: r.DeciderEmail, DecidedAt: tptr(r.DecidedAt), DecisionNote: r.DecisionNote.String, PublishedAt: tptr(r.PublishedAt), requesterID: r.RequestedBy}
	if err := json.Unmarshal(r.Content, &v.Content); err != nil {
		return LandingVersion{}, fmt.Errorf("el contenido guardado no se puede leer: %w", err)
	}
	return v, nil
}

func (s *Service) findLanding(ctx context.Context, p db.LandingFindParams) (*LandingVersion, error) {
	r, err := s.q.LandingFind(tenant.Bypass(ctx), p)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v, err := toLandingVersion(r)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Service) openLanding(ctx context.Context) (*LandingVersion, error) {
	return s.findLanding(ctx, db.LandingFindParams{OpenOne: true})
}

// Landing devuelve lo publicado y el borrador (o la publicación pendiente), si existen.
func (s *Service) Landing(ctx context.Context) (LandingState, error) {
	pub, err := s.findLanding(ctx, db.LandingFindParams{PublishedOne: true})
	if err != nil {
		return LandingState{}, err
	}
	open, err := s.openLanding(ctx)
	if err != nil {
		return LandingState{}, err
	}
	return LandingState{Published: pub, Draft: open}, nil
}

// PublishedLanding es lo que ve el público: solo la versión publicada (ErrNotFound si aún no hay ninguna).
func (s *Service) PublishedLanding(ctx context.Context) (LandingVersion, error) {
	v, err := s.findLanding(ctx, db.LandingFindParams{PublishedOne: true})
	if err != nil {
		return LandingVersion{}, err
	}
	if v == nil {
		return LandingVersion{}, ErrNotFound
	}
	return *v, nil
}

func landingInvalid(errs []LandingError) error {
	if len(errs) == 0 {
		return nil
	}
	return &LandingInvalid{Errors: errs}
}

func (s *Service) publishedNumber(ctx context.Context) pgtype.Int4 {
	if p, err := s.findLanding(ctx, db.LandingFindParams{PublishedOne: true}); err == nil && p != nil && p.Number != nil {
		return pgtype.Int4{Int32: int32(*p.Number), Valid: true}
	}
	return pgtype.Int4{}
}

// SaveLandingDraft guarda el borrador (lo crea si no hay). Valida todo y rechaza con la lista de problemas por campo.
func (s *Service) SaveLandingDraft(ctx context.Context, a Actor, c LandingContent) (LandingVersion, error) {
	if err := landingInvalid(ValidateLanding(c)); err != nil {
		return LandingVersion{}, err
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return LandingVersion{}, err
	}
	b := tenant.Bypass(ctx)
	open, err := s.openLanding(ctx)
	if err != nil {
		return LandingVersion{}, err
	}
	switch {
	case open != nil && open.Status == "pending":
		return LandingVersion{}, ErrLandingPending
	case open != nil:
		_, err = s.q.LandingUpdateDraft(b, db.LandingUpdateDraftParams{ID: open.ID, Content: raw, BaseNumber: s.publishedNumber(ctx)})
	default:
		_, err = s.q.LandingInsertDraft(b, db.LandingInsertDraftParams{Content: raw, BaseNumber: s.publishedNumber(ctx), CreatedBy: uuid.NullUUID{UUID: a.ID, Valid: true}})
	}
	if err != nil {
		return LandingVersion{}, err
	}
	v, err := s.openLanding(ctx)
	if err != nil || v == nil {
		return LandingVersion{}, errors.Join(err, ErrNoDraft)
	}
	return *v, nil
}

func (s *Service) recLanding(ctx context.Context, a Actor, action string, meta map[string]any) {
	if pid, err := s.staffPractice(ctx); err == nil {
		s.rec(ctx, pid, a, action, meta)
	}
}

// RequestLanding pide publicar el borrador. No publica nada hasta que otra persona lo apruebe.
func (s *Service) RequestLanding(ctx context.Context, a Actor, reason string) (LandingVersion, error) {
	reason, err := validReason(reason)
	if err != nil {
		return LandingVersion{}, err
	}
	open, err := s.openLanding(ctx)
	if err != nil {
		return LandingVersion{}, err
	}
	if open == nil {
		return LandingVersion{}, ErrNoDraft
	}
	if open.Status == "pending" {
		return LandingVersion{}, ErrLandingPending
	}
	if err := landingInvalid(ValidateLanding(open.Content)); err != nil { // el borrador pudo venir de una versión vieja
		return LandingVersion{}, err
	}
	if _, err := s.q.LandingRequest(tenant.Bypass(ctx), db.LandingRequestParams{ID: open.ID, Reason: text(reason), RequestedBy: uuid.NullUUID{UUID: a.ID, Valid: true}}); err != nil {
		return LandingVersion{}, err
	}
	s.recLanding(ctx, a, "platform.landing_requested", map[string]any{"reason": reason})
	v, err := s.openLanding(ctx)
	if err != nil || v == nil {
		return LandingVersion{}, errors.Join(err, ErrNoDraft)
	}
	return *v, nil
}

// WithdrawLanding retira la publicación pendiente (solo quien la pidió); el texto vuelve a ser un borrador.
func (s *Service) WithdrawLanding(ctx context.Context, a Actor) (LandingVersion, error) {
	open, err := s.openLanding(ctx)
	if err != nil {
		return LandingVersion{}, err
	}
	if open == nil || open.Status != "pending" {
		return LandingVersion{}, ErrNotPending
	}
	if !open.requesterID.Valid || open.requesterID.UUID != a.ID {
		return LandingVersion{}, fmt.Errorf("%w: solo quien la pidió puede retirarla", ErrInvalid)
	}
	if _, err := s.q.LandingWithdraw(tenant.Bypass(ctx), open.ID); err != nil {
		return LandingVersion{}, err
	}
	s.recLanding(ctx, a, "platform.landing_withdrawn", nil)
	v, err := s.openLanding(ctx)
	if err != nil || v == nil {
		return LandingVersion{}, errors.Join(err, ErrNoDraft)
	}
	return *v, nil
}

// DecideLanding aprueba (publica al instante) o rechaza (el texto vuelve a borrador con la nota). Quien pidió no aprueba.
func (s *Service) DecideLanding(ctx context.Context, a Actor, approve bool, note string) (LandingState, error) {
	open, err := s.openLanding(ctx)
	if err != nil {
		return LandingState{}, err
	}
	if open == nil || open.Status != "pending" {
		return LandingState{}, ErrNotPending
	}
	self := open.requesterID.Valid && open.requesterID.UUID == a.ID
	if approve && self && !s.allowSelf {
		return LandingState{}, ErrSelfApproval
	}
	b := tenant.Bypass(ctx)
	me := uuid.NullUUID{UUID: a.ID, Valid: true}
	if !approve {
		if _, err := s.q.LandingReject(b, db.LandingRejectParams{ID: open.ID, DecidedBy: me, DecisionNote: text(note)}); err != nil {
			return LandingState{}, ErrAlreadyDecided
		}
		s.recLanding(ctx, a, "platform.landing_rejected", map[string]any{"note": note})
		return s.Landing(ctx)
	}
	// El servidor no confía en lo guardado: se valida otra vez justo antes de publicar.
	if err := landingInvalid(ValidateLanding(open.Content)); err != nil {
		return LandingState{}, err
	}
	tx, err := s.pool.Begin(b)
	if err != nil {
		return LandingState{}, err
	}
	defer func() { _ = tx.Rollback(b) }()
	q := s.q.WithTx(tx)
	if err := q.LandingSupersedePublished(b); err != nil {
		return LandingState{}, err
	}
	n, err := q.LandingNextNumber(b)
	if err != nil {
		return LandingState{}, err
	}
	if _, err := q.LandingPublish(b, db.LandingPublishParams{ID: open.ID, Number: pgtype.Int4{Int32: n, Valid: true}, DecidedBy: me, DecisionNote: text(note)}); err != nil {
		return LandingState{}, ErrAlreadyDecided // otra persona la resolvió al mismo tiempo
	}
	if err := tx.Commit(b); err != nil {
		return LandingState{}, err
	}
	s.recLanding(ctx, a, "platform.landing_published", map[string]any{"number": n, "self_approval": self})
	return s.Landing(ctx)
}

// LandingVersions lista las versiones publicadas (la vigente y las anteriores), de la más reciente a la más antigua.
func (s *Service) LandingVersions(ctx context.Context) ([]LandingVersionRow, error) {
	rows, err := s.q.LandingListVersions(tenant.Bypass(ctx))
	if err != nil {
		return nil, err
	}
	out := make([]LandingVersionRow, 0, len(rows))
	for _, r := range rows {
		n := 0
		if r.Number.Valid {
			n = int(r.Number.Int32)
		}
		out = append(out, LandingVersionRow{Number: n, Status: r.Status, Reason: r.Reason, RequestedBy: r.RequesterEmail, RequestedAt: tptr(r.RequestedAt),
			DecidedBy: r.DeciderEmail, DecidedAt: tptr(r.DecidedAt), DecisionNote: r.DecisionNote, PublishedAt: tptr(r.PublishedAt)})
	}
	return out, nil
}

// LandingVersionByNumber devuelve una versión publicada con su contenido.
func (s *Service) LandingVersionByNumber(ctx context.Context, n int) (LandingVersion, error) {
	v, err := s.findLanding(ctx, db.LandingFindParams{ByNumber: int32(n)})
	if err != nil {
		return LandingVersion{}, err
	}
	if v == nil {
		return LandingVersion{}, ErrNotFound
	}
	return *v, nil
}

// RestoreLanding crea un borrador con el contenido de una versión anterior (no reescribe la historia: publicarlo también pide
// aprobación). Reemplaza el borrador actual; no se puede con una publicación pendiente.
func (s *Service) RestoreLanding(ctx context.Context, a Actor, n int) (LandingVersion, error) {
	old, err := s.LandingVersionByNumber(ctx, n)
	if err != nil {
		return LandingVersion{}, err
	}
	open, err := s.openLanding(ctx)
	if err != nil {
		return LandingVersion{}, err
	}
	if open != nil && open.Status == "pending" {
		return LandingVersion{}, ErrLandingPending
	}
	raw, err := json.Marshal(old.Content)
	if err != nil {
		return LandingVersion{}, err
	}
	b := tenant.Bypass(ctx)
	tx, err := s.pool.Begin(b)
	if err != nil {
		return LandingVersion{}, err
	}
	defer func() { _ = tx.Rollback(b) }()
	q := s.q.WithTx(tx)
	if _, err := q.LandingDeleteDraft(b); err != nil {
		return LandingVersion{}, err
	}
	if _, err := q.LandingInsertDraft(b, db.LandingInsertDraftParams{Content: raw, BaseNumber: pgtype.Int4{Int32: int32(n), Valid: true}, CreatedBy: uuid.NullUUID{UUID: a.ID, Valid: true}}); err != nil {
		return LandingVersion{}, err
	}
	if err := tx.Commit(b); err != nil {
		return LandingVersion{}, err
	}
	s.recLanding(ctx, a, "platform.landing_restored", map[string]any{"number": n})
	v, err := s.openLanding(ctx)
	if err != nil || v == nil {
		return LandingVersion{}, errors.Join(err, ErrNoDraft)
	}
	return *v, nil
}
