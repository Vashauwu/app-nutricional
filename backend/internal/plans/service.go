package plans

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/generated/db"
)

// Service resuelve el plan de la consulta del contexto (tenant.With) y valida sus límites.
type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool, q: db.New(pool)} }

type Usage struct {
	ActivePatients int   `json:"active_patients"`
	StorageBytes   int64 `json:"storage_bytes"`
}

type Summary struct {
	Plan          Plan   `json:"plan"`
	BillingPeriod string `json:"billing_period"`
	Status        string `json:"status"`
	Usage         Usage  `json:"usage"`
	Catalog       []Plan `json:"catalog"`
	PaymentsReady bool   `json:"payments_ready"`
}

// Current devuelve el plan vigente de la consulta del contexto.
func (s *Service) Current(ctx context.Context) (Plan, db.Subscription, error) {
	sub, err := s.q.GetSubscription(ctx)
	if err != nil {
		return Plan{}, db.Subscription{}, err
	}
	p, err := ByCode(sub.Plan)
	return p, sub, err
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
	p, sub, err := s.Current(ctx)
	if err != nil {
		return Summary{}, err
	}
	u, err := s.Usage(ctx)
	if err != nil {
		return Summary{}, err
	}
	return Summary{Plan: p, BillingPeriod: sub.BillingPeriod.String, Status: sub.Status, Usage: u, Catalog: Catalog}, nil
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

// SetPlan cambia el plan de la consulta del contexto (operación de plataforma: CLI de administración y, más adelante, el cobro).
func (s *Service) SetPlan(ctx context.Context, code, period string) error {
	if _, err := ByCode(code); err != nil {
		return err
	}
	return s.q.SetSubscriptionPlan(ctx, db.SetSubscriptionPlanParams{Plan: code, BillingPeriod: pgtype.Text{String: period, Valid: period != ""}})
}
