// Package config carga la configuración desde variables de entorno.
package config

import (
	"errors"
	"net/url"
	"time"

	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	Env      string `envconfig:"APP_ENV" default:"development"`
	HTTPAddr string `envconfig:"HTTP_ADDR" default:":8080"`
	// Conexión del propietario de la base: aplica migraciones y la usa la CLI de administración.
	DatabaseURL string `envconfig:"DATABASE_URL" required:"true"`
	// Conexión con la que corre la API: rol `nutri_app` (sin superusuario ni BYPASSRLS) para que el aislamiento por consulta
	// se cumpla. Vacía = usa DATABASE_URL (solo desarrollo; en producción la API se niega a arrancar así).
	AppDatabaseURL string `envconfig:"APP_DATABASE_URL"`
	// Alternativa más simple: si se define, la API se conecta con el mismo servidor pero como el rol `nutri_app` con esta
	// contraseña (que el propio arranque le asigna tras migrar). Es lo que usa el despliegue.
	AppDBPassword string `envconfig:"APP_DB_PASSWORD"`
	Timezone      string `envconfig:"APP_TIMEZONE" default:"America/Mexico_City"`
	// Aplica migraciones al arrancar (cómodo en desarrollo; en producción conviene hacerlo de forma controlada, §24.1).
	AutoMigrate bool `envconfig:"AUTO_MIGRATE" default:"false"`
	// URL pública del frontend; se usa para armar enlaces de recuperación.
	AppBaseURL string `envconfig:"APP_BASE_URL" default:"http://localhost:4200"`

	// Orígenes permitidos para el frontend (cookies con credenciales).
	CORSAllowedOrigins []string `envconfig:"CORS_ALLOWED_ORIGINS" default:"http://localhost:4200"`

	JWTSecret         string        `envconfig:"JWT_SECRET" required:"true"`
	AccessTokenTTL    time.Duration `envconfig:"ACCESS_TOKEN_TTL" default:"15m"`
	RefreshTokenTTL   time.Duration `envconfig:"REFRESH_TOKEN_TTL" default:"720h"`
	PasswordResetTTL  time.Duration `envconfig:"PASSWORD_RESET_TTL" default:"30m"`
	CookieSecure      bool          `envconfig:"COOKIE_SECURE" default:"true"`
	MaxUploadBytes    int64         `envconfig:"MAX_UPLOAD_BYTES" default:"10485760"`
	S3Endpoint        string        `envconfig:"S3_ENDPOINT"`
	S3Region          string        `envconfig:"S3_REGION" default:"us-east-1"`
	S3AccessKeyID     string        `envconfig:"S3_ACCESS_KEY_ID"`
	S3SecretAccessKey string        `envconfig:"S3_SECRET_ACCESS_KEY"`
	S3PublicBucket    string        `envconfig:"S3_PUBLIC_BUCKET" default:"nutri-public"`
	S3PrivateBucket   string        `envconfig:"S3_PRIVATE_BUCKET" default:"nutri-private"`
	// Correo transaccional (invitaciones y recuperación). Sin SMTP_HOST los enlaces solo se escriben en el registro.
	SMTPHost     string `envconfig:"SMTP_HOST"`
	SMTPPort     int    `envconfig:"SMTP_PORT" default:"587"`
	SMTPUsername string `envconfig:"SMTP_USERNAME"`
	SMTPPassword string `envconfig:"SMTP_PASSWORD"`
	SMTPFrom     string `envconfig:"SMTP_FROM"`
	SMTPFromName string `envconfig:"SMTP_FROM_NAME" default:"Nutrición"`

	// Registro abierto de nutriólogas (plan gratuito). Apagado por omisión: se activa por ambiente.
	SignupEnabled bool `envconfig:"SIGNUP_ENABLED" default:"false"`
	// Exige confirmar el correo antes de activar la cuenta. Solo puede apagarse en desarrollo o en staging (ambiente con
	// cuentas de ejemplo), para probar el registro cuando el correo aún no entrega a cualquier destinatario.
	SignupRequireEmailVerification bool `envconfig:"SIGNUP_REQUIRE_EMAIL_VERIFICATION" default:"true"`
	// ID de cliente de Google (público) para «Continuar con Google». Sin él, el botón no existe.
	GoogleClientID string `envconfig:"GOOGLE_CLIENT_ID"`
	// Verificación anti robots del registro (Cloudflare Turnstile). La clave del sitio es pública; el secreto no. Sin secreto no
	// hay verificación (desarrollo y staging); en producción con registro abierto son obligatorios.
	TurnstileSiteKey string `envconfig:"TURNSTILE_SITE_KEY"`
	TurnstileSecret  string `envconfig:"TURNSTILE_SECRET"`
	// SMAEEnabled enciende el catálogo SMAE oficial. Apagado (por omisión) no se sirve ningún alimento del catálogo: las
	// cuentas trabajan con «Mis alimentos». Lo ya usado en platillos y planes se conserva y reaparece al encenderlo.
	SMAEEnabled bool `envconfig:"SMAE_ENABLED" default:"false"`
	// Cobro de suscripciones. Vacío = sin cobro en línea (la pantalla solo registra el interés). «sim» es una pasarela
	// SIMULADA para probar el ciclo completo: no cobra nada y por eso solo se permite fuera de producción real.
	PaymentsProvider  string `envconfig:"PAYMENTS_PROVIDER"`
	PaymentsSimSecret string `envconfig:"PAYMENTS_SIM_SECRET"`
	// AllowDemoAccounts marca un ambiente de pruebas (staging): nunca se activa en producción real.
	AllowDemoAccounts bool `envconfig:"ALLOW_DEMO_ACCOUNTS" default:"false"`

	SignedURLTTL time.Duration `envconfig:"SIGNED_URL_TTL" default:"5m"`

	// Pool de conexiones a PostgreSQL. Un tope explícito evita agotar max_connections del servidor.
	DBMaxConns          int32         `envconfig:"DB_MAX_CONNS" default:"20"`
	DBMinConns          int32         `envconfig:"DB_MIN_CONNS" default:"2"`
	DBMaxConnLifetime   time.Duration `envconfig:"DB_MAX_CONN_LIFETIME" default:"30m"`
	DBMaxConnIdleTime   time.Duration `envconfig:"DB_MAX_CONN_IDLE_TIME" default:"5m"`
	DBHealthCheckPeriod time.Duration `envconfig:"DB_HEALTH_CHECK_PERIOD" default:"1m"`

	// Tiempos de espera del servidor HTTP (el de escritura cubre exportaciones y PDF).
	HTTPReadTimeout  time.Duration `envconfig:"HTTP_READ_TIMEOUT" default:"30s"`
	HTTPWriteTimeout time.Duration `envconfig:"HTTP_WRITE_TIMEOUT" default:"90s"`
	HTTPIdleTimeout  time.Duration `envconfig:"HTTP_IDLE_TIMEOUT" default:"120s"`

	// Cada cuánto se finalizan en segundo plano los planes cuyo periodo terminó.
	PlanFinalizeInterval time.Duration `envconfig:"PLAN_FINALIZE_INTERVAL" default:"5m"`

	// Trazas OpenTelemetry (OTLP/HTTP). Sin endpoint quedan desactivadas y no cuestan nada.
	OTLPEndpoint string `envconfig:"OTEL_EXPORTER_OTLP_ENDPOINT"`
	ServiceName  string `envconfig:"OTEL_SERVICE_NAME" default:"nutri-api"`
	// Peticiones más lentas que esto se registran como advertencia (0 = desactivado).
	SlowRequestThreshold time.Duration `envconfig:"SLOW_REQUEST_THRESHOLD" default:"1s"`
}

func Load() (Config, error) {
	var c Config
	if err := envconfig.Process("", &c); err != nil {
		return c, err
	}
	return c, c.Validate()
}

func (c Config) IsProduction() bool { return c.Env == "production" }

// ErrSignupUnverified: en producción no se permite abrir cuentas sin confirmar el correo.
var ErrSignupUnverified = errors.New("SIGNUP_REQUIRE_EMAIL_VERIFICATION=false solo se permite en desarrollo o en un ambiente de pruebas (ALLOW_DEMO_ACCOUNTS=true)")

// ErrSignupNoCaptcha: el registro abierto en producción exige verificación anti robots.
var ErrSignupNoCaptcha = errors.New("SIGNUP_ENABLED en producción requiere TURNSTILE_SITE_KEY y TURNSTILE_SECRET")

// ErrPaymentsProvider: configuración de cobro no válida.
var ErrPaymentsProvider = errors.New("PAYMENTS_PROVIDER no válido: use «sim» (solo desarrollo o staging) o déjelo vacío; «sim» exige PAYMENTS_SIM_SECRET")

// Validate revisa combinaciones inseguras de configuración.
func (c Config) Validate() error {
	switch c.PaymentsProvider {
	case "":
	case "sim":
		// Una pasarela simulada en producción real dejaría «pagar» sin pagar.
		if (c.IsProduction() && !c.AllowDemoAccounts) || c.PaymentsSimSecret == "" {
			return ErrPaymentsProvider
		}
	default:
		return ErrPaymentsProvider
	}
	if c.IsProduction() && !c.AllowDemoAccounts && c.SignupEnabled && (c.TurnstileSiteKey == "" || c.TurnstileSecret == "") {
		return ErrSignupNoCaptcha
	}
	if c.IsProduction() && !c.AllowDemoAccounts && c.SignupEnabled && !c.SignupRequireEmailVerification {
		return ErrSignupUnverified
	}
	return nil
}

// RuntimeDatabaseURL es la conexión con la que corre la API.
func (c Config) RuntimeDatabaseURL() string {
	if c.AppDatabaseURL != "" {
		return c.AppDatabaseURL
	}
	if c.AppDBPassword != "" {
		if u, err := url.Parse(c.DatabaseURL); err == nil {
			u.User = url.UserPassword(AppDBRole, c.AppDBPassword)
			return u.String()
		}
	}
	return c.DatabaseURL
}

// AppDBRole es el rol de base de datos con el que corre la API (creado por la migración de cuentas aisladas).
const AppDBRole = "nutri_app"
