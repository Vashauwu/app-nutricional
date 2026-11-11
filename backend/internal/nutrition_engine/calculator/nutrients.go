package calculator

import (
	"errors"

	"github.com/shopspring/decimal"
)

var (
	ErrNegativeQuantity = errors.New("nutrition_engine: la cantidad no puede ser negativa")
	ErrInvalidBasis     = errors.New("nutrition_engine: la base de composición debe ser mayor que cero")
	ErrInvalidServings  = errors.New("nutrition_engine: las porciones deben ser mayores que cero")
)

// Nutrients agrupa energía y macronutrientes. Se serializa como strings en
// JSON (comportamiento por defecto de shopspring/decimal), según §7.3.
type Nutrients struct {
	EnergyKcal     decimal.Decimal `json:"energy_kcal"`
	ProteinG       decimal.Decimal `json:"protein_g"`
	CarbohydratesG decimal.Decimal `json:"carbohydrates_g"`
	LipidsG        decimal.Decimal `json:"lipids_g"`
	FiberG         decimal.Decimal `json:"fiber_g"`
}

// Add suma exacta, sin redondeo.
func (n Nutrients) Add(o Nutrients) Nutrients {
	return Nutrients{
		EnergyKcal:     n.EnergyKcal.Add(o.EnergyKcal),
		ProteinG:       n.ProteinG.Add(o.ProteinG),
		CarbohydratesG: n.CarbohydratesG.Add(o.CarbohydratesG),
		LipidsG:        n.LipidsG.Add(o.LipidsG),
		FiberG:         n.FiberG.Add(o.FiberG),
	}
}

// Sum agrega nutrientes de ingredientes, platillos, tiempos de comida o días.
func Sum(items ...Nutrients) Nutrients {
	var total Nutrients
	for _, it := range items {
		total = total.Add(it)
	}
	return total
}

// ForQuantity calcula N_cantidad = N_base × Q_normalizada / Q_base (§30.6).
//
// Multiplica primero y divide al final, de modo que cada nutriente pasa por
// una sola división (y un solo redondeo).
func ForQuantity(base Nutrients, basisQuantity, normalizedQuantity decimal.Decimal) (Nutrients, error) {
	if basisQuantity.Sign() <= 0 {
		return Nutrients{}, ErrInvalidBasis
	}
	if normalizedQuantity.Sign() < 0 {
		return Nutrients{}, ErrNegativeQuantity
	}
	return base.mapDiv(normalizedQuantity, basisQuantity)
}

// PerServing calcula N_porción = N_receta / porciones producidas (§30.6).
func PerServing(recipe Nutrients, servings decimal.Decimal) (Nutrients, error) {
	if servings.Sign() <= 0 {
		return Nutrients{}, ErrInvalidServings
	}
	return recipe.mapDiv(decimal.NewFromInt(1), servings)
}

func (n Nutrients) mapDiv(multiplier, divisor decimal.Decimal) (Nutrients, error) {
	var (
		out Nutrients
		err error
	)
	if out.EnergyKcal, err = Div(n.EnergyKcal.Mul(multiplier), divisor); err != nil {
		return Nutrients{}, err
	}
	if out.ProteinG, err = Div(n.ProteinG.Mul(multiplier), divisor); err != nil {
		return Nutrients{}, err
	}
	if out.CarbohydratesG, err = Div(n.CarbohydratesG.Mul(multiplier), divisor); err != nil {
		return Nutrients{}, err
	}
	if out.LipidsG, err = Div(n.LipidsG.Mul(multiplier), divisor); err != nil {
		return Nutrients{}, err
	}
	if out.FiberG, err = Div(n.FiberG.Mul(multiplier), divisor); err != nil {
		return Nutrients{}, err
	}
	return out, nil
}
