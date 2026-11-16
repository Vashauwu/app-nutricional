package dietocalculo

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func base() Inputs {
	return Inputs{Sex: "F", Age: 27, WeightKg: 55, HeightCm: 173, Activity: "light", Formula: "mifflin", Goal: "maintain",
		Macros: Macros{CarbsPct: 55, LipidsPct: 25, ProteinPct: 20}}
}

func TestBMIClassNOM008(t *testing.T) {
	require.Equal(t, "Bajo peso", BMIClass(18.4, 173, "F").Label)
	require.Equal(t, "Peso normal", BMIClass(24.9, 173, "F").Label)
	require.Equal(t, "Sobrepeso", BMIClass(27, 173, "F").Label)
	require.Equal(t, "Obesidad grado I", BMIClass(32, 173, "M").Label)
	require.Equal(t, "Obesidad grado III", BMIClass(41, 173, "M").Label)
	// Estatura baja: sobrepeso desde 23.
	require.Equal(t, "Sobrepeso", BMIClass(23.5, 148, "F").Label)
	require.Equal(t, "Peso normal", BMIClass(23.5, 165, "F").Label)
}

func TestKnownFormulas(t *testing.T) {
	r := Compute(base())
	// Mifflin mujer: 10*55 + 6.25*173 − 5*27 − 161 = 1335.25 → 1335
	require.Equal(t, 1335.0, r.Energy.BMR)
	require.Equal(t, 18.4, r.Anthro.BMI)
	require.Equal(t, 1.63, r.Anthro.BSAMosteller) // √(173·55/3600)
	// TEE = 1335.25 × 1.375 = 1836 → prescripción redondeada a 10.
	require.Equal(t, 1840.0, r.Energy.Prescription)

	h := base()
	h.Formula, h.Sex = "harris", "M"
	require.Equal(t, 1502.0, Compute(h).Energy.BMR) // 88.362+13.397·55+4.799·173−5.677·27
	f := base()
	f.Formula = "fao"
	require.Equal(t, 1302.0, Compute(f).Energy.BMR) // 14.818·55+486.6
}

func TestEnergyAdjustments(t *testing.T) {
	in := base()
	in.Lactation = "0-6"
	in.AdjustKcal = -100
	r := Compute(in)
	require.Equal(t, 330.0, r.Energy.Lactation)
	require.Equal(t, 2070.0, r.Energy.Prescription) // 1836 + 330 − 100 = 2066 → 2070

	in = base()
	in.KcalTarget = 2000
	require.Equal(t, 2000.0, Compute(in).Energy.Prescription)
}

func TestPregnancy(t *testing.T) {
	in := base()
	in.Pregnancy = &Pregnancy{Weeks: 30, PreWeightKg: 54}
	r := Compute(in)
	require.NotNil(t, r.Pregnancy)
	require.Equal(t, 3, r.Pregnancy.Trimester)
	require.Equal(t, 452.0, r.Pregnancy.ExtraKcal)
	require.Equal(t, "Bajo peso", r.Pregnancy.PreBMIClass)
	require.Equal(t, 12.5, r.Pregnancy.GainMinTotal)
	require.Equal(t, 1.0, r.Pregnancy.CurrentGain)
	require.Equal(t, 452.0, r.Energy.Pregnancy)

	in.Sex = "M"
	require.Contains(t, in.Normalize(), "pregnancy")
}

func TestCuadroDietosintetico(t *testing.T) {
	in := base()
	in.KcalTarget = 2000
	in.Macros = Macros{CarbsPct: 55, LipidsPct: 25, ProteinPct: 20}
	r := Compute(in)
	d := r.Dietosint
	require.InDelta(t, 2000, d.Target.Kcal, 0.01)
	// El cuadro debe quedar a ±5 % de la prescripción y con múltiplos de 0.5.
	require.Less(t, abs(d.DiffPct), 5.0, "desvío %v", d.DiffPct)
	for _, row := range d.Rows {
		require.InDelta(t, row.Eq*2, float64(int(row.Eq*2)), 1e-9, row.Code)
	}
	// Las filas suman exactamente los totales.
	sum := 0.0
	for _, row := range d.Rows {
		sum += row.Kcal
	}
	require.InDelta(t, d.Totals.Kcal, sum, 0.11)
}

func TestEquivalentsOverride(t *testing.T) {
	in := base()
	in.KcalTarget = 1800
	in.Equivalents = map[string]float64{"FRU": 5, "VER": 6}
	r := Compute(in)
	got := map[string]GroupRow{}
	for _, x := range r.Dietosint.Rows {
		got[x.Code] = x
	}
	require.Equal(t, 5.0, got["FRU"].Eq)
	require.True(t, got["FRU"].Fixed)
	require.Equal(t, 6.0, got["VER"].Eq)
}

func TestDistributionSumsEqualCuadro(t *testing.T) {
	in := base()
	in.KcalTarget = 2200
	r := Compute(in)
	for _, row := range r.Dietosint.Rows {
		s := 0.0
		for _, sl := range r.Distribution {
			s += sl.Eq[row.Code]
		}
		require.InDelta(t, row.Eq, s, 1e-9, row.Code)
	}
	// Sin colaciones: nada se asigna a los tiempos con 0 %.
	in.Slots = []Slot{{"Desayuno", 30}, {"Colación matutina", 0}, {"Comida", 40}, {"Colación vespertina", 0}, {"Cena", 30}}
	r = Compute(in)
	require.Empty(t, r.Distribution[1].Eq)
	require.Empty(t, r.Distribution[3].Eq)
}

func TestValidation(t *testing.T) {
	in := base()
	in.Age, in.WeightKg = 5, 5
	in.Macros = Macros{CarbsPct: 50, LipidsPct: 30, ProteinPct: 30}
	e := in.Normalize()
	require.Contains(t, e, "age")
	require.Contains(t, e, "weight_kg")
	require.Contains(t, e, "macros")
	ok := base()
	require.Nil(t, ok.Normalize())
}

func TestBodyComposition(t *testing.T) {
	in := base()
	in.BodyFatPct = 20
	in.TargetFat = 15
	r := Compute(in)
	require.Equal(t, "captured", r.Composition.FatSource)
	require.Equal(t, 11.0, r.Composition.FatMassKg)
	require.Equal(t, 44.0, r.Composition.LeanMassKg)
	require.Equal(t, 51.8, r.Composition.TargetWeight) // 44 / 0.85
	in2 := base()
	in2.WaistCm, in2.NeckCm, in2.HipCm = 70, 30, 95
	require.Equal(t, "navy", Compute(in2).Composition.FatSource)
	require.Equal(t, "deurenberg", Compute(base()).Composition.FatSource)
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// Vectores de referencia compartidos con el frontend (engine.golden.json). UPDATE_GOLDEN=1 los regenera.
func goldenCases() []Inputs {
	a := base()
	b := base()
	b.Sex, b.Age, b.WeightKg, b.HeightCm, b.Activity, b.Formula = "M", 35, 82, 178, "moderate", "harris"
	b.WaistCm, b.HipCm, b.NeckCm, b.WristCm = 92, 100, 38, 17.5
	b.Macros = Macros{CarbsPct: 50, LipidsPct: 30, ProteinPct: 20}
	c := base()
	c.Pregnancy, c.WeightKg = &Pregnancy{Weeks: 20, PreWeightKg: 58}, 62
	d := base()
	d.Lactation, d.Formula, d.BodyFatPct = "7-12", "katch", 24
	e := base()
	e.Sex, e.Age, e.WeightKg, e.HeightCm, e.Hospital, e.Stress, e.Amputations = "M", 68, 70, 168, true, 1.3, []string{"below_knee"}
	e.Formula = "fao"
	g := base()
	g.KcalTarget, g.Equivalents = 1600, map[string]float64{"CER": 6, "GRA": 3}
	g.Slots = []Slot{{"Desayuno", 30}, {"Colación matutina", 0}, {"Comida", 40}, {"Colación vespertina", 0}, {"Cena", 30}}
	h := base()
	h.Sex, h.WeightKg, h.HeightCm, h.Age, h.Athlete, h.Thermic, h.AdjustKcal = "M", 95, 185, 24, true, true, 300
	return []Inputs{a, b, c, d, e, g, h}
}

type goldenCase struct {
	In  Inputs `json:"in"`
	Out Result `json:"out"`
}

func TestGolden(t *testing.T) {
	var cases []goldenCase
	for _, in := range goldenCases() {
		require.Nil(t, in.Normalize())
		cases = append(cases, goldenCase{in, Compute(in)})
	}
	got, err := json.MarshalIndent(cases, "", " ")
	require.NoError(t, err)
	got = append(got, '\n')
	if os.Getenv("UPDATE_GOLDEN") != "" {
		require.NoError(t, os.WriteFile("testdata/golden.json", got, 0o644))
		_ = os.WriteFile("../../../frontend/src/app/features/dietocalculo/engine.golden.json", got, 0o644)
	}
	want, err := os.ReadFile("testdata/golden.json")
	require.NoError(t, err)
	require.True(t, bytes.Equal(want, got), "golden.json desactualizado: ejecuta UPDATE_GOLDEN=1 go test ./internal/dietocalculo")
	// La copia del frontend (si existe) debe ser idéntica: ambos motores se prueban contra los mismos vectores.
	if fe, err := os.ReadFile("../../../frontend/src/app/features/dietocalculo/engine.golden.json"); err == nil {
		require.True(t, bytes.Equal(fe, got), "la copia del frontend difiere del golden del backend")
	}
}
