package platform

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

// Equipo propio del CRM. Son personas distintas de las nutriólogas: viven en la «consulta de plataforma» (sin pacientes ni plan),
// no tienen el rol de nutrióloga y por eso no ven ningún dato clínico; solo tienen los permisos de su rol de plataforma.
//
// Roles (migración 000021):
//   - platform_owner:   todo (cuentas, aprobar, equipo, landing).
//   - platform_support: ve cuentas y opera (suspender, pedir cortesías o reembolsos), sin aprobar.
//   - platform_viewer:  solo lectura.
//   - platform_content: edita la landing y pide publicarla; no ve cuentas.
//   - platform_admin:   rol heredado de antes de los roles finos; equivale a dueño y se puede reasignar.

const (
	RoleOwner   = "platform_owner"
	RoleSupport = "platform_support"
	RoleViewer  = "platform_viewer"
	RoleContent = "platform_content"
	RoleLegacy  = "platform_admin"

	staffPracticeName = "Equipo de la plataforma"
)

// StaffRoles son los roles que se pueden asignar (el heredado solo se conserva o se reemplaza).
var StaffRoles = []string{RoleOwner, RoleSupport, RoleViewer, RoleContent}

var (
	ErrLastOwner = errors.New("debe quedar al menos una persona activa con control total de la plataforma")
	ErrSelfStaff = errors.New("no puedes cambiar tu propio acceso: pídeselo a otra persona del equipo")
	ErrNoAuth    = errors.New("la administración del equipo no está disponible en este ambiente")
)

type StaffRow struct {
	ID          uuid.UUID  `json:"id"`
	Email       string     `json:"email"`
	Name        string     `json:"name"`
	Status      string     `json:"status"` // active | invited | disabled
	Role        string     `json:"role"`
	LastLoginAt *time.Time `json:"last_login_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

// StaffInvite es el resultado de invitar: el enlace solo se entrega si NO salió por correo (quien invita lo comparte a mano).
type StaffInvite struct {
	Staff   StaffRow `json:"staff"`
	Link    string   `json:"link,omitempty"`
	Emailed bool     `json:"emailed"`
}

func (s *Service) SetAuth(a *auth.Service) { s.auth = a }

func validStaffRole(r string) bool {
	for _, v := range StaffRoles {
		if v == r {
			return true
		}
	}
	return false
}

func staffRow(r db.PlatformListStaffRow) StaffRow {
	role := ""
	for _, c := range r.Roles {
		switch {
		case c == RoleOwner:
			role = c
		case role == "":
			role = c
		}
	}
	row := StaffRow{ID: r.ID, Email: r.Email, Name: r.DisplayName, Status: r.Status, Role: role, CreatedAt: r.CreatedAt.Time}
	if r.LastLoginAt.Valid {
		t := r.LastLoginAt.Time
		row.LastLoginAt = &t
	}
	return row
}

func controlTotal(role string) bool { return role == RoleOwner || role == RoleLegacy }

// Staff lista al equipo (todas las personas con algún rol de plataforma).
func (s *Service) Staff(ctx context.Context) ([]StaffRow, error) {
	rows, err := s.q.PlatformListStaff(tenant.Bypass(ctx))
	if err != nil {
		return nil, err
	}
	out := make([]StaffRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, staffRow(r))
	}
	return out, nil
}

func (s *Service) staffByID(ctx context.Context, id uuid.UUID) (StaffRow, error) {
	all, err := s.Staff(ctx)
	if err != nil {
		return StaffRow{}, err
	}
	for _, r := range all {
		if r.ID == id {
			return r, nil
		}
	}
	return StaffRow{}, ErrNotFound
}

// staffPractice devuelve la consulta de plataforma, creándola la primera vez.
func (s *Service) staffPractice(ctx context.Context) (uuid.UUID, error) {
	b := tenant.Bypass(ctx)
	id, err := s.q.PlatformStaffPractice(b)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	id, err = s.q.CreatePractice(b, staffPracticeName)
	if err != nil {
		return uuid.Nil, err
	}
	if err := s.q.PlatformMarkPracticePlatform(b, id); err != nil {
		// Otra solicitud la marcó al mismo tiempo (índice único): se usa esa y esta queda sin marcar.
		if again, e2 := s.q.PlatformStaffPractice(b); e2 == nil {
			return again, nil
		}
		return uuid.Nil, err
	}
	return id, nil
}

// InviteStaff da de alta a una persona del equipo y le manda el enlace para crear su contraseña (7 días).
func (s *Service) InviteStaff(ctx context.Context, a Actor, email, name, role string) (StaffInvite, error) {
	if s.auth == nil {
		return StaffInvite{}, ErrNoAuth
	}
	if !validStaffRole(role) {
		return StaffInvite{}, fmt.Errorf("%w: elige un rol válido", ErrInvalid)
	}
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 80 {
		return StaffInvite{}, fmt.Errorf("%w: escribe el nombre (hasta 80 caracteres)", ErrInvalid)
	}
	pid, err := s.staffPractice(ctx)
	if err != nil {
		return StaffInvite{}, err
	}
	pctx := tenant.With(ctx, pid)
	uid, err := s.auth.CreateInvitedUser(pctx, email, name, role)
	if err != nil {
		return StaffInvite{}, err
	}
	inv, err := s.auth.Invite(pctx, uid)
	if err != nil {
		return StaffInvite{}, err
	}
	s.rec(ctx, pid, a, "platform.staff_invited", map[string]any{"email": strings.ToLower(strings.TrimSpace(email)), "role": role})
	row, err := s.staffByID(ctx, uid)
	if err != nil {
		return StaffInvite{}, err
	}
	out := StaffInvite{Staff: row, Emailed: inv.Emailed}
	if !inv.Emailed {
		out.Link = inv.Link
	}
	return out, nil
}

// CreateStaff da de alta a una persona del equipo con contraseña ya definida y activa de inmediato. Es para la CLI (el primer
// dueño de un ambiente, cuando aún nadie puede invitar); el resto del equipo se invita desde el panel.
func (s *Service) CreateStaff(ctx context.Context, a Actor, email, name, role, password string) (uuid.UUID, error) {
	if s.auth == nil {
		return uuid.Nil, ErrNoAuth
	}
	if !validStaffRole(role) {
		return uuid.Nil, fmt.Errorf("%w: rol inválido (usa %s)", ErrInvalid, strings.Join(StaffRoles, ", "))
	}
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 80 {
		return uuid.Nil, fmt.Errorf("%w: escribe el nombre (hasta 80 caracteres)", ErrInvalid)
	}
	pid, err := s.staffPractice(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	uid, err := s.auth.CreateActiveUserChecked(tenant.With(ctx, pid), email, name, role, password)
	if err != nil {
		return uuid.Nil, err
	}
	s.rec(ctx, pid, a, "platform.staff_created", map[string]any{"email": strings.ToLower(strings.TrimSpace(email)), "role": role, "via": "cli"})
	return uid, nil
}

// ResendStaffInvite emite un enlace nuevo (el anterior deja de servir) para quien aún no creó su contraseña.
func (s *Service) ResendStaffInvite(ctx context.Context, a Actor, id uuid.UUID) (StaffInvite, error) {
	if s.auth == nil {
		return StaffInvite{}, ErrNoAuth
	}
	row, err := s.staffByID(ctx, id)
	if err != nil {
		return StaffInvite{}, err
	}
	if row.Status != "invited" {
		return StaffInvite{}, fmt.Errorf("%w: esa persona ya creó su contraseña", ErrInvalid)
	}
	pid, err := s.staffPractice(ctx)
	if err != nil {
		return StaffInvite{}, err
	}
	inv, err := s.auth.Invite(tenant.With(ctx, pid), id)
	if err != nil {
		return StaffInvite{}, err
	}
	s.rec(ctx, pid, a, "platform.staff_invite_resent", map[string]any{"email": row.Email})
	out := StaffInvite{Staff: row, Emailed: inv.Emailed}
	if !inv.Emailed {
		out.Link = inv.Link
	}
	return out, nil
}

// guardOwners impide dejar la plataforma sin ninguna persona activa con control total.
func (s *Service) guardOwners(ctx context.Context, target StaffRow) error {
	if !controlTotal(target.Role) || target.Status != "active" {
		return nil
	}
	n, err := s.q.PlatformCountActiveOwners(tenant.Bypass(ctx))
	if err != nil {
		return err
	}
	if n <= 1 {
		return ErrLastOwner
	}
	return nil
}

// SetStaffRole cambia el rol de una persona del equipo (reemplaza cualquier rol de plataforma; no toca otros roles).
func (s *Service) SetStaffRole(ctx context.Context, a Actor, id uuid.UUID, role string) (StaffRow, error) {
	if !validStaffRole(role) {
		return StaffRow{}, fmt.Errorf("%w: elige un rol válido", ErrInvalid)
	}
	if id == a.ID {
		return StaffRow{}, ErrSelfStaff
	}
	target, err := s.staffByID(ctx, id)
	if err != nil {
		return StaffRow{}, err
	}
	if target.Role == role {
		return target, nil
	}
	if role != RoleOwner {
		if err := s.guardOwners(ctx, target); err != nil {
			return StaffRow{}, err
		}
	}
	b := tenant.Bypass(ctx)
	tx, err := s.pool.Begin(b)
	if err != nil {
		return StaffRow{}, err
	}
	defer func() { _ = tx.Rollback(b) }()
	q := s.q.WithTx(tx)
	if err := q.PlatformRemoveStaffRoles(b, id); err != nil {
		return StaffRow{}, err
	}
	if err := q.AssignRoleByCode(b, db.AssignRoleByCodeParams{UserID: id, Code: role}); err != nil {
		return StaffRow{}, err
	}
	if err := tx.Commit(b); err != nil {
		return StaffRow{}, err
	}
	pid, _ := s.staffPractice(ctx)
	s.rec(ctx, pid, a, "platform.staff_role_changed", map[string]any{"email": target.Email, "from": target.Role, "to": role})
	return s.staffByID(ctx, id)
}

// SetStaffEnabled deshabilita (cierra sus sesiones; no borra nada) o vuelve a habilitar a una persona del equipo.
func (s *Service) SetStaffEnabled(ctx context.Context, a Actor, id uuid.UUID, enabled bool) (StaffRow, error) {
	if s.auth == nil {
		return StaffRow{}, ErrNoAuth
	}
	if id == a.ID {
		return StaffRow{}, ErrSelfStaff
	}
	target, err := s.staffByID(ctx, id)
	if err != nil {
		return StaffRow{}, err
	}
	pid, _ := s.staffPractice(ctx)
	if enabled {
		if target.Status == "disabled" {
			status := "invited" // nunca entró: sigue pendiente de crear su contraseña
			if target.LastLoginAt != nil {
				status = "active"
			}
			if err := s.q.SetUserStatus(tenant.Bypass(ctx), db.SetUserStatusParams{ID: id, Status: status}); err != nil {
				return StaffRow{}, err
			}
			s.rec(ctx, pid, a, "platform.staff_enabled", map[string]any{"email": target.Email})
		}
		return s.staffByID(ctx, id)
	}
	if target.Status != "disabled" {
		if err := s.guardOwners(ctx, target); err != nil {
			return StaffRow{}, err
		}
		if err := s.auth.DisableAccount(tenant.Bypass(ctx), id, auth.Meta{}); err != nil {
			return StaffRow{}, err
		}
		s.rec(ctx, pid, a, "platform.staff_disabled", map[string]any{"email": target.Email})
	}
	return s.staffByID(ctx, id)
}
