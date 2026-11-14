// Package telemetry configura las trazas OpenTelemetry (OTLP/HTTP). Si no hay OTEL_EXPORTER_OTLP_ENDPOINT
// no hace nada: ni exportador, ni hilos, ni costo. Sirve para rastrear peticiones lentas del backend
// de punta a punta (ruta HTTP → consultas SQL) en cualquier colector compatible (Jaeger, Tempo, Grafana…).
package telemetry

import (
	"context"
	"log/slog"
	"net/url"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// Setup activa las trazas y devuelve la función que vacía el búfer al apagar. Siempre es seguro llamarla.
func Setup(ctx context.Context, endpoint, service, env string, log *slog.Logger) (shutdown func(context.Context) error, enabled bool, err error) {
	noop := func(context.Context) error { return nil }
	if endpoint == "" {
		return noop, false, nil
	}
	opts := []otlptracehttp.Option{}
	if u, perr := url.Parse(endpoint); perr == nil && u.Scheme != "" && u.Host != "" {
		opts = append(opts, otlptracehttp.WithEndpoint(u.Host))
		if u.Scheme == "http" {
			opts = append(opts, otlptracehttp.WithInsecure())
		}
		if u.Path != "" && u.Path != "/" {
			opts = append(opts, otlptracehttp.WithURLPath(u.Path))
		}
	} else {
		opts = append(opts, otlptracehttp.WithEndpoint(endpoint), otlptracehttp.WithInsecure())
	}
	exp, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		return noop, false, err
	}
	res, err := resource.New(ctx, resource.WithAttributes(semconv.ServiceName(service), semconv.DeploymentEnvironmentName(env)))
	if err != nil {
		return noop, false, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp, sdktrace.WithBatchTimeout(5*time.Second)),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	log.Info("telemetry_enabled", slog.String("service", service))
	return tp.Shutdown, true, nil
}
