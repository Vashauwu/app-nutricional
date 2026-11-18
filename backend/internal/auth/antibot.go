package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrCaptcha: la verificación anti robots falló o faltó.
var ErrCaptcha = errors.New("confirma que no eres un robot")

// CaptchaVerifier valida el token que produce el widget de la pantalla de registro.
type CaptchaVerifier interface {
	Verify(ctx context.Context, token, remoteIP string) error
}

// TurnstileVerifier valida con Cloudflare Turnstile (gratuito y sin rastreo de usuarios). El secreto nunca sale del servidor.
type TurnstileVerifier struct {
	Secret string
	// URL se puede cambiar en pruebas; vacío usa el punto oficial.
	URL    string
	Client *http.Client
}

const turnstileURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

func NewTurnstileVerifier(secret string) *TurnstileVerifier {
	return &TurnstileVerifier{Secret: secret, URL: turnstileURL, Client: &http.Client{Timeout: 8 * time.Second}}
}

func (t *TurnstileVerifier) Verify(ctx context.Context, token, remoteIP string) error {
	if strings.TrimSpace(token) == "" {
		return ErrCaptcha
	}
	form := url.Values{"secret": {t.Secret}, "response": {token}}
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.URL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := t.Client.Do(req)
	if err != nil {
		return err // falla cerrado: si no se puede verificar, no se abre la cuenta
	}
	defer res.Body.Close()
	var out struct {
		Success bool `json:"success"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(res.Body).Decode(&out) != nil {
		return errors.New("respuesta inválida del verificador anti robots")
	}
	if !out.Success {
		return ErrCaptcha
	}
	return nil
}

// disposableDomains: servicios de correo temporal muy usados para abrir cuentas en masa. Es una barrera de bajo costo,
// no una lista exhaustiva: el límite por correo/IP y el captcha cubren el resto.
var disposableDomains = map[string]bool{
	"mailinator.com": true, "guerrillamail.com": true, "guerrillamail.net": true, "guerrillamail.org": true, "sharklasers.com": true,
	"10minutemail.com": true, "10minutemail.net": true, "tempmail.com": true, "temp-mail.org": true, "temp-mail.io": true,
	"throwawaymail.com": true, "yopmail.com": true, "yopmail.net": true, "getnada.com": true, "trashmail.com": true,
	"trashmail.net": true, "dispostable.com": true, "maildrop.cc": true, "fakeinbox.com": true, "mailnesia.com": true,
	"mintemail.com": true, "mohmal.com": true, "emailondeck.com": true, "spamgourmet.com": true, "tempail.com": true,
	"burnermail.io": true, "mytemp.email": true, "tempinbox.com": true, "discard.email": true, "mailcatch.com": true,
	"moakt.com": true, "tmpmail.org": true, "tmpmail.net": true, "inboxkitten.com": true, "emailfake.com": true,
}

// IsDisposableEmail dice si el correo pertenece a un servicio de correo temporal (subdominios incluidos).
func IsDisposableEmail(email string) bool {
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	d := strings.ToLower(email[at+1:])
	for d != "" {
		if disposableDomains[d] {
			return true
		}
		i := strings.Index(d, ".")
		if i < 0 {
			return false
		}
		d = d[i+1:]
	}
	return false
}
