package middleware

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ETag añade validación condicional a las respuestas JSON de GET: el cliente repite la petición con
// If-None-Match y, si nada cambió, recibe 304 sin cuerpo. La respuesta sigue siendo privada (datos clínicos):
// "no-cache" obliga a revalidar, nunca a servir una copia sin preguntar al servidor.
// Las descargas (PDF, Excel, imágenes, .ics) no se almacenan en memoria: pasan directo.
func ETag() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			c.Next()
			return
		}
		w := &etagWriter{ResponseWriter: c.Writer}
		c.Writer = w
		c.Next()
		w.finish(c.Request.Header.Get("If-None-Match"))
	}
}

type etagWriter struct {
	gin.ResponseWriter
	status      int
	buf         bytes.Buffer
	decided     bool
	passthrough bool
}

func (w *etagWriter) WriteHeader(code int) {
	if w.decided && w.passthrough {
		w.ResponseWriter.WriteHeader(code)
		return
	}
	w.status = code
}

func (w *etagWriter) WriteHeaderNow() {
	if w.decided && w.passthrough {
		w.ResponseWriter.WriteHeaderNow()
	}
}

func (w *etagWriter) Status() int {
	if w.status != 0 && !(w.decided && w.passthrough) {
		return w.status
	}
	return w.ResponseWriter.Status()
}

func (w *etagWriter) Written() bool {
	if w.decided && !w.passthrough {
		return w.buf.Len() > 0 || w.status != 0
	}
	return w.ResponseWriter.Written()
}

// decide se llama en la primera escritura: ya existen las cabeceras de contenido.
func (w *etagWriter) decide() {
	if w.decided {
		return
	}
	w.decided = true
	ct := w.Header().Get("Content-Type")
	w.passthrough = !strings.HasPrefix(ct, "application/json") || w.Header().Get("ETag") != "" || w.Header().Get("Content-Disposition") != ""
	if w.passthrough && w.status != 0 {
		w.ResponseWriter.WriteHeader(w.status)
	}
}

func (w *etagWriter) Write(b []byte) (int, error) {
	w.decide()
	if w.passthrough {
		return w.ResponseWriter.Write(b)
	}
	return w.buf.Write(b)
}

func (w *etagWriter) WriteString(s string) (int, error) {
	w.decide()
	if w.passthrough {
		return w.ResponseWriter.WriteString(s)
	}
	return w.buf.WriteString(s)
}

// Flush solo tiene sentido en modo directo; en memoria se difiere hasta finish().
func (w *etagWriter) Flush() {
	if w.decided && w.passthrough {
		w.ResponseWriter.Flush()
	}
}

func (w *etagWriter) finish(ifNoneMatch string) {
	if !w.decided || w.passthrough {
		// Sin cuerpo (p. ej. solo cabeceras) o ya enviado en directo.
		if !w.decided && w.status != 0 {
			w.ResponseWriter.WriteHeader(w.status)
			w.ResponseWriter.WriteHeaderNow()
		}
		return
	}
	status := w.status
	if status == 0 {
		status = http.StatusOK
	}
	h := w.Header()
	if status == http.StatusOK && w.buf.Len() > 0 {
		sum := sha256.Sum256(w.buf.Bytes())
		tag := `W/"` + hex.EncodeToString(sum[:12]) + `"`
		h.Set("ETag", tag)
		if h.Get("Cache-Control") == "" {
			h.Set("Cache-Control", "private, no-cache")
		}
		if matchesETag(ifNoneMatch, tag) {
			h.Del("Content-Type")
			h.Del("Content-Length")
			w.ResponseWriter.WriteHeader(http.StatusNotModified)
			w.ResponseWriter.WriteHeaderNow()
			return
		}
	}
	w.ResponseWriter.WriteHeader(status)
	_, _ = w.ResponseWriter.Write(w.buf.Bytes())
}

func matchesETag(header, tag string) bool {
	if header == "" {
		return false
	}
	if strings.TrimSpace(header) == "*" {
		return true
	}
	for _, part := range strings.Split(header, ",") {
		if strings.TrimPrefix(strings.TrimSpace(part), "W/") == strings.TrimPrefix(tag, "W/") {
			return true
		}
	}
	return false
}
