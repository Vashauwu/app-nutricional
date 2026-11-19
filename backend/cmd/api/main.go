package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	pgxdecimal "github.com/jackc/pgx-shopspring-decimal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/agenda"
	"github.com/nutri/app-nutricional/backend/internal/alerts"
	"github.com/nutri/app-nutricional/backend/internal/auditlog"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/clienterrors"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dashboard"
	"github.com/nutri/app-nutricional/backend/internal/dietocalculo"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/mealplans"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/migrate"
	"github.com/nutri/app-nutricional/backend/internal/nutrition_engine/calculator"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/payments"
	"github.com/nutri/app-nutricional/backend/internal/plans"
	"github.com/nutri/app-nutricional/backend/internal/platform"
	"github.com/nutri/app-nutricional/backend/internal/reports"
	"github.com/nutri/app-nutricional/backend/internal/settings"
	"github.com/nutri/app-nutricional/backend/internal/shared"
	"github.com/nutri/app-nutricional/backend/internal/smae"
	"github.com/nutri/app-nutricional/backend/internal/storage"
	"github.com/nutri/app-nutricional/backend/internal/telemetry"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
	"github.com/nutri/app-nutricional/backend/internal/tracking"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("fatal", slog.Any("error", err))
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	if cfg.AutoMigrate {
		if err := migrate.Up(cfg.DatabaseURL); err != nil {
			return err
		}
		logger.Info("migrations_applied")
		if cfg.AppDBPassword != "" {
			if err := tenant.EnsureAppRole(context.Background(), cfg.DatabaseURL, config.AppDBRole, cfg.AppDBPassword); err != nil {
				return fmt.Errorf("preparar el rol %s: %w", config.AppDBRole, err)
			}
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownTelemetry, tracing, err := telemetry.Setup(ctx, cfg.OTLPEndpoint, cfg.ServiceName, cfg.Env, logger)
	if err != nil {
		// Las trazas son opcionales: un colector mal configurado no debe tumbar la API.
		logger.Error("telemetry_unavailable", slog.Any("error", err))
	}
	defer func() {
		flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdownTelemetry(flushCtx)
	}()

	pool, err := newPool(ctx, cfg, tracing)
	if err != nil {
		return err
	}
	defer pool.Close()

	// El aislamiento entre consultas depende de que la API NO corra como superusuario ni con BYPASSRLS.
	if err := tenant.VerifyRole(ctx, pool); err != nil {
		if cfg.IsProduction() {
			return err
		}
		logger.Warn("rls_not_enforced", slog.Any("error", err))
	}

	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	router, plans, billing := newRouter(cfg, logger, pool, tracing)
	// Tareas lentas fuera de la petición: finalizar planes vencidos ya no depende de que alguien consulte.
	go runEvery(ctx, cfg.PlanFinalizeInterval, logger, "plans_finalize", forEachPractice(pool, plans.FinalizeExpired))
	if billing != nil {
		// Aviso por correo antes del primer cobro de las pruebas gratuitas.
		go runEvery(ctx, time.Hour, logger, "trial_notices", func(ctx context.Context) error { _, err := billing.NoticeDue(ctx); return err })
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       cfg.HTTPReadTimeout,
		WriteTimeout:      cfg.HTTPWriteTimeout,
		IdleTimeout:       cfg.HTTPIdleTimeout,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("api_listening", slog.String("addr", cfg.HTTPAddr), slog.String("env", cfg.Env))
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// forEachPractice adapta un trabajo de una consulta para correr, uno tras otro, en cada consulta activa: cada llamada
// queda limitada a su consulta por la seguridad por filas, así que un trabajo nunca mezcla datos de dos consultas.
func forEachPractice(pool *pgxpool.Pool, job func(context.Context) error) func(context.Context) error {
	q := db.New(pool)
	return func(ctx context.Context) error {
		ids, err := q.ListActivePracticeIDs(tenant.Bypass(ctx))
		if err != nil {
			return err
		}
		var firstErr error
		for _, id := range ids {
			if err := job(tenant.With(ctx, id)); err != nil && firstErr == nil {
				firstErr = fmt.Errorf("consulta %s: %w", id, err)
			}
		}
		return firstErr
	}
}

// runEvery ejecuta job al arrancar y luego cada interval hasta que ctx termine. Un fallo se registra y
// no detiene el ciclo: la tarea es idempotente y se reintenta en la siguiente vuelta.
func runEvery(ctx context.Context, interval time.Duration, logger *slog.Logger, name string, job func(context.Context) error) {
	if interval <= 0 {
		return
	}
	run := func() {
		jobCtx, cancel := context.WithTimeout(ctx, interval)
		defer cancel()
		if err := job(jobCtx); err != nil && ctx.Err() == nil {
			logger.Error("background_job_failed", slog.String("job", name), slog.Any("error", err))
		}
	}
	run()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}

// newPool registra el codec NUMERIC <-> shopspring/decimal en cada conexión,
// de modo que ningún valor nutricional pase por float (§7.3), y acota el pool de conexiones.
func newPool(ctx context.Context, cfg config.Config, tracing bool) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.RuntimeDatabaseURL())
	if err != nil {
		return nil, err
	}
	pcfg.MaxConns = cfg.DBMaxConns
	pcfg.MinConns = cfg.DBMinConns
	pcfg.MaxConnLifetime = cfg.DBMaxConnLifetime
	pcfg.MaxConnIdleTime = cfg.DBMaxConnIdleTime
	pcfg.HealthCheckPeriod = cfg.DBHealthCheckPeriod
	if tracing {
		// Un span por consulta SQL, sin los valores de los parámetros (pueden ser datos personales).
		pcfg.ConnConfig.Tracer = otelpgx.NewTracer(otelpgx.WithTrimSQLInSpanName())
	}
	tenant.ConfigurePool(pcfg) // cada conexión sale del pool con la consulta de quien la pide (seguridad por filas)
	pcfg.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		pgxdecimal.Register(conn.TypeMap())
		return nil
	}
	return pgxpool.NewWithConfig(ctx, pcfg)
}

func newRouter(cfg config.Config, logger *slog.Logger, pool *pgxpool.Pool, tracing bool) (*gin.Engine, *mealplans.Service, *payments.Service) {
	r := gin.New()
	// Solo se confía en X-Forwarded-For del proxy (Caddy) dentro de la red privada; si no, el límite de intentos se evade falseando la IP.
	_ = r.SetTrustedProxies([]string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.1"})
	r.Use(gin.Recovery(), middleware.RequestID())
	if tracing {
		r.Use(otelgin.Middleware(cfg.ServiceName))
	}
	r.Use(middleware.AccessLog(logger), middleware.SlowRequests(logger, cfg.SlowRequestThreshold))
	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CORSAllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE"},
		AllowHeaders:     []string{"Content-Type", "X-XSRF-TOKEN", "If-Match"},
		ExposeHeaders:    []string{middleware.RequestIDHeader, "ETag"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r.GET("/readyz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			shared.AbortWithError(c, http.StatusServiceUnavailable, "database_unavailable", "La base de datos no está disponible.")
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})

	v1 := r.Group("/api/v1")
	// Tope general por IP (§5): frena abuso y scripts sin estorbar el uso normal de la app.
	v1.Use(middleware.RateLimit(600, time.Minute))
	// Validación condicional (ETag/304) de las respuestas JSON de lectura.
	v1.Use(middleware.ETag())
	clienterrors.NewController(logger).Register(v1)
	v1.GET("/meta", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"api_version":      "v1",
			"engine_version":   calculator.EngineVersion,
			"division_scale":   calculator.DivisionScale,
			"rounding":         "half_even",
			"default_timezone": cfg.Timezone,
		})
	})
	var mailer auth.Mailer = auth.LogMailer{Log: logger, ExposeLinks: !cfg.IsProduction()}
	if cfg.SMTPHost != "" {
		sm, err := auth.NewSMTPMailer(auth.SMTPConfig{Host: cfg.SMTPHost, Port: cfg.SMTPPort, Username: cfg.SMTPUsername, Password: cfg.SMTPPassword,
			From: cfg.SMTPFrom, FromName: cfg.SMTPFromName}, logger)
		if err != nil {
			logger.Error("smtp_misconfigured", slog.Any("error", err))
		} else {
			mailer = sm
			logger.Info("mail_enabled", slog.String("host", cfg.SMTPHost))
		}
	} else {
		logger.Warn("mail_disabled", slog.String("reason", "SMTP_HOST no configurado: los enlaces solo se escriben en el registro"))
	}
	authSvc := auth.NewService(pool, cfg, mailer, logger)
	if cfg.GoogleClientID != "" {
		authSvc.SetGoogleVerifier(auth.NewGoogleVerifier(cfg.GoogleClientID))
		logger.Info("google_signin_enabled")
	}
	if cfg.TurnstileSecret != "" {
		authSvc.SetCaptcha(auth.NewTurnstileVerifier(cfg.TurnstileSecret))
		logger.Info("signup_captcha_enabled")
	}
	authSvc.SetAsyncMail(true)
	auth.NewController(authSvc, cfg).Register(v1)
	planSvc := plans.NewService(pool)
	planSvc.SetSMAE(cfg.SMAEEnabled)
	plans.NewController(planSvc, authSvc, logger).Register(v1)
	var billingSvc *payments.Service
	if cfg.PaymentsProvider == "sim" {
		planSvc.SetPaymentsReady(true)
		billingSvc = payments.NewService(pool, planSvc, payments.NewSimProvider(cfg.PaymentsSimSecret), logger)
		payments.NewController(billingSvc, authSvc, logger).Register(v1)
		logger.Warn("payments_simulated", slog.String("reason", "PAYMENTS_PROVIDER=sim: pasarela simulada, no cobra nada"))
		if tm, ok := mailer.(interface {
			SendTrialEnding(ctx context.Context, to, link, planName string, endsAt time.Time) error
		}); ok {
			billingSvc.SetNotifier(trialMailer{m: tm, link: cfg.AppBaseURL + "/facturacion"})
		}
	}
	platformSvc := platform.NewService(pool, planSvc, billingSvc, logger)
	platformSvc.AllowSelfApproval(cfg.PlatformAllowSelfApproval)
	platformSvc.SetAuth(authSvc)
	platform.NewController(platformSvc, authSvc, logger).Register(v1)
	patientsSvc := patients.NewService(pool, authSvc, logger)
	patientsSvc.SetLimits(planSvc)
	patients.NewController(patientsSvc, authSvc, logger).Register(v1)
	smaeSvc := smae.NewService(pool, logger)
	smaeSvc.SetEnabled(cfg.SMAEEnabled)
	if !cfg.SMAEEnabled {
		logger.Warn("smae_disabled", slog.String("reason", "SMAE_ENABLED=false: el catálogo oficial no se sirve a las cuentas"))
	}
	smae.NewController(smaeSvc, authSvc, logger).Register(v1)
	dishesSvc := dishes.NewService(pool, smaeSvc, logger)
	dishesSvc.SetClinical(patientsSvc)
	dishes.NewController(dishesSvc, authSvc, logger).Register(v1)
	plansSvc := mealplans.NewService(pool, patientsSvc, cfg.Timezone, logger)
	mealplans.NewController(plansSvc, authSvc, dishesSvc, func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error) {
		// La paciente se resuelve desde su sesión y debe tener el expediente habilitado (§4.1).
		p, err := patientsSvc.ForUser(c.Request.Context(), userID)
		if err != nil {
			return uuid.Nil, err
		}
		if ok, err := patientsSvc.ConsentComplete(c.Request.Context(), p.ID); err != nil {
			return uuid.Nil, err
		} else if !ok {
			return uuid.Nil, mealplans.ErrConsentPending
		}
		return p.ID, nil
	}, logger).Register(v1)
	settingsSvc := settings.NewService(pool, logger)
	settings.NewController(settingsSvc, authSvc, logger).Register(v1)
	dietocalculo.NewController(dietocalculo.NewService(pool, logger), authSvc, logger).Register(v1)
	agendaSvc := agenda.NewService(pool, logger)
	agenda.NewController(agendaSvc, authSvc, func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error) {
		p, err := patientsSvc.ForUser(c.Request.Context(), userID)
		return p.ID, err
	}, logger).Register(v1)

	// Almacenamiento de archivos: solo si hay S3/MinIO configurado.
	var images tracking.Images
	if cfg.S3Endpoint != "" {
		store, err := storage.NewS3Store(context.Background(), storage.S3Config{
			Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, AccessKeyID: cfg.S3AccessKeyID, SecretAccessKey: cfg.S3SecretAccessKey,
			PrivateBucket: cfg.S3PrivateBucket, PublicBucket: cfg.S3PublicBucket})
		if err != nil {
			logger.Error("storage_unavailable", slog.Any("error", err))
		} else {
			storageSvc := storage.NewService(pool, store, settingsSvc, patientsSvc, cfg.S3PrivateBucket, cfg.S3PublicBucket, logger)
			storageSvc.SetLimits(planSvc)
			plansSvc.SetFiles(storageSvc)
			images = storageSvc
			storage.NewController(storageSvc, authSvc, func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error) {
				p, err := patientsSvc.ForUser(c.Request.Context(), userID)
				return p.ID, err
			}, cfg.MaxUploadBytes+1<<20, logger).Register(v1)
		}
	} else {
		logger.Warn("storage_disabled", slog.String("reason", "S3_ENDPOINT no configurado"))
	}
	trackingSvc := tracking.NewService(pool, images, cfg.Timezone, logger)
	tracking.NewController(trackingSvc, authSvc, func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error) {
		p, err := patientsSvc.ForUser(c.Request.Context(), userID)
		if err != nil {
			return uuid.Nil, err
		}
		if ok, err := patientsSvc.ConsentComplete(c.Request.Context(), p.ID); err != nil {
			return uuid.Nil, err
		} else if !ok {
			return uuid.Nil, tracking.ErrConsentPending
		}
		return p.ID, nil
	}, cfg.MaxUploadBytes+1<<20, logger).Register(v1)
	auditlog.NewController(pool, authSvc).Register(v1)
	alertsSvc := alerts.NewService(pool, plansSvc, settingsSvc)
	alerts.NewController(alertsSvc, authSvc, logger).Register(v1)
	dashboard.NewController(dashboard.NewService(pool, alertsSvc, trackingSvc), authSvc).Register(v1)
	reports.NewController(reports.NewService(pool, patientsSvc, trackingSvc, logger), authSvc, settingsSvc, logger).Register(v1)
	// La consulta de auditoría registra aquí sus rutas cuando se implemente.

	return r, plansSvc, billingSvc
}

// trialMailer adapta el correo al aviso previo al primer cobro.
type trialMailer struct {
	m interface {
		SendTrialEnding(ctx context.Context, to, link, planName string, endsAt time.Time) error
	}
	link string
}

func (t trialMailer) SendTrialEnding(ctx context.Context, to, planName string, endsAt time.Time) error {
	return t.m.SendTrialEnding(ctx, to, t.link, planName, endsAt)
}
