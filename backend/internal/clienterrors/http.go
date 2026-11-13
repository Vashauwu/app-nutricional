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
