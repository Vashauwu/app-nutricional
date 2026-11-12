// Package agenda administra las consultas (citas) de la nutrióloga: alta, reprogramación, estados, vista del paciente
// y el enlace secreto de suscripción (.ics) para calendarios externos (Google Calendar, Apple, Outlook).
package agenda

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
)

var (
	ErrNotFound = errors.New("no encontrado")
	ErrOverlap  = errors.New("ya hay otra consulta en ese horario")
)

// ValidationError mapea campo → mensaje.
type ValidationError map[string]string

func (v ValidationError) Error() string { return "datos inválidos" }

type Actor struct {
	ID        uuid.UUID
	RequestID string
}

type Service struct {
	pool  *pgxpool.Pool
	q     *db.Queries
	audit audit.Recorder
	log   *slog.Logger
	now   func() time.Time
}

func NewService(pool *pgxpool.Pool, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{pool: pool, q: q, audit: audit.Recorder{Q: q, Log: log}, log: log, now: time.Now}
}

type Input struct {
	PatientID uuid.UUID
	StartsAt  time.Time
	EndsAt    time.Time
	Kind      string
	Mode      string
	Place     string
	Notes     string
	Status    string
}

// View es la consulta tal como la ve la nutrióloga.
type View struct {
	ID          uuid.UUID `json:"id"`
	PatientID   uuid.UUID `json:"patient_id"`
	PatientName string    `json:"patient_name"`
	StartsAt    time.Time `json:"starts_at"`
	EndsAt      time.Time `json:"ends_at"`
	Kind        string    `json:"kind"`
	Mode        string    `json:"mode"`
	Place       string    `json:"place"`
	Notes       string    `json:"notes"`
	Status      string    `json:"status"`
}

// PatientView es lo que ve el paciente: sin notas internas.
type PatientView struct {
	ID       uuid.UUID `json:"id"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Kind     string    `json:"kind"`
	Mode     string    `json:"mode"`
	Place    string    `json:"place"`
	Status   string    `json:"status"`
}

func (s *Service) rec(ctx context.Context, a Actor, action string, id uuid.UUID, meta map[string]any) {
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: action, ResourceType: "appointment", ResourceID: id, RequestID: a.RequestID, Metadata: meta})
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func (in *Input) validate(now time.Time) ValidationError {
	errs := ValidationError{}
	in.Place = strings.TrimSpace(in.Place)
	in.Notes = strings.TrimSpace(in.Notes)
	if in.Kind == "" {
		in.Kind = "follow_up"
	}
	if in.Mode == "" {
		in.Mode = "in_person"
	}
	if in.Status == "" {
		in.Status = "scheduled"
	}
	if !oneOf(in.Kind, "first", "follow_up", "other") {
		errs["kind"] = "valor no permitido"
	}
	if !oneOf(in.Mode, "in_person", "online") {
		errs["mode"] = "valor no permitido"
	}
	if !oneOf(in.Status, "scheduled", "completed", "cancelled", "no_show") {
		errs["status"] = "valor no permitido"
	}
	if len(in.Place) > 300 {
		errs["place"] = "es demasiado largo"
	}
	if len(in.Notes) > 2000 {
		errs["notes"] = "es demasiado largo"
	}
	switch d := in.EndsAt.Sub(in.StartsAt); {
	case in.StartsAt.IsZero() || in.EndsAt.IsZero():
		errs["starts_at"] = "indica la fecha y hora"
	case d < 5*time.Minute:
		errs["ends_at"] = "la consulta debe durar al menos 5 minutos"
	case d > 8*time.Hour:
		errs["ends_at"] = "la consulta no puede durar más de 8 horas"
	case in.StartsAt.After(now.AddDate(2, 0, 0)):
		errs["starts_at"] = "la fecha está demasiado lejos"
	}
	return errs
}

func oneOf(v string, allowed ...string) bool {
	for _, a := range allowed {
		if v == a {
			return true
		}
	}
	return false
}

// checkFree rechaza una consulta programada que se empalma con otra programada.
func (s *Service) checkFree(ctx context.Context, q *db.Queries, in Input, except uuid.UUID) error {
	if in.Status != "scheduled" {
		return nil
	}
	n, err := q.CountAppointmentOverlap(ctx, db.CountAppointmentOverlapParams{StartsAt: ts(in.StartsAt), EndsAt: ts(in.EndsAt), ExceptID: except})
	if err != nil {
		return err
	}
	if n > 0 {
		return ErrOverlap
	}
	return nil
}

func (s *Service) patientName(ctx context.Context, id uuid.UUID) (string, error) {
	p, err := s.q.GetPatient(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ValidationError{"patient_id": "paciente no encontrado"}
		}
		return "", err
	}
	if p.DeletedAt.Valid {
		return "", ValidationError{"patient_id": "el paciente está desactivado"}
	}
	return strings.TrimSpace(p.FirstName + " " + p.LastName), nil
}

func (s *Service) Create(ctx context.Context, a Actor, in Input) (View, error) {
	if errs := in.validate(s.now()); len(errs) > 0 {
		return View{}, errs
	}
	name, err := s.patientName(ctx, in.PatientID)
	if err != nil {
		return View{}, err
	}
	// La verificación y el alta van en una transacción serializable para que dos altas simultáneas no se empalmen.
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return View{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if err := s.checkFree(ctx, q, in, uuid.Nil); err != nil {
		return View{}, err
	}
	row, err := q.InsertAppointment(ctx, db.InsertAppointmentParams{PatientID: in.PatientID, StartsAt: ts(in.StartsAt), EndsAt: ts(in.EndsAt),
		Kind: in.Kind, Mode: in.Mode, Place: in.Place, Notes: in.Notes, Status: in.Status, CreatedBy: a.ID})
	if err != nil {
		return View{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return View{}, err
	}
	s.rec(ctx, a, "appointment.create", row.ID, map[string]any{"patient_id": row.PatientID})
	return view(row, name), nil
}

func (s *Service) Update(ctx context.Context, a Actor, id uuid.UUID, in Input) (View, error) {
	if errs := in.validate(s.now()); len(errs) > 0 {
		return View{}, errs
	}
	cur, err := s.q.GetAppointment(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return View{}, ErrNotFound
		}
		return View{}, err
	}
	name, err := s.patientName(ctx, cur.PatientID)
	if err != nil {
		// Un paciente desactivado conserva su historial; solo se bloquea reprogramar.
		var ve ValidationError
		if !errors.As(err, &ve) || in.Status == "scheduled" {
			return View{}, err
		}
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return View{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if err := s.checkFree(ctx, q, in, id); err != nil {
		return View{}, err
	}
	row, err := q.UpdateAppointment(ctx, db.UpdateAppointmentParams{ID: id, StartsAt: ts(in.StartsAt), EndsAt: ts(in.EndsAt),
		Kind: in.Kind, Mode: in.Mode, Place: in.Place, Notes: in.Notes, Status: in.Status})
	if err != nil {
		return View{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return View{}, err
	}
	s.rec(ctx, a, "appointment.update", id, map[string]any{"status": row.Status})
	return view(row, name), nil
}

func view(r db.Appointment, name string) View {
	return View{ID: r.ID, PatientID: r.PatientID, PatientName: name, StartsAt: r.StartsAt.Time, EndsAt: r.EndsAt.Time, Kind: r.Kind, Mode: r.Mode,
		Place: r.Place, Notes: r.Notes, Status: r.Status}
}

// Range lista las consultas que empiezan en [from, to).
func (s *Service) Range(ctx context.Context, from, to time.Time) ([]View, error) {
	if !to.After(from) || to.Sub(from) > 400*24*time.Hour {
		return nil, ValidationError{"to": "el rango debe ser positivo y de máximo 400 días"}
	}
	rows, err := s.q.ListAppointmentsRange(ctx, db.ListAppointmentsRangeParams{FromAt: ts(from), ToAt: ts(to)})
	if err != nil {
		return nil, err
	}
	out := make([]View, 0, len(rows))
	for _, r := range rows {
		out = append(out, View{ID: r.ID, PatientID: r.PatientID, PatientName: strings.TrimSpace(r.PatientFirstName + " " + r.PatientLastName),
			StartsAt: r.StartsAt.Time, EndsAt: r.EndsAt.Time, Kind: r.Kind, Mode: r.Mode, Place: r.Place, Notes: r.Notes, Status: r.Status})
	}
	return out, nil
}

// ForPatient devuelve las consultas vigentes y las recientes del paciente (nunca las canceladas ni las notas internas).
func (s *Service) ForPatient(ctx context.Context, patient uuid.UUID) ([]PatientView, error) {
	rows, err := s.q.ListPatientAppointments(ctx, db.ListPatientAppointmentsParams{PatientID: patient, EndsAt: ts(s.now().AddDate(0, 0, -30))})
	if err != nil {
		return nil, err
	}
	out := make([]PatientView, 0, len(rows))
	for _, r := range rows {
		out = append(out, PatientView{ID: r.ID, StartsAt: r.StartsAt.Time, EndsAt: r.EndsAt.Time, Kind: r.Kind, Mode: r.Mode, Place: r.Place, Status: r.Status})
	}
	return out, nil
}

// ---------- Enlace de suscripción (.ics) ----------
func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// FeedToken devuelve el token de la persona, creándolo la primera vez.
func (s *Service) FeedToken(ctx context.Context, user uuid.UUID) (string, error) {
	f, err := s.q.GetCalendarFeed(ctx, user)
	if err == nil {
		return f.Token, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	return s.RotateFeed(ctx, Actor{ID: user}, false)
}

// RotateFeed genera un token nuevo: el enlace anterior deja de funcionar.
func (s *Service) RotateFeed(ctx context.Context, a Actor, audited bool) (string, error) {
	tok, err := newToken()
	if err != nil {
		return "", err
	}
	if _, err := s.q.UpsertCalendarFeed(ctx, db.UpsertCalendarFeedParams{UserID: a.ID, Token: tok}); err != nil {
		return "", err
	}
	if audited {
		s.rec(ctx, a, "calendar.feed_rotated", a.ID, nil)
	}
	return tok, nil
}

// Feed arma el calendario .ics para un token; ErrNotFound si no existe.
func (s *Service) Feed(ctx context.Context, token string) ([]byte, error) {
	if len(token) != 64 {
		return nil, ErrNotFound
	}
	if _, err := s.q.FeedByToken(ctx, token); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	now := s.now()
	list, err := s.Range(ctx, now.AddDate(0, 0, -60), now.AddDate(0, 0, 330))
	if err != nil {
		return nil, err
	}
	return buildICS(list, now), nil
}
