package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/nutri/app-nutricional/backend/internal/shared"
)

// RateLimiter cuenta peticiones por clave (IP) en una ventana deslizante.
// Es en memoria: suficiente para una sola instancia (monolito, §21.2).
type RateLimiter struct {
	mu      sync.Mutex
	max     int
	window  time.Duration
	hits    map[string][]time.Time
	now     func() time.Time
	lastGC  time.Time
	maxKeys int
}

func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	return &RateLimiter{max: max, window: window, hits: map[string][]time.Time{}, now: time.Now, maxKeys: 50000}
}

// Allow registra la petición y dice si cabe dentro del límite; si no, cuánto falta para reintentar.
func (l *RateLimiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.gc(now)
	cut := now.Add(-l.window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.max {
		l.hits[key] = kept
		return false, kept[0].Add(l.window).Sub(now)
	}
	l.hits[key] = append(kept, now)
	return true, 0
}

// gc descarta claves vencidas para que el mapa no crezca sin límite.
func (l *RateLimiter) gc(now time.Time) {
	if now.Sub(l.lastGC) < l.window && len(l.hits) < l.maxKeys {
		return
	}
	l.lastGC = now
	cut := now.Add(-l.window)
	for k, ts := range l.hits {
		if len(ts) == 0 || !ts[len(ts)-1].After(cut) {
			delete(l.hits, k)
		}
	}
}

// RateLimit limita las peticiones por IP del cliente y responde 429 con Retry-After.
func RateLimit(max int, window time.Duration) gin.HandlerFunc {
	l := NewRateLimiter(max, window)
	return func(c *gin.Context) {
		ok, wait := l.Allow(c.ClientIP())
		if ok {
			c.Next()
			return
		}
		secs := int(wait.Seconds()) + 1
		c.Header("Retry-After", strconv.Itoa(secs))
		shared.AbortWithError(c, http.StatusTooManyRequests, "rate_limited", "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.")
	}
}
