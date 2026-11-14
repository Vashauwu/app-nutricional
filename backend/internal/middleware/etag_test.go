package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func etagRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(ETag())
	r.GET("/json", func(c *gin.Context) { c.JSON(200, gin.H{"a": 1}) })
	r.GET("/missing", func(c *gin.Context) { c.JSON(404, gin.H{"error": "x"}) })
	r.GET("/file", func(c *gin.Context) {
		c.Header("Content-Disposition", "attachment")
		c.Data(200, "application/pdf", []byte("%PDF"))
	})
	r.POST("/json", func(c *gin.Context) { c.JSON(200, gin.H{"a": 1}) })
	return r
}

func do(r *gin.Engine, method, path, inm string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if inm != "" {
		req.Header.Set("If-None-Match", inm)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestETag(t *testing.T) {
	r := etagRouter()

	first := do(r, "GET", "/json", "")
	require.Equal(t, 200, first.Code)
	tag := first.Header().Get("ETag")
	require.NotEmpty(t, tag)
	require.Equal(t, "private, no-cache", first.Header().Get("Cache-Control"))
	require.JSONEq(t, `{"a":1}`, first.Body.String())

	second := do(r, "GET", "/json", tag)
	require.Equal(t, http.StatusNotModified, second.Code)
	require.Empty(t, second.Body.String())

	stale := do(r, "GET", "/json", `W/"otro"`)
	require.Equal(t, 200, stale.Code)
	require.JSONEq(t, `{"a":1}`, stale.Body.String())
}

func TestETagNoToleraErroresNiDescargasNiEscrituras(t *testing.T) {
	r := etagRouter()

	miss := do(r, "GET", "/missing", "")
	require.Equal(t, 404, miss.Code)
	require.Empty(t, miss.Header().Get("ETag"), "los errores no llevan ETag")
	require.JSONEq(t, `{"error":"x"}`, miss.Body.String())

	file := do(r, "GET", "/file", "")
	require.Equal(t, 200, file.Code)
	require.Equal(t, "%PDF", file.Body.String())
	require.Empty(t, file.Header().Get("ETag"))

	post := do(r, "POST", "/json", "")
	require.Equal(t, 200, post.Code)
	require.Empty(t, post.Header().Get("ETag"))
}
