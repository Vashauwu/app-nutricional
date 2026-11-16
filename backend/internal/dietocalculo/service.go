package dietocalculo

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
)

var ErrNotFound = errors.New("no encontrado")

type Actor struct {
	ID        uuid.UUID
	RequestID string
}

type Service struct {
	q     *db.Queries
	audit audit.Recorder
	log   *slog.Logger
}

func NewService(pool *pgxpool.Pool, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{q: q, audit: audit.Recorder{Q: q, Log: log}, log: log}
}

// Summary es una fila del listado.
type Summary struct {
	ID          uuid.UUID  `json:"id"`
	Name        string     `json:"name"`
	PatientID   *uuid.UUID `json:"patient_id"`
	PatientName string     `json:"patient_name"`
	Kcal        int        `json:"kcal"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// Detail incluye las entradas y el resultado guardados.
type Detail struct {
	Summary
	Inputs        Inputs    `json:"inputs"`
	Result        Result    `json:"result"`
	EngineVersion string    `json:"engine_version"`
	CreatedAt     time.Time `json:"created_at"`
}

type SaveInput struct {
	Name      string
	PatientID *uuid.UUID
	Inputs    Inputs
}

func (s *Service) validate(ctx context.Context, in *SaveInput) FieldErrors {
	errs := FieldErrors{}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len([]rune(in.Name)) > 120 {
		errs["name"] = "escribe un nombre de hasta 120 caracteres"
	}
	for k, v := range in.Inputs.Normalize() {
		errs[k] = v
	}
	if in.PatientID != nil {
		if _, err := s.q.GetPatientName(ctx, *in.PatientID); err != nil {
			errs["patient_id"] = "el paciente no existe"
		}
	}
	if len(errs) == 0 {
		return nil
	}
	return errs
}

func nullUUID(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *id, Valid: true}
}

func (s *Service) Create(ctx context.Context, a Actor, in SaveInput) (Detail, error) {
	if e := s.validate(ctx, &in); e != nil {
		return Detail{}, e
	}
	res := Compute(in.Inputs)
	inJSON, _ := json.Marshal(in.Inputs)
	resJSON, _ := json.Marshal(res)
	row, err := s.q.InsertDietCalculation(ctx, db.InsertDietCalculationParams{
		Name: in.Name, PatientID: nullUUID(in.PatientID), Inputs: inJSON, Result: resJSON, EngineVersion: EngineVersion,
		Kcal: int32(res.Energy.Prescription), CreatedBy: a.ID})
	if err != nil {
		return Detail{}, err
	}
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: "diet_calculation.create", ResourceType: "diet_calculation", ResourceID: row.ID, RequestID: a.RequestID,
		Metadata: map[string]any{"linked": in.PatientID != nil}})
	return s.Get(ctx, row.ID)
}

func (s *Service) Update(ctx context.Context, a Actor, id uuid.UUID, in SaveInput) (Detail, error) {
	if e := s.validate(ctx, &in); e != nil {
		return Detail{}, e
	}
	res := Compute(in.Inputs)
	inJSON, _ := json.Marshal(in.Inputs)
	resJSON, _ := json.Marshal(res)
	_, err := s.q.UpdateDietCalculation(ctx, db.UpdateDietCalculationParams{ID: id, Name: in.Name, PatientID: nullUUID(in.PatientID),
		Inputs: inJSON, Result: resJSON, EngineVersion: EngineVersion, Kcal: int32(res.Energy.Prescription)})
	if errors.Is(err, pgx.ErrNoRows) {
		return Detail{}, ErrNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: "diet_calculation.update", ResourceType: "diet_calculation", ResourceID: id, RequestID: a.RequestID,
		Metadata: map[string]any{"linked": in.PatientID != nil}})
	return s.Get(ctx, id)
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Detail, error) {
	r, err := s.q.GetDietCalculation(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Detail{}, ErrNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	d := Detail{Summary: Summary{ID: r.ID, Name: r.Name, PatientName: r.PatientName, Kcal: int(r.Kcal), UpdatedAt: r.UpdatedAt.Time},
		EngineVersion: r.EngineVersion, CreatedAt: r.CreatedAt.Time}
	if r.PatientID.Valid {
		p := r.PatientID.UUID
		d.PatientID = &p
	}
	if err := json.Unmarshal(r.Inputs, &d.Inputs); err != nil {
		return Detail{}, err
	}
	if err := json.Unmarshal(r.Result, &d.Result); err != nil {
		return Detail{}, err
	}
	return d, nil
}

type ListFilter struct {
	PatientID    *uuid.UUID
	OnlyUnlinked bool
	Q            string
	Limit        int32
}

func (s *Service) List(ctx context.Context, f ListFilter) ([]Summary, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 100
	}
	rows, err := s.q.ListDietCalculations(ctx, db.ListDietCalculationsParams{PatientID: nullUUID(f.PatientID), OnlyUnlinked: f.OnlyUnlinked, Q: strings.TrimSpace(f.Q), RowLimit: f.Limit})
	if err != nil {
		return nil, err
	}
	out := make([]Summary, 0, len(rows))
	for _, r := range rows {
		x := Summary{ID: r.ID, Name: r.Name, PatientName: r.PatientName, Kcal: int(r.Kcal), UpdatedAt: r.UpdatedAt.Time}
		if r.PatientID.Valid {
			p := r.PatientID.UUID
			x.PatientID = &p
		}
		out = append(out, x)
	}
	return out, nil
}

func (s *Service) Delete(ctx context.Context, a Actor, id uuid.UUID) error {
	n, err := s.q.SoftDeleteDietCalculation(ctx, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: "diet_calculation.delete", ResourceType: "diet_calculation", ResourceID: id, RequestID: a.RequestID})
	return nil
}
