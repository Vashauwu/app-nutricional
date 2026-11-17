package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// GoogleClaims es lo que se toma de un ID token de Google ya verificado.
type GoogleClaims struct {
	Email string
	Name  string
}

// IDTokenVerifier valida un ID token de «Continuar con Google». Es una interfaz para poder probar sin llamar a Google.
type IDTokenVerifier interface {
	Verify(ctx context.Context, raw string) (GoogleClaims, error)
}

var (
	ErrGoogleToken      = errors.New("no se pudo validar tu cuenta de Google")
	ErrGoogleDisabled   = errors.New("el ingreso con Google no está disponible")
	ErrGoogleNotAllowed = errors.New("esta cuenta no puede ingresar con Google; usa tu correo y contraseña")
)

const googleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"

// GoogleVerifier valida firma (RS256 con las llaves públicas de Google), emisor, audiencia (nuestro ID de cliente),
// vigencia y que el correo esté verificado por Google.
type GoogleVerifier struct {
	clientID string
	jwksURL  string
	hc       *http.Client
	now      func() time.Time

	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

func NewGoogleVerifier(clientID string) *GoogleVerifier {
	return &GoogleVerifier{clientID: clientID, jwksURL: googleJWKSURL, hc: &http.Client{Timeout: 8 * time.Second}, now: time.Now}
}

type googleIDClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	jwt.RegisteredClaims
}

func (g *GoogleVerifier) Verify(ctx context.Context, raw string) (GoogleClaims, error) {
	if g.clientID == "" || raw == "" || len(raw) > 4096 {
		return GoogleClaims{}, ErrGoogleToken
	}
	var c googleIDClaims
	tok, err := jwt.ParseWithClaims(raw, &c, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return g.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithAudience(g.clientID), jwt.WithExpirationRequired(), jwt.WithTimeFunc(g.now))
	if err != nil || !tok.Valid {
		return GoogleClaims{}, ErrGoogleToken
	}
	if c.Issuer != "https://accounts.google.com" && c.Issuer != "accounts.google.com" {
		return GoogleClaims{}, ErrGoogleToken
	}
	if !c.EmailVerified || c.Email == "" {
		return GoogleClaims{}, ErrGoogleToken
	}
	return GoogleClaims{Email: c.Email, Name: c.Name}, nil
}

// key devuelve la llave pública con ese kid; refresca la lista (como máximo cada minuto) si no la conoce o si pasó una hora.
func (g *GoogleVerifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if k, ok := g.keys[kid]; ok && g.now().Sub(g.fetched) < time.Hour {
		return k, nil
	}
	if g.keys != nil && g.now().Sub(g.fetched) < time.Minute {
		return nil, fmt.Errorf("llave desconocida")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.jwksURL, nil)
	if err != nil {
		return nil, err
	}
	res, err := g.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks: %d", res.StatusCode)
	}
	var set struct {
		Keys []struct{ Kid, Kty, N, E string } `json:"keys"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 1<<20)).Decode(&set); err != nil {
		return nil, err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, err1 := base64.RawURLEncoding.DecodeString(k.N)
		e, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	g.keys, g.fetched = keys, g.now()
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("llave desconocida")
}
