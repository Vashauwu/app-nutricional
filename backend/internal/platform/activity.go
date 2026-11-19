package platform

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

// ActivityCategories son las únicas familias de eventos que la bitácora global muestra: accesos, cobros y operación de la
// plataforma. Los eventos clínicos (pacientes, planes, expedientes) nunca se listan aquí: quien opera la plataforma no necesita
// verlos para operar cuentas y no deben mezclarse.
var ActivityCategories = []string{"auth", "billing", "platform"}

type ActivityQuery struct {
	Search   string
	Category string // vacío = todas las permitidas
	Practice uuid.UUID
	Since    time.Time // inclusivo; cero = sin límite inferior (se acota a 1 año)
	Until    time.Time // exclusivo; cero = ahora
	Limit    int
	Offset   int
}

type ActivityRow struct {
	ID           uuid.UUID      `json:"id"`
	Action       string         `json:"action"`
	At           time.Time      `json:"occurred_at"`
	Actor        string         `json:"actor"`
	PracticeID   *uuid.UUID     `json:"practice_id,omitempty"`
	PracticeName string         `json:"practice_name,omitempty"`
	Meta         map[string]any `json:"metadata"`
}

type ActivityPage struct {
	Items  []ActivityRow `json:"items"`
	Total  int64         `json:"total"`
	Limit  int           `json:"limit"`
	Offset int           `json:"offset"`
}

func allowedCategory(c string) bool {
	for _, a := range ActivityCategories {
		if a == c {
			return true
		}
	}
	return false
}

// Activity lista la bitácora de todas las consultas, filtrable por categoría, consulta, texto y fechas.
func (s *Service) Activity(ctx context.Context, q ActivityQuery) (ActivityPage, error) {
	if q.Limit < 1 || q.Limit > 100 {
		q.Limit = 25
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	if q.Category != "" && !allowedCategory(q.Category) {
		return ActivityPage{}, ErrInvalid
	}
	now := s.now()
	if q.Until.IsZero() {
		q.Until = now.Add(time.Minute)
	}
	if q.Since.IsZero() || q.Since.Before(now.AddDate(-1, 0, 0)) {
		q.Since = now.AddDate(-1, 0, 0)
	}
	rows, err := s.q.PlatformListActivity(tenant.Bypass(ctx), db.PlatformListActivityParams{Categories: ActivityCategories, Category: q.Category, Practice: q.Practice, Search: escapeLike(q.Search), Since: tstz(q.Since), Until: tstz(q.Until), PageLimit: int32(q.Limit), PageOffset: int32(q.Offset)})
	if err != nil {
		return ActivityPage{}, err
	}
	out := ActivityPage{Items: []ActivityRow{}, Limit: q.Limit, Offset: q.Offset}
	for _, r := range rows {
		out.Total = r.Total
		var meta map[string]any
		_ = json.Unmarshal(r.Metadata, &meta)
		row := ActivityRow{ID: r.ID, Action: r.Action, At: r.OccurredAt.Time, Actor: r.ActorEmail, PracticeName: r.PracticeName, Meta: meta}
		if r.PracticeID.Valid {
			id := r.PracticeID.UUID
			row.PracticeID = &id
		}
		out.Items = append(out.Items, row)
	}
	return out, nil
}

func tstz(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
