package middleware

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRateLimiterSlidingWindow(t *testing.T) {
	now := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	l := NewRateLimiter(2, time.Minute)
	l.now = func() time.Time { return now }

	ok, _ := l.Allow("a")
	require.True(t, ok)
	ok, _ = l.Allow("a")
	require.True(t, ok)
	ok, wait := l.Allow("a")
	require.False(t, ok)
	require.Equal(t, time.Minute, wait)

	ok, _ = l.Allow("b")
	require.True(t, ok, "cada IP lleva su propia cuenta")

	now = now.Add(61 * time.Second)
	ok, _ = l.Allow("a")
	require.True(t, ok, "la ventana vence")
}

func TestRateLimiterDropsExpiredKeys(t *testing.T) {
	now := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	l := NewRateLimiter(5, time.Minute)
	l.now = func() time.Time { return now }
	for _, k := range []string{"a", "b", "c"} {
		l.Allow(k)
	}
	now = now.Add(3 * time.Minute)
	l.Allow("d")
	require.Len(t, l.hits, 1, "las claves vencidas se liberan")
}
