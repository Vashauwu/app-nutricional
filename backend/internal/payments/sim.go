package payments

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// SimProvider es una pasarela simulada y SIN estado: todo lo que debe recordar viaja en los identificadores. Sirve para
// probar el ciclo completo (alta, prueba, cobro, fallo, gracia, baja) sin llaves reales.
//
// Tarjetas de prueba (el navegador arma el token; el número nunca llega al servidor):
//
//	4242 4242 4242 4242  aprobada             4000 0000 0000 0002  rechazada al registrarla
//	4000 0000 0000 9995  se registra, pero el primer cobro falla (fondos insuficientes)
type SimProvider struct {
	secret []byte
	now    func() time.Time
}

func NewSimProvider(secret string) *SimProvider {
	return &SimProvider{secret: []byte(secret), now: time.Now}
}

func (p *SimProvider) Name() string                { return "sim" }
func (p *SimProvider) Config() map[string]string   { return map[string]string{"mode": "sim"} }
func (p *SimProvider) SetClock(f func() time.Time) { p.now = f }

func (p *SimProvider) CreateCustomer(context.Context, string, string) (string, error) {
	return "cus_sim_" + uuid.NewString(), nil
}

// SimToken arma el token que produce el navegador a partir de la tarjeta capturada (solo los 4 últimos dígitos viajan).
func SimToken(last4, exp string) string { return "sim:" + last4 + ":" + exp }

func (p *SimProvider) AttachCard(_ context.Context, _ string, token string) (Card, error) {
	parts := strings.Split(token, ":")
	if len(parts) != 3 || parts[0] != "sim" || len(parts[1]) != 4 {
		return Card{}, fmt.Errorf("%w: token inválido", ErrCardDeclined)
	}
	last4 := parts[1]
	if last4 == "0002" {
		return Card{}, ErrCardDeclined
	}
	mm, yy := 12, 2030
	if e := strings.Split(parts[2], "/"); len(e) == 2 {
		if m, err := strconv.Atoi(e[0]); err == nil && m >= 1 && m <= 12 {
			mm = m
		}
		if y, err := strconv.Atoi(e[1]); err == nil {
			if y < 100 {
				y += 2000
			}
			yy = y
		}
	}
	brand := "visa"
	if strings.HasPrefix(last4, "5") {
		brand = "mastercard"
	}
	return Card{ID: "card_sim_" + last4, Brand: brand, Last4: last4, ExpMonth: mm, ExpYear: yy}, nil
}

func addPeriod(t time.Time, period string) time.Time {
	if period == "annual" {
		return t.AddDate(1, 0, 0)
	}
	return t.AddDate(0, 1, 0)
}

func (p *SimProvider) Subscribe(_ context.Context, in SubscribeInput) (Subscription, error) {
	id := "sub_sim_" + uuid.NewString()
	if in.TrialEnd != nil {
		return Subscription{ID: id, Status: "trialing", PeriodEnd: *in.TrialEnd}, nil
	}
	if strings.HasSuffix(in.CardID, "9995") {
		return Subscription{}, ErrCardDeclined
	}
	now := p.now()
	return Subscription{ID: id, Status: "active", PeriodEnd: addPeriod(now, in.Period), ChargeID: "ch_sim_" + uuid.NewString(), Paid: true, AmountMXN: in.AmountMXN}, nil
}

func (p *SimProvider) ChangePlan(_ context.Context, subID, _ string, period string, amount int) (Subscription, error) {
	now := p.now()
	return Subscription{ID: subID, Status: "active", PeriodEnd: addPeriod(now, period), ChargeID: "ch_sim_" + uuid.NewString(), Paid: true, AmountMXN: amount}, nil
}

func (p *SimProvider) Cancel(context.Context, string) error { return nil }

// Sign firma un evento como lo haría el proveedor (HMAC-SHA256 del cuerpo). Lo usa la CLI de simulación y las pruebas.
func (p *SimProvider) Sign(e Event) (body []byte, signature string) {
	body, _ = json.Marshal(e)
	m := hmac.New(sha256.New, p.secret)
	m.Write(body)
	return body, hex.EncodeToString(m.Sum(nil))
}

const simSignatureHeader = "X-Sim-Signature"

func (p *SimProvider) ParseEvent(h http.Header, body []byte) (Event, error) {
	m := hmac.New(sha256.New, p.secret)
	m.Write(body)
	want := m.Sum(nil)
	got, err := hex.DecodeString(h.Get(simSignatureHeader))
	if err != nil || !hmac.Equal(got, want) {
		return Event{}, ErrBadSignature
	}
	var e Event
	if err := json.Unmarshal(body, &e); err != nil || e.ID == "" || e.Type == "" || e.SubscriptionID == "" {
		return Event{}, fmt.Errorf("evento incompleto")
	}
	return e, nil
}

// SignatureHeader es el nombre del encabezado de firma de la simulación.
func (p *SimProvider) SignatureHeader() string { return simSignatureHeader }
