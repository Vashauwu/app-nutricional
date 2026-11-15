// Package clienterrors recibe los errores que ocurren en el navegador y los deja en el registro del
// servidor, junto con el request_id, para poder diagnosticarlos sin depender de un servicio externo.
// No guarda nada en base de datos y no recibe datos clínicos: solo mensaje técnico, pila y ruta.
package clienterrors

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

const maxBody = 16 << 10

type report struct {
	Message string `json:"message" binding:"required"`
	Stack   string `json:"stack"`
	URL     string `json:"url"`
	Release string `json:"release"`
}

// Los enlaces de invitación y de restablecer contraseña llevan el secreto en la ruta: nunca se registra.
var secretSegment = regexp.MustCompile(`/[A-Za-z0-9_-]{20,}`)

func cut(s string, n int) string {
	s = strings.ToValidUTF8(s, "")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

func cleanURL(u string) string {
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		u = u[:i]
	}
	return cut(secretSegment.ReplaceAllString(u, "/:token"), 200)
}

type Controller struct{ log *slog.Logger }

func NewController(log *slog.Logger) *Controller { return &Controller{log: log} }

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	v1.POST("/client-errors", middleware.RateLimit(20, time.Minute), ct.report)
	v1.POST("/client-metrics", middleware.RateLimit(60, time.Minute), ct.metrics)
}

// Métricas de velocidad reales (Core Web Vitals) medidas en el navegador de cada persona.
var vitals = map[string]bool{"LCP": true, "CLS": true, "INP": true, "FCP": true, "TTFB": true}

type vital struct {
	Name    string  `json:"name" binding:"required"`
	Value   float64 `json:"value"`
	Rating  string  `json:"rating"`
	URL     string  `json:"url"`
	Release string  `json:"release"`
	// Conexión y memoria aproximadas del dispositivo, para separar equipos lentos de problemas del servidor.
	Connection string `json:"connection"`
}

func (ct *Controller) metrics(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<10)
	var in vital
	if err := c.ShouldBindJSON(&in); err != nil || !vitals[in.Name] || in.Value < 0 || in.Value > 1e7 {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Métrica no válida.")
		return
	}
	switch in.Rating {
	case "good", "needs-improvement", "poor":
	default:
		in.Rating = "unknown"
	}
	ct.log.InfoContext(c.Request.Context(), "web_vital",
		slog.String("name", in.Name),
		slog.Float64("value", in.Value),
		slog.String("rating", in.Rating),
		slog.String("url", cleanURL(in.URL)),
		slog.String("release", cut(in.Release, 40)),
		slog.String("connection", cut(in.Connection, 20)),
	)
	c.Status(http.StatusNoContent)
}

func (ct *Controller) report(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBody)
	var in report
	if err := c.ShouldBindJSON(&in); err != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Reporte no válido.")
		return
	}
	ct.log.ErrorContext(c.Request.Context(), "client_error",
		slog.String("message", cut(in.Message, 500)),
		slog.String("stack", cut(in.Stack, 4000)),
		slog.String("url", cleanURL(in.URL)),
		slog.String("release", cut(in.Release, 40)),
		slog.String("user_agent", cut(c.Request.UserAgent(), 200)),
		slog.String("request_id", c.GetString("request_id")),
	)
	c.Status(http.StatusNoContent)
}
