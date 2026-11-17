package plans

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nutri/app-nutricional/backend/generated/db"
)

// Estados de la suscripción (columna subscriptions.status).
const (
	StatusTrialing = "trialing" // prueba gratuita: plan completo hasta trial_ends_at
	StatusActive   = "active"   // pagado (o concedido sin cobro)
	StatusPastDue  = "past_due" // cobro fallido: plan completo durante la gracia
	StatusCanceled = "canceled" // cancelada: plan completo hasta el fin del periodo pagado
	StatusExpired  = "expired"  // vencida: plan Gratuito
)

// Plazos. Se calculan al consultar, sin tareas programadas: nada se borra al bajar de plan, solo cambia lo que se puede crear.
const (
	GraceDays = 7
	// RenewalSlack: margen tras current_period_end para que llegue el aviso de renovación del proveedor.
	RenewalSlack = 48 * time.Hour
)

// Standing es la situación de una consulta frente a su plan en un instante dado.
type Standing struct {
	// Plan efectivo: el que valida límites y funciones. Es Gratuito cuando la suscripción venció.
	Plan Plan `json:"plan"`
	// Contracted es el plan que la consulta eligió o pagó, aunque ya no esté vigente.
	Contracted Plan `json:"contracted"`
	// State: free | trialing | active | past_due | canceled | expired.
	State string `json:"state"`
	// EndsAt: cuándo termina lo vigente (fin de prueba, de gracia o del periodo). Nulo si no vence.
	EndsAt *time.Time `json:"ends_at"`
	// Downgraded: el plan contratado ya no está vigente y la consulta opera con Gratuito.
	Downgraded bool `json:"downgraded"`
	// Comped: plan concedido sin cobro (cuenta fundadora o cortesía).
	Comped bool `json:"comped"`
}

func tp(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

// Resolve determina el plan efectivo de una suscripción. Es una función pura: el mismo registro y la misma hora dan siempre
// el mismo resultado, así que se prueba sin base de datos.
func Resolve(sub db.Subscription, now time.Time) (Standing, error) {
	contracted, err := ByCode(sub.Plan)
	if err != nil {
		return Standing{}, err
	}
	free, _ := ByCode("free")
	st := Standing{Plan: contracted, Contracted: contracted, State: sub.Status, Comped: sub.CompReason.Valid && sub.CompReason.String != ""}
	lapse := func() (Standing, error) {
		st.Plan, st.Downgraded, st.State = free, contracted.Code != "free", StatusExpired
		if contracted.Code == "free" {
			st.State = "free"
		}
		return st, nil
	}
	if contracted.Code == "free" {
		st.State = "free"
		return st, nil
	}
	period := tp(sub.CurrentPeriodEnd)
	switch sub.Status {
	case StatusTrialing:
		st.EndsAt = tp(sub.TrialEndsAt)
		if st.EndsAt == nil || !now.Before(*st.EndsAt) {
			return lapse()
		}
	case StatusPastDue:
		st.EndsAt = tp(sub.GraceUntil)
		if st.EndsAt == nil || !now.Before(*st.EndsAt) {
			return lapse()
		}
	case StatusCanceled:
		st.EndsAt = period
		if period == nil || !now.Before(*period) {
			return lapse()
		}
	case StatusActive:
		// Sin fecha de fin = concedido sin vencimiento (cuenta fundadora). Con fecha, vence si no llegó la renovación.
		st.EndsAt = period
		if period != nil && !now.Before(period.Add(RenewalSlack)) {
			return lapse()
		}
	default: // expired y cualquier valor desconocido: se opera como Gratuito
		return lapse()
	}
	return st, nil
}

// GraceUntil devuelve el fin de la gracia para un cobro fallido que ocurre en `now`.
func GraceUntil(now time.Time) time.Time { return now.AddDate(0, 0, GraceDays) }
