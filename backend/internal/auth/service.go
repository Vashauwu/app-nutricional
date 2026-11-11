package auth

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/config"
)

var (
	ErrInvalidCredentials = errors.New("correo o contraseña incorrectos")
	ErrRateLimited        = errors.New("demasiados intentos; inténtalo más tarde")
	ErrSessionInvalid     = errors.New("sesión inválida o vencida")
	ErrBadResetToken      = errors.New("el enlace no es válido o ya expiró")
	ErrBadEmail           = errors.New("correo electrónico inválido")
	ErrNotFound           = errors.New("no encontrado")
)

// refreshGrace tolera dos refrescos casi simultáneos (varias pestañas) sin
// tratarlos como robo del token.
const refreshGrace = 10 * time.Second

// Meta describe el contexto de la petición para sesiones y auditoría.
type Meta struct {
	IP        string
	UserAgent string
	RequestID string
}

type Identity struct {
	UserID      uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	Name        string    `json:"name"`
	Role        string    `json:"role"`
	Permissions []string  `json:"permissions"`
	SessionID   uuid.UUID `json:"-"`
}

type Tokens struct {
	Identity   Identity
	Access     string
	AccessExp  time.Time
	Refresh    string
	RefreshExp time.Time
}

type Service struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	cfg     config.Config
	Tokens  *TokenManager
	limiter *Limiter
	mailer  Mailer
	log     *slog.Logger
	now     func() time.Time
}

func NewService(pool *pgxpool.Pool, cfg config.Config, mailer Mailer, log *slog.Logger) *Service {
	return &Service{
		pool: pool, q: db.New(pool), cfg: cfg, Tokens: NewTokenManager(cfg.JWTSecret, cfg.AccessTokenTTL),
		limiter: NewLimiter(5, 15*time.Minute), mailer: mailer, log: log, now: time.Now,
	}
}

func normalizeEmail(e string) (string, error) {
	e = strings.ToLower(strings.TrimSpace(e))
	if _, err := mail.ParseAddress(e); err != nil || len(e) > 254 {
		return "", ErrBadEmail
	}
	return e, nil
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func nu(id uuid.UUID) uuid.NullUUID { return uuid.NullUUID{UUID: id, Valid: true} }

func (s *Service) audit(ctx context.Context, actor uuid.NullUUID, action, resType string, resID uuid.NullUUID, m Meta, meta map[string]any) {
	b := []byte("{}")
	if meta != nil {
		b, _ = json.Marshal(meta) // nunca incluir secretos ni tokens
	}
	if err := s.q.InsertAuditLog(ctx, db.InsertAuditLogParams{
		ActorUserID: actor, Action: action, ResourceType: resType, ResourceID: resID, RequestID: m.RequestID, Metadata: b,
	}); err != nil {
		s.log.ErrorContext(ctx, "audit_failed", slog.String("action", action), slog.Any("error", err))
	}
}

func (s *Service) identity(ctx context.Context, u db.User, sid uuid.UUID) (Identity, error) {
	roles, err := s.q.ListRoleCodesForUser(ctx, u.ID)
	if err != nil {
		return Identity{}, err
	}
	perms, err := s.q.ListPermissionCodesForUser(ctx, u.ID)
	if err != nil {
		return Identity{}, err
	}
	role := ""
	if len(roles) > 0 {
		role = roles[0]
	}
	return Identity{UserID: u.ID, Email: u.Email, Name: u.DisplayName, Role: role, Permissions: perms, SessionID: sid}, nil
}

func (s *Service) issue(ctx context.Context, u db.User, sid uuid.UUID, refresh string, refreshExp time.Time) (*Tokens, error) {
	id, err := s.identity(ctx, u, sid)
	if err != nil {
		return nil, err
	}
	access, exp, err := s.Tokens.IssueAccess(u.ID, sid, id.Role)
	if err != nil {
		return nil, err
	}
	return &Tokens{Identity: id, Access: access, AccessExp: exp, Refresh: refresh, RefreshExp: refreshExp}, nil
}

// Login valida credenciales. Los mensajes de error son genéricos y el tiempo de
// respuesta no distingue cuentas inexistentes.
func (s *Service) Login(ctx context.Context, email, password string, m Meta) (*Tokens, error) {
	e, err := normalizeEmail(email)
	if err != nil {
		return nil, ErrInvalidCredentials
	}
	key := m.IP + "|" + e
	if !s.limiter.Allowed(key) {
		s.audit(ctx, uuid.NullUUID{}, "auth.login_blocked", "user", uuid.NullUUID{}, m, nil)
		return nil, ErrRateLimited
	}
	u, err := s.q.GetUserByEmail(ctx, e)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		VerifyPassword(password, dummyHash)
		s.limiter.Fail(key)
		s.audit(ctx, uuid.NullUUID{}, "auth.login_failed", "user", uuid.NullUUID{}, m, nil)
		return nil, ErrInvalidCredentials
	}
	if u.Status != "active" || !VerifyPassword(password, u.PasswordHash) {
		s.limiter.Fail(key)
		s.audit(ctx, nu(u.ID), "auth.login_failed", "user", nu(u.ID), m, nil)
		return nil, ErrInvalidCredentials
	}
	s.limiter.Reset(key)

	raw, hash, err := NewOpaqueToken()
	if err != nil {
		return nil, err
	}
	exp := s.now().Add(s.cfg.RefreshTokenTTL)
	sess, err := s.q.CreateSession(ctx, db.CreateSessionParams{
		UserID: u.ID, RefreshTokenHash: hash, DeviceLabel: deviceLabel(m.UserAgent), UserAgent: truncate(m.UserAgent, 300), Ip: m.IP, ExpiresAt: ts(exp),
	})
	if err != nil {
		return nil, err
	}
	_ = s.q.TouchUserLogin(ctx, u.ID)
	s.audit(ctx, nu(u.ID), "auth.login", "session", nu(sess.ID), m, nil)
	return s.issue(ctx, u, sess.ID, raw, exp)
}

// Refresh rota el refresh token. Presentar uno ya rotado (fuera de la ventana de
// gracia) revoca la sesión completa: indica que el token pudo ser robado.
func (s *Service) Refresh(ctx context.Context, raw string, m Meta) (*Tokens, error) {
	if raw == "" {
		return nil, ErrSessionInvalid
	}
	h := HashToken(raw)
	sess, err := s.q.GetSessionByRefreshHash(ctx, h)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionInvalid
		}
		return nil, err
	}
	now := s.now()
	if sess.RevokedAt.Valid || !sess.ExpiresAt.Time.After(now) {
		return nil, ErrSessionInvalid
	}
	if string(sess.RefreshTokenHash) != string(h) { // coincide con el hash anterior
		if now.Sub(sess.LastSeenAt.Time) <= refreshGrace {
			return nil, ErrSessionInvalid
		}
		_ = s.q.RevokeSessionByID(ctx, sess.ID)
		s.audit(ctx, nu(sess.UserID), "auth.refresh_reuse", "session", nu(sess.ID), m, nil)
		return nil, ErrSessionInvalid
	}
	u, err := s.q.GetUserByID(ctx, sess.UserID)
	if err != nil || u.Status != "active" {
		return nil, ErrSessionInvalid
	}
	newRaw, newHash, err := NewOpaqueToken()
	if err != nil {
		return nil, err
	}
	exp := now.Add(s.cfg.RefreshTokenTTL)
	if err := s.q.RotateSessionToken(ctx, db.RotateSessionTokenParams{ID: sess.ID, RefreshTokenHash: newHash, ExpiresAt: ts(exp)}); err != nil {
		return nil, err
	}
	return s.issue(ctx, u, sess.ID, newRaw, exp)
}

// Authenticate valida el access token y que su sesión siga vigente, de modo que
// cerrar una sesión surta efecto de inmediato.
func (s *Service) Authenticate(ctx context.Context, access string) (*Identity, error) {
	claims, err := s.Tokens.ParseAccess(access)
	if err != nil {
		return nil, ErrSessionInvalid
	}
	sess, err := s.q.GetSessionByID(ctx, claims.SessionID)
	if err != nil || sess.RevokedAt.Valid || !sess.ExpiresAt.Time.After(s.now()) {
		return nil, ErrSessionInvalid
	}
	u, err := s.q.GetUserByID(ctx, sess.UserID)
	if err != nil || u.Status != "active" {
		return nil, ErrSessionInvalid
	}
	id, err := s.identity(ctx, u, sess.ID)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// LogoutByRefresh revoca la sesión a la que pertenece el refresh token (idempotente).
func (s *Service) LogoutByRefresh(ctx context.Context, raw string, m Meta) {
	if raw == "" {
		return
	}
	sess, err := s.q.GetSessionByRefreshHash(ctx, HashToken(raw))
	if err != nil {
		return
	}
	_ = s.q.RevokeSessionByID(ctx, sess.ID)
	s.audit(ctx, nu(sess.UserID), "auth.logout", "session", nu(sess.ID), m, nil)
}

func (s *Service) ListSessions(ctx context.Context, userID uuid.UUID) ([]db.UserSession, error) {
	return s.q.ListActiveSessions(ctx, userID)
}

// RevokeSession solo revoca sesiones del propio usuario.
func (s *Service) RevokeSession(ctx context.Context, userID, sessionID uuid.UUID, m Meta) error {
	sess, err := s.q.GetSessionByID(ctx, sessionID)
	if err != nil || sess.UserID != userID {
		return ErrNotFound
	}
	if err := s.q.RevokeSession(ctx, db.RevokeSessionParams{ID: sessionID, UserID: userID}); err != nil {
		return err
	}
	s.audit(ctx, nu(userID), "auth.session_revoked", "session", nu(sessionID), m, nil)
	return nil
}

func (s *Service) RevokeOthers(ctx context.Context, userID, current uuid.UUID, m Meta) (int64, error) {
	n, err := s.q.RevokeOtherSessions(ctx, db.RevokeOtherSessionsParams{UserID: userID, ID: current})
	if err == nil {
		s.audit(ctx, nu(userID), "auth.sessions_revoked_others", "session", uuid.NullUUID{}, m, map[string]any{"count": n})
	}
	return n, err
}

// RequestPasswordReset responde igual exista o no la cuenta (§5.2).
func (s *Service) RequestPasswordReset(ctx context.Context, email string, m Meta) error {
	e, err := normalizeEmail(email)
	if err != nil {
		return nil
	}
	u, err := s.q.GetUserByEmail(ctx, e)
	if err != nil || u.Status != "active" {
		return nil
	}
	raw, hash, err := NewOpaqueToken()
	if err != nil {
		return err
	}
	_ = s.q.InvalidateUserResetTokens(ctx, u.ID) // solo el último enlace es válido
	if err := s.q.CreateResetToken(ctx, db.CreateResetTokenParams{UserID: u.ID, TokenHash: hash, ExpiresAt: ts(s.now().Add(s.cfg.PasswordResetTTL))}); err != nil {
		return err
	}
	s.audit(ctx, nu(u.ID), "auth.password_reset_requested", "user", nu(u.ID), m, nil)
	link := strings.TrimRight(s.cfg.AppBaseURL, "/") + "/restablecer/" + raw
	return s.mailer.SendPasswordReset(ctx, u.Email, link)
}

// ResetPassword consume el token (un solo uso), cambia la contraseña y cierra todas las sesiones.
func (s *Service) ResetPassword(ctx context.Context, raw, newPassword string, m Meta) error {
	if err := ValidatePassword(newPassword); err != nil {
		return err
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	uid, err := q.ConsumeResetToken(ctx, HashToken(raw))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrBadResetToken
		}
		return err
	}
	if err := q.UpdateUserPassword(ctx, db.UpdateUserPasswordParams{ID: uid, PasswordHash: hash}); err != nil {
		return err
	}
	if err := q.RevokeAllUserSessions(ctx, uid); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.audit(ctx, nu(uid), "auth.password_reset", "user", nu(uid), m, nil)
	if u, err := s.q.GetUserByID(ctx, uid); err == nil {
		_ = s.mailer.SendPasswordChanged(ctx, u.Email)
	}
	return nil
}

// SendInvitation emite un enlace de un solo uso para que la persona invitada cree su
// contraseña (reutiliza el mecanismo de recuperación; al usarlo la cuenta pasa a activa).
func (s *Service) SendInvitation(ctx context.Context, userID uuid.UUID) error {
	_, err := s.Invite(ctx, userID)
	return err
}

// Invitation es el resultado de invitar: el enlace de un solo uso y si realmente salió por correo.
type Invitation struct {
	Link    string
	Emailed bool
}

// Invite emite el enlace (válido 7 días), lo envía por correo y lo devuelve. Quien llama decide si lo muestra:
// solo debe verlo la nutrióloga y únicamente cuando no hay correo configurado (Emailed == false).
func (s *Service) Invite(ctx context.Context, userID uuid.UUID) (Invitation, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return Invitation{}, err
	}
	raw, hash, err := NewOpaqueToken()
	if err != nil {
		return Invitation{}, err
	}
	_ = s.q.InvalidateUserResetTokens(ctx, u.ID)
	// Las invitaciones duran más que una recuperación: 7 días.
	if err := s.q.CreateResetToken(ctx, db.CreateResetTokenParams{UserID: u.ID, TokenHash: hash, ExpiresAt: ts(s.now().Add(7 * 24 * time.Hour))}); err != nil {
		return Invitation{}, err
	}
	link := strings.TrimRight(s.cfg.AppBaseURL, "/") + "/restablecer/" + raw
	if err := s.mailer.SendInvitation(ctx, u.Email, link); err != nil {
		return Invitation{}, err
	}
	emailed := false
	if d, ok := s.mailer.(interface{ Delivers() bool }); ok {
		emailed = d.Delivers()
	}
	return Invitation{Link: link, Emailed: emailed}, nil
}

// CreateUser crea una cuenta con rol; lo usa la CLI de administración.
func (s *Service) CreateUser(ctx context.Context, email, name, role, password string) (uuid.UUID, error) {
	e, err := normalizeEmail(email)
	if err != nil {
		return uuid.Nil, err
	}
	if err := ValidatePassword(password); err != nil {
		return uuid.Nil, err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return uuid.Nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	u, err := q.CreateUser(ctx, db.CreateUserParams{Email: e, PasswordHash: hash, Status: "active", DisplayName: name})
	if err != nil {
		return uuid.Nil, err
	}
	if err := q.AssignRoleByCode(ctx, db.AssignRoleByCodeParams{UserID: u.ID, Code: role}); err != nil {
		return uuid.Nil, err
	}
	return u.ID, tx.Commit(ctx)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func deviceLabel(ua string) string {
	os := "Dispositivo"
	switch {
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"):
		os = "iPhone / iPad"
	case strings.Contains(ua, "Android"):
		os = "Android"
	case strings.Contains(ua, "Windows"):
		os = "Windows"
	case strings.Contains(ua, "Mac OS"):
		os = "Mac"
	case strings.Contains(ua, "Linux"):
		os = "Linux"
	}
	br := "Navegador"
	switch {
	case strings.Contains(ua, "Edg/"):
		br = "Edge"
	case strings.Contains(ua, "Firefox/"):
		br = "Firefox"
	case strings.Contains(ua, "Chrome/"):
		br = "Chrome"
	case strings.Contains(ua, "Safari/"):
		br = "Safari"
	}
	return os + " · " + br
}
