package auth

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
)

var (
	ErrSignupClosed  = errors.New("el registro no está disponible por ahora")
	ErrTermsRequired = errors.New("debes aceptar los términos de uso y el aviso de privacidad")
	ErrEmailInUse    = errors.New("ese correo ya tiene una cuenta")
	ErrSignupLimited = errors.New("demasiados intentos con este correo")
)

// TermsVersion identifica el texto de términos y aviso de privacidad que aceptó la persona (se guarda en la bitácora).
// Cambiarlo al publicar textos nuevos.
const TermsVersion = "2026-11-borrador"

// SignupValidation agrupa errores por campo del registro.
type SignupValidation map[string]string

func (v SignupValidation) Error() string { return "datos de registro no válidos" }

const verificationTTL = 24 * time.Hour

type SignupInput struct {
	Name        string
	Email       string
	Password    string
	AcceptTerms bool
	// CaptchaToken lo produce el widget de la pantalla; RemoteIP se manda al verificador.
	CaptchaToken string
	RemoteIP     string
}

// SignupOptions dice a la pantalla si hay registro y si exige confirmar el correo.
type SignupOptions struct {
	Enabled             bool `json:"enabled"`
	RequireVerification bool `json:"require_verification"`
	// GoogleClientID (público) activa el botón «Continuar con Google»; vacío = no hay botón.
	GoogleClientID string `json:"google_client_id,omitempty"`
	// CaptchaSiteKey (pública) activa la verificación anti robots en el formulario; vacío = sin verificación.
	CaptchaSiteKey string `json:"captcha_site_key,omitempty"`
	// SMAEEnabled: el catálogo SMAE oficial está encendido en esta plataforma.
	SMAEEnabled bool `json:"smae_enabled"`
}

func (s *Service) SignupOptions() SignupOptions {
	o := SignupOptions{Enabled: s.cfg.SignupEnabled, RequireVerification: s.cfg.SignupRequireEmailVerification}
	if s.google != nil {
		o.GoogleClientID = s.cfg.GoogleClientID
	}
	if s.captcha != nil {
		o.CaptchaSiteKey = s.cfg.TurnstileSiteKey
	}
	o.SMAEEnabled = s.cfg.SMAEEnabled
	return o
}

// SetCaptcha activa la verificación anti robots del registro (nil = sin verificación).
func (s *Service) SetCaptcha(v CaptchaVerifier) { s.captcha = v }

// Signup abre una consulta nueva con plan gratuito. Con verificación de correo la cuenta queda pendiente hasta confirmar
// el enlace y la respuesta es la misma exista o no el correo (no revela quién tiene cuenta). Sin verificación (solo fuera
// de producción) la cuenta nace activa y un correo repetido se informa.
func (s *Service) Signup(ctx context.Context, in SignupInput, m Meta) (verified bool, err error) {
	if !s.cfg.SignupEnabled {
		return false, ErrSignupClosed
	}
	if s.captcha != nil {
		if err := s.captcha.Verify(ctx, in.CaptchaToken, in.RemoteIP); err != nil {
			if errors.Is(err, ErrCaptcha) {
				return false, SignupValidation{"captcha": "Confirma que no eres un robot e inténtalo de nuevo."}
			}
			return false, err
		}
	}
	bad := SignupValidation{}
	name := strings.TrimSpace(in.Name)
	if n := utf8.RuneCountInString(name); n < 2 || n > 120 {
		bad["name"] = "Escribe tu nombre (2 a 120 caracteres)."
	}
	e, mailErr := normalizeEmail(in.Email)
	if mailErr != nil {
		bad["email"] = "Escribe un correo válido."
	} else if IsDisposableEmail(e) {
		bad["email"] = "Usa un correo permanente: los correos temporales no están permitidos."
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
	// Por correo, además del límite por IP de la ruta: evita bombardear una bandeja con enlaces o probar muchas contraseñas.
	if ok, _ := s.signupByEmail.Allow(e); !ok {
		return false, ErrSignupLimited
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
	s.audit(ctx, nu(u.ID), "auth.signup", "user", nu(u.ID), m, map[string]any{"verification": verify, "terms_accepted": true, "terms_version": TermsVersion})
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

// SetGoogleVerifier activa «Continuar con Google» (y lo reemplaza en las pruebas).
func (s *Service) SetGoogleVerifier(v IDTokenVerifier) { s.google = v }

// GoogleSignIn ingresa con una cuenta de Google. Si la cuenta de la plataforma existe (y es de nutrióloga) abre sesión;
// si no, y el registro está abierto y la persona aceptó los términos, abre una consulta nueva con plan gratuito. Google ya
// verificó el correo, así que no hay confirmación aparte (también activa una cuenta que seguía pendiente de confirmar).
func (s *Service) GoogleSignIn(ctx context.Context, credential string, acceptTerms bool, m Meta) (*Tokens, bool, error) {
	if s.google == nil {
		return nil, false, ErrGoogleDisabled
	}
	claims, err := s.google.Verify(ctx, credential)
	if err != nil {
		s.audit(ctx, uuid.NullUUID{}, "auth.google_failed", "user", uuid.NullUUID{}, m, nil)
		return nil, false, ErrGoogleToken
	}
	e, err := normalizeEmail(claims.Email)
	if err != nil {
		return nil, false, ErrGoogleToken
	}
	created := false
	u, err := s.q.GetUserByEmail(ctx, e)
	switch {
	case err == nil:
		roles, err := s.q.ListRoleCodesForUser(ctx, u.ID)
		if err != nil {
			return nil, false, err
		}
		if u.Status == "disabled" || !contains(roles, "nutritionist") {
			s.audit(tenant.With(ctx, u.PracticeID), nu(u.ID), "auth.google_failed", "user", nu(u.ID), m, nil)
			return nil, false, ErrGoogleNotAllowed
		}
		ctx = tenant.With(ctx, u.PracticeID)
		if u.Status == "invited" { // registro por correo sin confirmar: Google ya probó que el correo es de la persona
			if err := s.q.ActivateUser(ctx, u.ID); err != nil {
				return nil, false, err
			}
			u.Status = "active"
		}
	case errors.Is(err, pgx.ErrNoRows):
		if !s.cfg.SignupEnabled {
			return nil, false, ErrSignupClosed
		}
		if !acceptTerms {
			return nil, false, ErrTermsRequired
		}
		name := strings.TrimSpace(claims.Name)
		if name == "" {
			name = e
		}
		// Contraseña aleatoria e inutilizable: la cuenta entra por Google o, si lo desea, por «Olvidé mi contraseña».
		raw, _, err := NewOpaqueToken()
		if err != nil {
			return nil, false, err
		}
		id, err := s.createUser(ctx, e, truncate(name, 120), "nutritionist", "Gg1"+raw, "active")
		if err != nil {
			return nil, false, err
		}
		if u, err = s.q.GetUserByID(ctx, id); err != nil {
			return nil, false, err
		}
		ctx = tenant.With(ctx, u.PracticeID)
		created = true
		s.audit(ctx, nu(u.ID), "auth.signup", "user", nu(u.ID), m, map[string]any{"method": "google", "terms_accepted": true})
	default:
		return nil, false, err
	}
	t, err := s.startSession(ctx, u, m)
	return t, created, err
}
