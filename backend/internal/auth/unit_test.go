package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestValidatePassword(t *testing.T) {
	for _, ok := range []string{"demo1234", "Abcdefg1", "clave-larga-2026"} {
		require.NoError(t, ValidatePassword(ok), ok)
	}
	for _, bad := range []string{"", "corta1", "sinnumeros", "12345678", "a1"} {
		require.ErrorIs(t, ValidatePassword(bad), ErrWeakPassword, bad)
	}
}

func TestPasswordHashIsArgon2idAndVerifies(t *testing.T) {
	h, err := HashPassword("demo1234")
	require.NoError(t, err)
	require.Contains(t, h, "$argon2id$")
	require.True(t, VerifyPassword("demo1234", h))
	require.False(t, VerifyPassword("otra1234", h))
}

func TestAccessTokenRoundTripAndRejections(t *testing.T) {
	tm := NewTokenManager("secreto-de-pruebas-suficientemente-largo", time.Minute)
	uid, sid := uuid.New(), uuid.New()
	raw, _, err := tm.IssueAccess(uid, sid, "nutritionist")
	require.NoError(t, err)
	c, err := tm.ParseAccess(raw)
	require.NoError(t, err)
	require.Equal(t, sid, c.SessionID)
	require.Equal(t, "nutritionist", c.Role)

	// Vencido
	tm.now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	_, err = tm.ParseAccess(raw)
	require.ErrorIs(t, err, ErrInvalidToken)

	// Firmado con otro secreto
	other := NewTokenManager("otro-secreto-distinto-de-pruebas-123", time.Minute)
	bad, _, _ := other.IssueAccess(uid, sid, "nutritionist")
	tm.now = time.Now
	_, err = tm.ParseAccess(bad)
	require.ErrorIs(t, err, ErrInvalidToken)

	// alg=none (ataque clásico) debe rechazarse
	none, _ := jwt.NewWithClaims(jwt.SigningMethodNone, Claims{SessionID: sid, Role: "nutritionist",
		RegisteredClaims: jwt.RegisteredClaims{Subject: uid.String(), Issuer: "nutri-api", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	_, err = tm.ParseAccess(none)
	require.ErrorIs(t, err, ErrInvalidToken)

	// Otro algoritmo HMAC (HS512) tampoco se acepta
	hs512, _ := jwt.NewWithClaims(jwt.SigningMethodHS512, Claims{SessionID: sid, RegisteredClaims: jwt.RegisteredClaims{Subject: uid.String(), Issuer: "nutri-api", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}).SignedString(tm.secret)
	_, err = tm.ParseAccess(hs512)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestOpaqueTokensAreUniqueAndOnlyHashIsDerivable(t *testing.T) {
	a, ha, err := NewOpaqueToken()
	require.NoError(t, err)
	b, _, _ := NewOpaqueToken()
	require.NotEqual(t, a, b)
	require.GreaterOrEqual(t, len(a), 43) // 256 bits en base64url
	require.Equal(t, ha, HashToken(a))
	require.Len(t, ha, 32)
}

func TestLimiterBlocksAndExpires(t *testing.T) {
	now := time.Now()
	l := NewLimiter(3, time.Minute)
	l.now = func() time.Time { return now }
	for i := 0; i < 3; i++ {
		require.True(t, l.Allowed("k"))
		l.Fail("k")
	}
	require.False(t, l.Allowed("k"))
	require.True(t, l.Allowed("otra"))
	now = now.Add(61 * time.Second)
	require.True(t, l.Allowed("k"))
	l.Fail("k")
	l.Reset("k")
	require.True(t, l.Allowed("k"))
}
