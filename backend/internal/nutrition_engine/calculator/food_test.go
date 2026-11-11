package calculator

import (
	"testing"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

func chicken() Food {
	return Food{
		Name: "Pollo", Official: true, BasisQuantity: d("100"), BasisUnit: "g",
		Base:        Nutrients{EnergyKcal: d("165"), ProteinG: d("31"), CarbohydratesG: d("0"), LipidsG: d("3.6")},
		Portions:    []Portion{{Unit: "pieza", Name: "Pieza mediana", Quantity: d("1"), GramsEquivalent: d("120")}},
		Equivalence: &Equivalence{SubgroupCode: "AOA-MB", ReferenceGrams: d("30"), EquivalentValue: d("1")},
	}
}

func milk() Food {
	dens := d("1.03")
	return Food{
		Name: "Leche", Official: true, BasisQuantity: d("100"), BasisUnit: "g", DensityGPerMl: &dens,
		Base:     Nutrients{EnergyKcal: d("35"), ProteinG: d("3.4"), CarbohydratesG: d("5"), LipidsG: d("0.1")},
		Portions: []Portion{{Unit: "taza", Name: "Taza", Quantity: d("1"), GramsEquivalent: d("247")}},
	}
}

func TestToGramsConvertsHouseholdMeasuresPerFood(t *testing.T) {
	g, err := ToGrams(chicken(), d("2"), "pieza")
	require.NoError(t, err)
	require.True(t, g.Equal(d("240")))
	g, err = ToGrams(milk(), d("240"), "ml")
	require.NoError(t, err)
	require.True(t, g.Equal(d("247.2")), "240 ml × 1.03 g/ml")
	g, err = ToGrams(chicken(), d("0.5"), "pieza")
	require.NoError(t, err)
	require.True(t, g.Equal(d("60")))
}

func TestToGramsRejectsInvalidConversions(t *testing.T) {
	_, err := ToGrams(chicken(), d("100"), "ml")
	require.ErrorIs(t, err, ErrNoDensity, "no se convierte masa↔volumen sin densidad")
	_, err = ToGrams(chicken(), d("1"), "taza")
	require.ErrorIs(t, err, ErrUnitNotAllowed)
	_, err = ToGrams(chicken(), d("-1"), "g")
	require.ErrorIs(t, err, ErrInvalidQuantity)
}

func TestCalcIngredientAndEquivalents(t *testing.T) {
	r, err := CalcIngredient(chicken(), d("60"), "g")
	require.NoError(t, err)
	require.True(t, r.Nutrients.EnergyKcal.Equal(d("99")))
	require.True(t, r.Nutrients.ProteinG.Equal(d("18.6")))
	require.True(t, r.HasEquivalent)
	require.Equal(t, "AOA-MB", r.EquivalentCode)
	require.True(t, r.EquivalentValue.Equal(d("2")), "60 g / 30 g = 2 equivalentes")
	require.True(t, r.Grams.Equal(d("60")))
}

func TestCustomFoodWithoutEquivalenceHasNone(t *testing.T) {
	f := chicken()
	f.Official, f.Equivalence = false, nil
	r, err := CalcIngredient(f, d("100"), "g")
	require.NoError(t, err)
	require.False(t, r.HasEquivalent)
	require.False(t, r.Official)
}

func TestCalcDishDividesWithSixteenDecimalsHalfEven(t *testing.T) {
	oat := Food{Name: "Avena", Official: true, BasisQuantity: d("100"), BasisUnit: "g", Base: Nutrients{EnergyKcal: d("389")}}
	r, err := CalcIngredient(oat, d("100"), "g")
	require.NoError(t, err)
	res, err := CalcDish([]IngredientResult{r}, d("3"))
	require.NoError(t, err)
	require.Equal(t, "389", res.Totals.EnergyKcal.String(), "los totales no se redondean")
	require.Equal(t, "129.6666666666666667", res.PerServing.EnergyKcal.String())
}

func TestCalcDishAggregatesAndFlagsCustomFoods(t *testing.T) {
	a, _ := CalcIngredient(chicken(), d("60"), "g")
	b, _ := CalcIngredient(chicken(), d("30"), "g")
	custom := chicken()
	custom.Official, custom.Equivalence = false, nil
	c, _ := CalcIngredient(custom, d("10"), "g")
	res, err := CalcDish([]IngredientResult{a, b, c}, d("1"))
	require.NoError(t, err)
	require.True(t, res.Equivalents["AOA-MB"].Equal(d("3")))
	require.True(t, res.HasCustom)
	_, err = CalcDish(nil, decimal.Zero)
	require.ErrorIs(t, err, ErrInvalidServings)
}

func TestFiberIsCarriedThroughSumAndPerServing(t *testing.T) {
	f := Food{Name: "Frijol", Official: true, BasisQuantity: d("100"), BasisUnit: "g", Base: Nutrients{FiberG: d("6.4")}}
	r, _ := CalcIngredient(f, d("170"), "g")
	require.True(t, r.Nutrients.FiberG.Equal(d("10.88")))
	res, _ := CalcDish([]IngredientResult{r}, d("2"))
	require.True(t, res.PerServing.FiberG.Equal(d("5.44")))
}
