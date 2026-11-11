// Package audit registra eventos internos append-only (MVP_SPEC §17.1).
// Nunca debe recibir contraseñas, tokens ni datos clínicos innecesarios.
package audit

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"

	"github.com/nutri/app-nutricional/backend/generated/db"
)

type Recorder struct {
	Q   db.Querier
	Log *slog.Logger
}

type Event struct {
	Actor        uuid.UUID
	Action       string
	ResourceType string
	ResourceID   uuid.UUID
	RequestID    string
	Metadata     map[string]any
}

// Record escribe el evento; un fallo de auditoría se registra pero no rompe la operación ya confirmada.
func (r Recorder) Record(ctx context.Context, e Event) {
	meta := []byte("{}")
	if e.Metadata != nil {
		meta, _ = json.Marshal(e.Metadata)
	}
	rid := uuid.NullUUID{UUID: e.ResourceID, Valid: e.ResourceID != uuid.Nil}
	if err := r.Q.InsertAuditLog(ctx, db.InsertAuditLogParams{
		ActorUserID: uuid.NullUUID{UUID: e.Actor, Valid: e.Actor != uuid.Nil},
		Action:      e.Action, ResourceType: e.ResourceType, ResourceID: rid, RequestID: e.RequestID, Metadata: meta,
	}); err != nil {
		r.Log.ErrorContext(ctx, "audit_failed", slog.String("action", e.Action), slog.Any("error", err))
	}
}
