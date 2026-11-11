package auth

import (
	"sync"
	"time"
)

// Limiter limita intentos fallidos de inicio de sesión por clave (IP + correo).
// Es en memoria: suficiente para una sola instancia (monolito, §21.2).
type Limiter struct {
	mu      sync.Mutex
	max     int
	window  time.Duration
	entries map[string][]time.Time
	now     func() time.Time
}

func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, entries: map[string][]time.Time{}, now: time.Now}
}

func (l *Limiter) prune(key string) []time.Time {
	cut := l.now().Add(-l.window)
	kept := l.entries[key][:0]
	for _, t := range l.entries[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(l.entries, key)
		return nil
	}
	l.entries[key] = kept
	return kept
}

// Allowed indica si todavía se permite intentar.
func (l *Limiter) Allowed(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.prune(key)) < l.max
}

func (l *Limiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune(key)
	l.entries[key] = append(l.entries[key], l.now())
}

func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}
