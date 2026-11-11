package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	pgxdecimal "github.com/jackc/pgx-shopspring-decimal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nutri/app-nutricional/backend/internal/alerts"
	"github.com/nutri/app-nutricional/backend/internal/auditlog"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/dashboard"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/mealplans"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/migrate"
	"github.com/nutri/app-nutricional/backend/internal/nutrition_engine/calculator"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/reports"
	"github.com/nutri/app-nutricional/backend/internal/settings"
	"github.com/nutri/app-nutricional/backend/internal/shared"
	"github.com/nutri/app-nutricional/backend/internal/smae"
	"github.com/nutri/app-nutricional/backend/internal/storage"
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
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := newPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           newRouter(cfg, logger, pool),
		ReadHeaderTimeout: 10 * time.Second,
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

// newPool registra el codec NUMERIC <-> shopspring/decimal en cada conexión,
// de modo que ningún valor nutricional pase por float (§7.3).
func newPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	pcfg.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		pgxdecimal.Register(conn.TypeMap())
		return nil
	}
	return pgxpool.NewWithConfig(ctx, pcfg)
}

func newRouter(cfg config.Config, logger *slog.Logger, pool *pgxpool.Pool) *gin.Engine {
	r := gin.New()
	// Solo se confía en X-Forwarded-For del proxy (Caddy) dentro de la red privada; si no, el límite de intentos se evade falseando la IP.
	_ = r.SetTrustedProxies([]string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.1"})
	r.Use(gin.Recovery(), middleware.RequestID(), middleware.AccessLog(logger))
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
	auth.NewController(authSvc, cfg).Register(v1)
	patientsSvc := patients.NewService(pool, authSvc, logger)
	patients.NewController(patientsSvc, authSvc, logger).Register(v1)
	smaeSvc := smae.NewService(pool, logger)
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

	return r
}
