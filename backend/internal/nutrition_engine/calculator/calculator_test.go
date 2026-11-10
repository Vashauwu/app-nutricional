package calculator

import (
	"encoding/json"
	"testing"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func TestDiv(t *testing.T) {
	cases := []struct {
		name, a, b, want string
	}{
		{"exacta", "1", "4", "0.25"},
		{"periódica hacia abajo", "1", "3", "0.3333333333333333"},
		{"periódica hacia arriba", "2", "3", "0.6666666666666667"},
		// 1/2^17 = 0.00000762939453125: empate, dígito previo par (2) → se queda.
		{"empate a par, se queda", "1", "131072", "0.0000076293945312"},
		// 3/2^17 = 0.00002288818359375: empate, dígito previo impar (7) → sube.
		{"empate a par, sube", "3", "131072", "0.0000228881835938"},
		{"negativo periódico", "-2", "3", "-0.6666666666666667"},
		{"empate negativo, se queda", "-1", "131072", "-0.0000076293945312"},
		{"empate negativo, sube en magnitud", "3", "-131072", "-0.0000228881835938"},
		{"divisor decimal", "100", "0.3", "333.3333333333333333"},
		{"cero", "0", "7", "0"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Div(d(c.a), d(c.b))
			require.NoError(t, err)
			assert.True(t, d(c.want).Equal(got), "esperado %s, obtenido %s", c.want, got)
		})
	}
}

func TestDivByZero(t *testing.T) {
	_, err := Div(d("1"), d("0"))
	assert.ErrorIs(t, err, ErrDivisionByZero)
}

func TestSumAndMultiplyAreExact(t *testing.T) {
	total := Sum(
		Nutrients{EnergyKcal: d("0.1")},
		Nutrients{EnergyKcal: d("0.2")},
	)
	assert.Equal(t, "0.3", total.EnergyKcal.String())

	third := d("0.3333333333333333")
	assert.Equal(t, "0.11111111111111108888888888888889", third.Mul(third).String())
}

// Datos sintéticos de prueba; no provienen del catálogo SMAE.
func TestForQuantityAndPerServing(t *testing.T) {
	base := Nutrients{EnergyKcal: d("120"), ProteinG: d("7.5"), CarbohydratesG: d("20"), LipidsG: d("1")}

	got, err := ForQuantity(base, d("100"), d("150"))
	require.NoError(t, err)
	assert.Equal(t, "180", got.EnergyKcal.String())
	assert.Equal(t, "11.25", got.ProteinG.String())

	recipe := Sum(got, got)
	portion, err := PerServing(recipe, d("3"))
	require.NoError(t, err)
	assert.Equal(t, "120", portion.EnergyKcal.String())
	assert.Equal(t, "7.5", portion.ProteinG.String())
	assert.Equal(t, "1", portion.LipidsG.String())

	// Resultado periódico: la división es el único punto donde se redondea.
	ninth, err := PerServing(recipe, d("9"))
	require.NoError(t, err)
	assert.Equal(t, "0.3333333333333333", ninth.LipidsG.String())
	assert.Equal(t, "6.6666666666666667", ninth.CarbohydratesG.String()) // 60 / 9
}

func TestRejectsInvalidInput(t *testing.T) {
	base := Nutrients{EnergyKcal: d("100")}

	_, err := ForQuantity(base, d("0"), d("10"))
	assert.ErrorIs(t, err, ErrInvalidBasis)

	_, err = ForQuantity(base, d("100"), d("-1"))
	assert.ErrorIs(t, err, ErrNegativeQuantity)

	_, err = PerServing(base, d("0"))
	assert.ErrorIs(t, err, ErrInvalidServings)
}

func TestJSONSerializesDecimalsAsStrings(t *testing.T) {
	b, err := json.Marshal(Nutrients{EnergyKcal: d("180.50"), ProteinG: d("11.25")})
	require.NoError(t, err)
	assert.JSONEq(t,
		`{"energy_kcal":"180.5","protein_g":"11.25","carbohydrates_g":"0","lipids_g":"0"}`,
		string(b))
}
