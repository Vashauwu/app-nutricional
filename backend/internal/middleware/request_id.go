// Package middleware contiene middlewares HTTP transversales.
package middleware

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	RequestIDHeader = "X-Request-ID"
	requestIDKey    = "request_id"
)

// RequestID asigna un identificador por petición (§24.3). Siempre se genera en
// el servidor: no se confía en el valor que envíe el cliente.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := uuid.NewString()
		c.Set(requestIDKey, id)
		c.Header(RequestIDHeader, id)
		c.Next()
	}
}

func GetRequestID(c *gin.Context) string { return c.GetString(requestIDKey) }

// AccessLog registra cada petición con slog. No registra cuerpos, cookies ni
// query strings, que pueden contener datos personales o tokens.
func AccessLog(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logger.LogAttrs(c.Request.Context(), slog.LevelInfo, "http_request",
			slog.String("request_id", GetRequestID(c)),
			slog.String("method", c.Request.Method),
			slog.String("route", c.FullPath()),
			slog.Int("status", c.Writer.Status()),
			slog.Duration("duration", time.Since(start)),
		)
	}
}
