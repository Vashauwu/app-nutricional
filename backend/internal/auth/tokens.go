package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	SessionID uuid.UUID `json:"sid"`
	Role      string    `json:"role"`
	jwt.RegisteredClaims
}

type TokenManager struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

func NewTokenManager(secret string, ttl time.Duration) *TokenManager {
	return &TokenManager{secret: []byte(secret), ttl: ttl, now: time.Now}
}

func (t *TokenManager) IssueAccess(userID, sessionID uuid.UUID, role string) (string, time.Time, error) {
	exp := t.now().Add(t.ttl)
	claims := Claims{
		SessionID: sessionID,
		Role:      role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(t.now()),
			ExpiresAt: jwt.NewNumericDate(exp),
			Issuer:    "nutri-api",
		},
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
	return s, exp, err
}

var ErrInvalidToken = errors.New("token inválido o vencido")

// ParseAccess solo acepta HS256 (evita ataques de confusión de algoritmo).
func (t *TokenManager) ParseAccess(raw string) (*Claims, error) {
	var c Claims
	tok, err := jwt.ParseWithClaims(raw, &c, func(*jwt.Token) (any, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("nutri-api"), jwt.WithTimeFunc(t.now))
	if err != nil || !tok.Valid {
		return nil, ErrInvalidToken
	}
	return &c, nil
}

// NewOpaqueToken devuelve un token aleatorio de 256 bits y su hash SHA-256.
// En la base de datos solo se guarda el hash (§29.2).
func NewOpaqueToken() (raw string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", nil, err
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, HashToken(raw), nil
}

func HashToken(raw string) []byte {
	h := sha256.Sum256([]byte(raw))
	return h[:]
}
