package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

// CreateActiveUserChecked da de alta a una persona con contraseña y activa de inmediato (la CLI del equipo), rechazando con
// ErrEmailInUse un correo que ya existe en cualquier consulta en lugar de dejar pasar el error de la base de datos.
func (s *Service) CreateActiveUserChecked(ctx context.Context, email, name, role, password string) (uuid.UUID, error) {
	e, err := normalizeEmail(email)
	if err != nil {
		return uuid.Nil, err
	}
	if _, err := s.q.GetUserByEmail(tenant.Bypass(ctx), e); err == nil {
		return uuid.Nil, ErrEmailInUse
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	return s.createUser(ctx, e, name, role, password, "active")
}

// CreateInvitedUser da de alta a una persona SIN contraseña conocida: queda «invited» (no puede iniciar sesión) hasta que use el
// enlace de invitación (Invite) para crear la suya. Lo usa el equipo del CRM; la consulta a la que pertenece va en el contexto
// (tenant.With). Un correo que ya existe en cualquier consulta se rechaza con ErrEmailInUse.
func (s *Service) CreateInvitedUser(ctx context.Context, email, name, role string) (uuid.UUID, error) {
	e, err := normalizeEmail(email)
	if err != nil {
		return uuid.Nil, err
	}
	if _, err := s.q.GetUserByEmail(tenant.Bypass(ctx), e); err == nil {
		return uuid.Nil, ErrEmailInUse
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return uuid.Nil, err
	}
	// Aleatoria y desconocida para todos; el sufijo garantiza letra y dígito para pasar la política.
	return s.createUser(ctx, e, name, role, base64.RawURLEncoding.EncodeToString(b)+"a1", "invited")
}
