package middleware

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel/trace"
)

// SlowRequests deja una advertencia por cada petición que tarda más que el umbral, con la ruta (sin datos
// personales) y el id de traza cuando OpenTelemetry está activo, para ubicarla después en el colector.
// threshold <= 0 la desactiva.
func SlowRequests(logger *slog.Logger, threshold time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if threshold <= 0 {
			c.Next()
			return
		}
		start := time.Now()
		c.Next()
		d := time.Since(start)
		if d < threshold {
			return
		}
		attrs := []slog.Attr{
			slog.String("request_id", GetRequestID(c)),
			slog.String("method", c.Request.Method),
			slog.String("route", c.FullPath()),
			slog.Int("status", c.Writer.Status()),
			slog.Duration("duration", d),
			slog.Duration("threshold", threshold),
		}
		if sc := trace.SpanContextFromContext(c.Request.Context()); sc.HasTraceID() {
			attrs = append(attrs, slog.String("trace_id", sc.TraceID().String()))
		}
		logger.LogAttrs(c.Request.Context(), slog.LevelWarn, "slow_request", attrs...)
	}
}
