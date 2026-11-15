package clienterrors

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func router(buf *bytes.Buffer) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	NewController(slog.New(slog.NewTextHandler(buf, nil))).Register(r.Group("/api/v1"))
	return r
}

func post(r *gin.Engine, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/client-errors", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestReportLogsAndScrubsSecrets(t *testing.T) {
	var buf bytes.Buffer
	r := router(&buf)
	w := post(r, `{"message":"boom","stack":"at x","url":"https://app.test/restablecer/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789?x=1"}`)
	require.Equal(t, http.StatusNoContent, w.Code)
	out := buf.String()
	require.Contains(t, out, "client_error")
	require.Contains(t, out, "boom")
	require.NotContains(t, out, "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "el token de la ruta no se registra")
	require.Contains(t, out, ":token")
}

func TestReportValidatesAndLimits(t *testing.T) {
	var buf bytes.Buffer
	r := router(&buf)
	require.Equal(t, http.StatusBadRequest, post(r, `{"stack":"sin mensaje"}`).Code)
	require.Equal(t, http.StatusBadRequest, post(r, `no es json`).Code)
	require.Equal(t, http.StatusBadRequest, post(r, `{"message":"`+strings.Repeat("a", 20000)+`"}`).Code, "cuerpo demasiado grande")
	// El límite es de 20 por minuto y por IP; ya se gastaron 3 intentos.
	for i := 0; i < 17; i++ {
		require.Equal(t, http.StatusNoContent, post(r, `{"message":"x"}`).Code)
	}
	w := post(r, `{"message":"x"}`)
	require.Equal(t, http.StatusTooManyRequests, w.Code)
	require.NotEmpty(t, w.Header().Get("Retry-After"))
}

func postMetric(r *gin.Engine, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/client-metrics", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestMetricsLogsKnownVitalsOnly(t *testing.T) {
	var buf bytes.Buffer
	r := router(&buf)
	w := postMetric(r, `{"name":"LCP","value":2400.5,"rating":"good","url":"https://app.test/pacientes/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789?x=1","connection":"4g"}`)
	require.Equal(t, http.StatusNoContent, w.Code)
	out := buf.String()
	require.Contains(t, out, "web_vital")
	require.Contains(t, out, "LCP")
	require.NotContains(t, out, "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")

	require.Equal(t, http.StatusNoContent, postMetric(r, `{"name":"CLS","value":0,"rating":"good"}`).Code, "un CLS de cero es válido")
	require.Equal(t, http.StatusBadRequest, postMetric(r, `{"name":"HACK","value":1}`).Code, "nombre desconocido")
	require.Equal(t, http.StatusBadRequest, postMetric(r, `{"name":"LCP","value":-5}`).Code, "valor negativo")
	require.Equal(t, http.StatusBadRequest, postMetric(r, `no es json`).Code)
}
