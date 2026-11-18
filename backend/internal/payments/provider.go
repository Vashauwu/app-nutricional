// Package payments cobra las suscripciones de pago. El número de tarjeta nunca llega al servidor: el navegador lo
// tokeniza con el proveedor y aquí solo viaja el token. El estado de la suscripción cambia por la respuesta server-a-server
// del proveedor o por sus eventos firmados, nunca por lo que diga el navegador.
package payments

import (
	"context"
	"errors"
	"net/http"
	"time"
)

var (
	// ErrCardDeclined: el proveedor rechazó la tarjeta o el cobro.
	ErrCardDeclined = errors.New("la tarjeta fue rechazada")
	// ErrBadSignature: el evento no trae una firma válida.
	ErrBadSignature = errors.New("firma de evento inválida")
)

// Tipos de evento que el sistema entiende (cada proveedor los traduce a estos).
const (
	EventPaymentSucceeded     = "payment.succeeded"
	EventPaymentFailed        = "payment.failed"
	EventSubscriptionCanceled = "subscription.canceled"
	EventChargeback           = "charge.chargeback"
)

type Card struct {
	ID       string `json:"id"`
	Brand    string `json:"brand"`
	Last4    string `json:"last4"`
	ExpMonth int    `json:"exp_month"`
	ExpYear  int    `json:"exp_year"`
}

type SubscribeInput struct {
	CustomerID string
	CardID     string
	Plan       string
	Period     string // monthly | annual
	AmountMXN  int
	// TrialEnd: sin cobro hasta esa fecha (el primer cobro ocurre al terminar).
	TrialEnd *time.Time
}

// Subscription es lo que devuelve el proveedor al crear o cambiar una suscripción.
type Subscription struct {
	ID string
	// Status: trialing | active
	Status    string
	PeriodEnd time.Time
	// ChargeID y Paid describen el cobro inmediato (vacíos si empezó una prueba).
	ChargeID  string
	Paid      bool
	AmountMXN int
}

// Event es un aviso del proveedor ya verificado y traducido.
type Event struct {
	ID             string    `json:"id"`
	Type           string    `json:"type"`
	SubscriptionID string    `json:"subscription_id"`
	ChargeID       string    `json:"charge_id,omitempty"`
	AmountMXN      int       `json:"amount_mxn,omitempty"`
	Plan           string    `json:"plan,omitempty"`
	Period         string    `json:"period,omitempty"`
	PeriodEnd      time.Time `json:"period_end,omitempty"`
	Reason         string    `json:"reason,omitempty"`
	OccurredAt     time.Time `json:"occurred_at"`
}

// Provider es la pasarela de cobro. Hay una simulada (pruebas y staging sin llaves); el adaptador de Conekta se agrega
// cuando haya llaves para verificarlo contra su sandbox (ver docs/interno/cobro-m4.md).
type Provider interface {
	Name() string
	// Config son valores públicos para el navegador (modo y, si aplica, la llave pública para tokenizar).
	Config() map[string]string
	CreateCustomer(ctx context.Context, email, name string) (string, error)
	AttachCard(ctx context.Context, customerID, cardToken string) (Card, error)
	Subscribe(ctx context.Context, in SubscribeInput) (Subscription, error)
	ChangePlan(ctx context.Context, subscriptionID, plan, period string, amountMXN int) (Subscription, error)
	Cancel(ctx context.Context, subscriptionID string) error
	// Refund devuelve un cobro ya pagado.
	Refund(ctx context.Context, chargeID string) error
	// ParseEvent verifica la firma y traduce el cuerpo; falla con ErrBadSignature si no es auténtico.
	ParseEvent(h http.Header, body []byte) (Event, error)
}
