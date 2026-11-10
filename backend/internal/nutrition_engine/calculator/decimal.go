// Package calculator implementa la aritmética del motor nutricional.
//
// Política numérica (MVP_SPEC §7.3):
//   - Sumas y multiplicaciones exactas, sin redondeo intermedio.
//   - Divisiones con 16 decimales y Round Half Even.
//   - El redondeo ocurre solo en la frontera de la división; los datos
//     originales nunca se modifican.
//
// No depende de HTTP, base de datos ni de ningún otro módulo (§30.1).
package calculator

import (
	"errors"

	"github.com/shopspring/decimal"
)

// EngineVersion se guarda en cada snapshot para poder reproducir el cálculo.
const EngineVersion = "0.1.0"

// DivisionScale es el número de decimales que conserva una división.
const DivisionScale int32 = 16

var ErrDivisionByZero = errors.New("nutrition_engine: división entre cero")

var ulp = decimal.New(1, -DivisionScale)

// Div divide a/b a DivisionScale decimales con Round Half Even.
//
// shopspring/decimal.DivRound redondea la mitad alejándose de cero, así que el
// redondeo se resuelve aquí a partir del cociente truncado y el residuo exacto,
// sin pasar por un redondeo intermedio que podría sesgar los empates.
func Div(a, b decimal.Decimal) (decimal.Decimal, error) {
	if b.IsZero() {
		return decimal.Decimal{}, ErrDivisionByZero
	}

	// a = b*q + r, con q truncado hacia cero a DivisionScale decimales.
	q, r := a.QuoRem(b, DivisionScale)
	if r.IsZero() {
		return q, nil
	}

	// Compara el residuo contra media unidad del último decimal: 2|r| vs |b|·10^-16.
	cmp := r.Abs().Mul(decimal.NewFromInt(2)).Cmp(b.Abs().Mul(ulp))

	roundAway := cmp > 0
	if cmp == 0 {
		// Empate exacto: se redondea hacia el dígito par.
		roundAway = q.Shift(DivisionScale).BigInt().Bit(0) == 1
	}
	if !roundAway {
		return q, nil
	}
	if a.Sign()*b.Sign() < 0 {
		return q.Sub(ulp), nil
	}
	return q.Add(ulp), nil
}
