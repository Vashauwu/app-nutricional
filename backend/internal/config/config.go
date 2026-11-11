// Package config carga la configuración desde variables de entorno.
package config

import (
	"time"

	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	Env         string `envconfig:"APP_ENV" default:"development"`
	HTTPAddr    string `envconfig:"HTTP_ADDR" default:":8080"`
	DatabaseURL string `envconfig:"DATABASE_URL" required:"true"`
	Timezone    string `envconfig:"APP_TIMEZONE" default:"America/Mexico_City"`
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

	SignedURLTTL time.Duration `envconfig:"SIGNED_URL_TTL" default:"5m"`
}

func Load() (Config, error) {
	var c Config
	err := envconfig.Process("", &c)
	return c, err
}

func (c Config) IsProduction() bool { return c.Env == "production" }
