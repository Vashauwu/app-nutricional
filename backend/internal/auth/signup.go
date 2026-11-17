package auth

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

var (
	ErrSignupClosed  = errors.New("el registro no está disponible por ahora")
	ErrTermsRequired = errors.New("debes aceptar los términos de uso y el aviso de privacidad")
	ErrEmailInUse    = errors.New("ese correo ya tiene una cuenta")
)

// SignupValidation agrupa errores por campo del registro.
type SignupValidation map[string]string

func (v SignupValidation) Error() string { return "datos de registro no válidos" }

const verificationTTL = 24 * time.Hour

type SignupInput struct {
	Name        string
	Email       string
	Password    string
	AcceptTerms bool
}

// SignupOptions dice a la pantalla si hay registro y si exige confirmar el correo.
type SignupOptions struct {
	Enabled             bool `json:"enabled"`
	RequireVerification bool `json:"require_verification"`
}

func (s *Service) SignupOptions() SignupOptions {
	return SignupOptions{Enabled: s.cfg.SignupEnabled, RequireVerification: s.cfg.SignupRequireEmailVerification}
}

// Signup abre una consulta nueva con plan gratuito. Con verificación de correo la cuenta queda pendiente hasta confirmar
// el enlace y la respuesta es la misma exista o no el correo (no revela quién tiene cuenta). Sin verificación (solo fuera
// de producción) la cuenta nace activa y un correo repetido se informa.
func (s *Service) Signup(ctx context.Context, in SignupInput, m Meta) (verified bool, err error) {
	if !s.cfg.SignupEnabled {
		return false, ErrSignupClosed
	}
	bad := SignupValidation{}
	name := strings.TrimSpace(in.Name)
	if n := utf8.RuneCountInString(name); n < 2 || n > 120 {
		bad["name"] = "Escribe tu nombre (2 a 120 caracteres)."
	}
	e, mailErr := normalizeEmail(in.Email)
	if mailErr != nil {
		bad["email"] = "Escribe un correo válido."
	}
	if err := ValidatePassword(in.Password); err != nil {
		bad["password"] = err.Error()
	}
	if !in.AcceptTerms {
		bad["accept_terms"] = ErrTermsRequired.Error() + "."
	}
	if len(bad) > 0 {
		return false, bad
	}

	verify := s.cfg.SignupRequireEmailVerification
	existing, err := s.q.GetUserByEmail(ctx, e)
	switch {
	case err == nil:
		if !verify {
			return false, ErrEmailInUse
		}
		// Cuenta ya registrada: solo se reenvía el enlace si sigue pendiente de confirmar (nada nuevo para quien ya tiene cuenta).
		if existing.Status == "invited" {
			if roles, _ := s.q.ListRoleCodesForUser(ctx, existing.ID); contains(roles, "nutritionist") {
				_ = s.sendVerification(tenant.With(ctx, existing.PracticeID), existing)
			}
		}
		return false, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return false, err
	}

	status := "active"
	if verify {
		status = "invited"
	}
	id, err := s.createUser(ctx, e, name, "nutritionist", in.Password, status)
	if err != nil {
		if strings.Contains(err.Error(), "users_email_key") { // carrera entre dos registros del mismo correo
			if !verify {
				return false, ErrEmailInUse
			}
			return false, nil
		}
		return false, err
	}
	u, err := s.q.GetUserByID(ctx, id)
	if err != nil {
		return false, err
	}
	ctx = tenant.With(ctx, u.PracticeID)
	s.audit(ctx, nu(u.ID), "auth.signup", "user", nu(u.ID), m, map[string]any{"verification": verify, "terms_accepted": true})
	if verify {
		return false, s.sendVerification(ctx, u)
	}
	return true, nil
}

func (s *Service) sendVerification(ctx context.Context, u db.User) error {
	raw, hash, err := NewOpaqueToken()
	if err != nil {
		return err
	}
	_ = s.q.InvalidateUserResetTokens(ctx, u.ID)
	if err := s.q.CreateResetToken(ctx, db.CreateResetTokenParams{UserID: u.ID, TokenHash: hash, ExpiresAt: ts(s.now().Add(verificationTTL))}); err != nil {
		return err
	}
	link := strings.TrimRight(s.cfg.AppBaseURL, "/") + "/verificar/" + raw
	return s.sendMail(ctx, "signup_verification", func(c context.Context) error { return s.mailer.SendVerification(c, u.Email, link) })
}

// VerifyEmail consume el enlace de confirmación (un solo uso) y activa la cuenta.
func (s *Service) VerifyEmail(ctx context.Context, raw string, m Meta) error {
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
	if err := q.ActivateUser(ctx, uid); err != nil {
		return err
	}
	owner, err := q.GetUserByID(ctx, uid)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.audit(tenant.With(ctx, owner.PracticeID), nu(uid), "auth.email_verified", "user", nu(uid), m, nil)
	return nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
