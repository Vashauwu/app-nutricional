package calculator

import (
	"errors"
	"fmt"

	"github.com/shopspring/decimal"
)

var (
	ErrUnitNotAllowed   = errors.New("nutrition_engine: unidad no definida para este alimento")
	ErrNoDensity        = errors.New("nutrition_engine: no se puede convertir ml a g sin densidad del alimento")
	ErrInvalidQuantity  = errors.New("nutrition_engine: la cantidad debe ser un número mayor o igual a cero")
	ErrInvalidReference = errors.New("nutrition_engine: gramos de referencia de equivalencia inválidos")
)

// Portion es una medida casera de un alimento concreto (no se asume que una taza pese lo mismo en todos, §30.4).
type Portion struct {
	Unit            string
	Name            string
	Quantity        decimal.Decimal
	GramsEquivalent decimal.Decimal
}

// Equivalence indica cuántos gramos equivalen a EquivalentValue equivalentes del subgrupo.
type Equivalence struct {
	SubgroupCode    string
	ReferenceGrams  decimal.Decimal
	EquivalentValue decimal.Decimal
}

// Food es un alimento SMAE o personalizado, con la composición para una cantidad base.
type Food struct {
	Name          string
	Official      bool
	Portions      []Portion
	BasisQuantity decimal.Decimal
	BasisUnit     string // "g" o "ml"
	Base          Nutrients
	DensityGPerMl *decimal.Decimal
	Equivalence   *Equivalence
}

// IngredientResult conserva la cantidad capturada y la normalizada (§30.4) junto con el resultado.
type IngredientResult struct {
	Quantity        decimal.Decimal
	Unit            string
	Grams           decimal.Decimal
	Nutrients       Nutrients
	EquivalentCode  string
	EquivalentValue decimal.Decimal
	HasEquivalent   bool
	Official        bool
}

// ToGrams normaliza una cantidad a gramos. Rechaza conversiones dimensionalmente inválidas.
func ToGrams(f Food, qty decimal.Decimal, unit string) (decimal.Decimal, error) {
	if qty.IsNegative() {
		return decimal.Zero, ErrInvalidQuantity
	}
	switch unit {
	case "g":
		return qty, nil
	case "ml":
		if f.DensityGPerMl == nil {
			return decimal.Zero, fmt.Errorf("%w: %s", ErrNoDensity, f.Name)
		}
		return qty.Mul(*f.DensityGPerMl), nil
	}
	for _, p := range f.Portions {
		if p.Unit == unit {
			per, err := Div(qty, p.Quantity)
			if err != nil {
				return decimal.Zero, err
			}
			return per.Mul(p.GramsEquivalent), nil
		}
	}
	return decimal.Zero, fmt.Errorf("%w: %q en %s", ErrUnitNotAllowed, unit, f.Name)
}

// CalcIngredient calcula nutrientes proporcionales a la base de composición y los equivalentes.
func CalcIngredient(f Food, qty decimal.Decimal, unit string) (IngredientResult, error) {
	grams, err := ToGrams(f, qty, unit)
	if err != nil {
		return IngredientResult{}, err
	}
	norm := grams
	if f.BasisUnit == "ml" {
		if f.DensityGPerMl == nil {
			return IngredientResult{}, fmt.Errorf("%w: %s", ErrNoDensity, f.Name)
		}
		if norm, err = Div(grams, *f.DensityGPerMl); err != nil {
			return IngredientResult{}, err
		}
	}
	n, err := ForQuantity(f.Base, f.BasisQuantity, norm)
	if err != nil {
		return IngredientResult{}, err
	}
	r := IngredientResult{Quantity: qty, Unit: unit, Grams: grams, Nutrients: n, Official: f.Official}
	if eq := f.Equivalence; eq != nil {
		if eq.ReferenceGrams.Sign() <= 0 {
			return IngredientResult{}, ErrInvalidReference
		}
		per, err := Div(grams, eq.ReferenceGrams)
		if err != nil {
			return IngredientResult{}, err
		}
		r.EquivalentCode, r.EquivalentValue, r.HasEquivalent = eq.SubgroupCode, per.Mul(eq.EquivalentValue), true
	}
	return r, nil
}

// DishResult es el resultado reproducible de un platillo (§30.5).
type DishResult struct {
	Totals     Nutrients
	PerServing Nutrients
	// Equivalents por porción, por código de subgrupo.
	Equivalents map[string]decimal.Decimal
	HasCustom   bool
}

// CalcDish suma ingredientes (exacto) y divide entre las porciones (16 decimales, Round Half Even).
func CalcDish(ings []IngredientResult, servings decimal.Decimal) (DishResult, error) {
	if servings.Sign() <= 0 {
		return DishResult{}, ErrInvalidServings
	}
	var res DishResult
	res.Equivalents = map[string]decimal.Decimal{}
	totals := map[string]decimal.Decimal{}
	all := make([]Nutrients, 0, len(ings))
	for _, i := range ings {
		all = append(all, i.Nutrients)
		if !i.Official {
			res.HasCustom = true
		}
		if i.HasEquivalent {
			totals[i.EquivalentCode] = totals[i.EquivalentCode].Add(i.EquivalentValue)
		}
	}
	res.Totals = Sum(all...)
	per, err := PerServing(res.Totals, servings)
	if err != nil {
		return DishResult{}, err
	}
	res.PerServing = per
	for code, v := range totals {
		if res.Equivalents[code], err = Div(v, servings); err != nil {
			return DishResult{}, err
		}
	}
	return res, nil
}
