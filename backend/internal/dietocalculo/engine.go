// Package dietocalculo es el motor de cálculo dietético: antropometría, gasto energético, prescripción de
// macronutrimentos, cuadro dietosintético (equivalentes SMAE por grupo) y su distribución por tiempo de comida.
//
// Todo está implementado a partir de fórmulas y tablas publicadas (Mifflin-St Jeor, Harris-Benedict revisada,
// FAO/OMS/UNU 1985, Katch-McArdle, Cunningham, NOM-008-SSA3-2017, Mosteller, Du Bois, IOM 2005/2009 para embarazo
// y lactancia, y los aportes por equivalente del SMAE). El frontend replica este motor en TypeScript para dar
// resultados al instante; los vectores de `testdata/golden.json` aseguran que ambos coincidan.
package dietocalculo

import (
	"math"
	"sort"
)

// ---------- Entradas ----------

type Macros struct {
	CarbsPct   float64 `json:"carbs_pct"`
	LipidsPct  float64 `json:"lipids_pct"`
	ProteinPct float64 `json:"protein_pct"`
}

type Pregnancy struct {
	Weeks        int     `json:"weeks"`
	PreWeightKg  float64 `json:"pre_weight_kg,omitempty"`
	MultiplePreg bool    `json:"multiple,omitempty"`
}

type Slot struct {
	Name string  `json:"name"`
	Pct  float64 `json:"pct"`
}

type Inputs struct {
	Sex         string  `json:"sex"` // "F" | "M"
	Age         float64 `json:"age"`
	WeightKg    float64 `json:"weight_kg"`
	HeightCm    float64 `json:"height_cm"`
	BodyFatPct  float64 `json:"body_fat_pct,omitempty"`
	WaistCm     float64 `json:"waist_cm,omitempty"`
	HipCm       float64 `json:"hip_cm,omitempty"`
	NeckCm      float64 `json:"neck_cm,omitempty"`
	WristCm     float64 `json:"wrist_cm,omitempty"`
	KneeHeightC float64 `json:"knee_height_cm,omitempty"`
	TargetFat   float64 `json:"target_fat_pct,omitempty"`

	Activity string  `json:"activity"` // sedentary|light|moderate|intense|very_intense
	Formula  string  `json:"formula"`  // mifflin|harris|fao|katch|cunningham
	Thermic  bool    `json:"thermic"`  // suma efecto térmico de los alimentos (10 %)
	Athlete  bool    `json:"athlete"`
	Hospital bool    `json:"hospitalized"`
	Stress   float64 `json:"stress_factor,omitempty"` // factor de estrés (hospitalizado), 1.0–2.0
	// Amputaciones: segmentos perdidos (ver AmputationPct).
	Amputations []string `json:"amputations,omitempty"`

	Pregnancy *Pregnancy `json:"pregnancy,omitempty"`
	Lactation string     `json:"lactation,omitempty"` // "" | "0-6" | "7-12"

	Goal       string  `json:"goal"`                  // maintain|lose|gain
	AdjustKcal float64 `json:"adjust_kcal,omitempty"` // déficit (−) o superávit (+) sobre el gasto
	KcalTarget float64 `json:"kcal_target,omitempty"` // si > 0, sustituye a la prescripción calculada

	Macros Macros `json:"macros"`
	// Equivalentes fijados a mano por la nutrióloga (código de grupo → equivalentes). El resto se calcula.
	Equivalents map[string]float64 `json:"equivalents,omitempty"`
	Slots       []Slot             `json:"slots,omitempty"`
}

// ---------- Resultados ----------

type Classification struct {
	Label string `json:"label"`
	Tone  string `json:"tone"` // ok | warn | critical | info
	Note  string `json:"note,omitempty"`
}

type Anthro struct {
	WeightUsedKg   float64         `json:"weight_used_kg"` // peso corregido por amputación
	BMI            float64         `json:"bmi"`
	BMIClass       Classification  `json:"bmi_class"`
	IdealWeightKg  float64         `json:"ideal_weight_kg"`
	BSAMosteller   float64         `json:"bsa_mosteller"`
	BSADuBois      float64         `json:"bsa_dubois"`
	WaistHip       float64         `json:"waist_hip,omitempty"`
	WaistHipClass  *Classification `json:"waist_hip_class,omitempty"`
	WaistHeight    float64         `json:"waist_height,omitempty"`
	WaistHeightCls *Classification `json:"waist_height_class,omitempty"`
	WaistClass     *Classification `json:"waist_class,omitempty"`
	StatureChumlea float64         `json:"stature_chumlea_cm,omitempty"`
	FrameRatio     float64         `json:"frame_ratio,omitempty"`
	Frame          string          `json:"frame,omitempty"`
}

type Composition struct {
	FatPct       float64 `json:"fat_pct"`
	FatSource    string  `json:"fat_source"` // captured | navy | deurenberg
	FatMassKg    float64 `json:"fat_mass_kg"`
	LeanMassKg   float64 `json:"lean_mass_kg"`
	TargetFatPct float64 `json:"target_fat_pct,omitempty"`
	TargetWeight float64 `json:"target_weight_kg,omitempty"`
}

type Energy struct {
	Formula      string  `json:"formula"`
	FormulaUsed  string  `json:"formula_used"` // puede diferir si faltan datos (p. ej. Katch sin % de grasa)
	BMR          float64 `json:"bmr"`
	ActivityF    float64 `json:"activity_factor"`
	TEE          float64 `json:"tee"` // gasto energético total
	Thermic      float64 `json:"thermic_kcal"`
	Stress       float64 `json:"stress_factor,omitempty"`
	Pregnancy    float64 `json:"pregnancy_kcal"`
	Lactation    float64 `json:"lactation_kcal"`
	Adjust       float64 `json:"adjust_kcal"`
	Prescription float64 `json:"prescription_kcal"`
}

type PregnancyInfo struct {
	Trimester     int     `json:"trimester"`
	PreBMI        float64 `json:"pre_bmi"`
	PreBMIClass   string  `json:"pre_bmi_class"`
	GainMinTotal  float64 `json:"gain_min_total_kg"`
	GainMaxTotal  float64 `json:"gain_max_total_kg"`
	GainMinNow    float64 `json:"gain_min_now_kg"`
	GainMaxNow    float64 `json:"gain_max_now_kg"`
	CurrentGain   float64 `json:"current_gain_kg,omitempty"`
	GainStatus    string  `json:"gain_status,omitempty"`
	ExtraKcal     float64 `json:"extra_kcal"`
	Source        string  `json:"source"`
	PreBMIAssumed bool    `json:"pre_bmi_assumed"`
}

type MacroTargets struct {
	Kcal       float64 `json:"kcal"`
	CarbsG     float64 `json:"carbs_g"`
	ProteinG   float64 `json:"protein_g"`
	LipidsG    float64 `json:"lipids_g"`
	CarbsPct   float64 `json:"carbs_pct"`
	ProteinPct float64 `json:"protein_pct"`
	LipidsPct  float64 `json:"lipids_pct"`
	ProteinGKg float64 `json:"protein_g_per_kg"`
}

// GroupRow es una fila del cuadro dietosintético.
type GroupRow struct {
	Code  string  `json:"code"`
	Name  string  `json:"name"`
	Eq    float64 `json:"equivalents"`
	Kcal  float64 `json:"kcal"`
	Carbs float64 `json:"carbs_g"`
	Prot  float64 `json:"protein_g"`
	Lip   float64 `json:"lipids_g"`
	Fixed bool    `json:"fixed,omitempty"` // fijado por la nutrióloga
}

type Totals struct {
	Kcal  float64 `json:"kcal"`
	Carbs float64 `json:"carbs_g"`
	Prot  float64 `json:"protein_g"`
	Lip   float64 `json:"lipids_g"`
}

type Dietosintetico struct {
	Rows     []GroupRow `json:"rows"`
	Totals   Totals     `json:"totals"`
	Target   Totals     `json:"target"`
	DiffKcal float64    `json:"diff_kcal"`
	DiffPct  float64    `json:"diff_pct"`
	AOAKind  string     `json:"aoa_kind"` // código del subgrupo de AOA elegido
}

type SlotRow struct {
	Name   string             `json:"name"`
	Pct    float64            `json:"pct"`
	Eq     map[string]float64 `json:"equivalents"` // código → equivalentes (solo > 0)
	Totals Totals             `json:"totals"`
	// Diferencia contra el objetivo energético del tiempo de comida.
	TargetKcal float64 `json:"target_kcal"`
	DiffKcal   float64 `json:"diff_kcal"`
}

type Warning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Level   string `json:"level"` // info | warn | critical
}

type Result struct {
	Anthro       Anthro         `json:"anthro"`
	Composition  Composition    `json:"composition"`
	Energy       Energy         `json:"energy"`
	Pregnancy    *PregnancyInfo `json:"pregnancy,omitempty"`
	Macros       MacroTargets   `json:"macros"`
	Dietosint    Dietosintetico `json:"dietosintetico"`
	Distribution []SlotRow      `json:"distribution"`
	Warnings     []Warning      `json:"warnings"`
	EngineVer    string         `json:"engine_version"`
}

const EngineVersion = "1.0.0"

// ---------- Utilidades ----------

func r1(x float64) float64 { return math.Round(x*10) / 10 }
func r2(x float64) float64 { return math.Round(x*100) / 100 }
func r0(x float64) float64 { return math.Round(x) }

// halves redondea al medio equivalente más cercano (0, 0.5, 1, 1.5…).
func halves(x float64) float64 { return math.Round(x*2) / 2 }

// ---------- Antropometría ----------

// BMIClass clasifica el IMC según la NOM-008-SSA3-2017. En estatura baja (< 1.50 m mujeres, < 1.60 m hombres)
// los puntos de corte de sobrepeso y obesidad bajan a 23 y 25 kg/m².
func BMIClass(bmi, heightCm float64, sex string) Classification {
	low := (sex == "F" && heightCm < 150) || (sex == "M" && heightCm < 160)
	over, obese := 25.0, 30.0
	note := ""
	if low {
		over, obese = 23, 25
		note = "Estatura baja: la NOM-008 usa 23 y 25 kg/m² como puntos de corte."
	}
	switch {
	case bmi < 18.5:
		return Classification{"Bajo peso", "warn", note}
	case bmi < over:
		return Classification{"Peso normal", "ok", note}
	case bmi < obese:
		return Classification{"Sobrepeso", "warn", note}
	case bmi < 35:
		return Classification{"Obesidad grado I", "critical", note}
	case bmi < 40:
		return Classification{"Obesidad grado II", "critical", note}
	default:
		return Classification{"Obesidad grado III", "critical", note}
	}
}

// Segmentos amputados y % del peso corporal que representan (Osterkamp 1995).
var AmputationPct = map[string]float64{
	"hand": 0.7, "forearm_hand": 3.0, "arm_total": 5.0, "foot": 1.5, "below_knee": 5.9, "whole_leg": 16.0,
}

func correctedWeight(w float64, amps []string) float64 {
	total := 0.0
	for _, a := range amps {
		total += AmputationPct[a]
	}
	if total <= 0 || total >= 60 {
		return w
	}
	return w / (1 - total/100)
}

// idealWeight usa la fórmula de Devine (1974).
func idealWeight(h float64, sex string) float64 {
	inches := h / 2.54
	over := math.Max(0, inches-60)
	if sex == "M" {
		return 50 + 2.3*over
	}
	return 45.5 + 2.3*over
}

func bodyFatNavy(in Inputs) (float64, bool) {
	if in.WaistCm <= 0 || in.NeckCm <= 0 || in.HeightCm <= 0 {
		return 0, false
	}
	if in.Sex == "M" {
		d := in.WaistCm - in.NeckCm
		if d <= 0 {
			return 0, false
		}
		return 495/(1.0324-0.19077*math.Log10(d)+0.15456*math.Log10(in.HeightCm)) - 450, true
	}
	if in.HipCm <= 0 {
		return 0, false
	}
	d := in.WaistCm + in.HipCm - in.NeckCm
	if d <= 0 {
		return 0, false
	}
	return 495/(1.29579-0.35004*math.Log10(d)+0.22100*math.Log10(in.HeightCm)) - 450, true
}

func computeAnthro(in Inputs) Anthro {
	w := correctedWeight(in.WeightKg, in.Amputations)
	hm := in.HeightCm / 100
	bmi := w / (hm * hm)
	a := Anthro{
		WeightUsedKg:  r1(w),
		BMI:           r1(bmi),
		BMIClass:      BMIClass(bmi, in.HeightCm, in.Sex),
		IdealWeightKg: r1(idealWeight(in.HeightCm, in.Sex)),
		BSAMosteller:  r2(math.Sqrt(in.HeightCm * w / 3600)),
		BSADuBois:     r2(0.007184 * math.Pow(w, 0.425) * math.Pow(in.HeightCm, 0.725)),
	}
	if in.WaistCm > 0 {
		wl, wt := 80.0, "Riesgo cardiometabólico por cintura (≥ 80 cm en mujeres)"
		if in.Sex == "M" {
			wl, wt = 90, "Riesgo cardiometabólico por cintura (≥ 90 cm en hombres)"
		}
		c := Classification{"Cintura sin riesgo", "ok", ""}
		if in.WaistCm >= wl {
			c = Classification{"Obesidad abdominal", "warn", wt}
		}
		a.WaistClass = &c
		a.WaistHeight = r2(in.WaistCm / in.HeightCm)
		wh := Classification{"ICT < 0.50", "ok", ""}
		if a.WaistHeight >= 0.5 {
			wh = Classification{"ICT ≥ 0.50", "warn", "Riesgo por distribución de grasa central."}
		}
		a.WaistHeightCls = &wh
	}
	if in.WaistCm > 0 && in.HipCm > 0 {
		a.WaistHip = r2(in.WaistCm / in.HipCm)
		lim := 0.85
		if in.Sex == "M" {
			lim = 0.90
		}
		c := Classification{"ICC sin riesgo", "ok", ""}
		if a.WaistHip > lim {
			c = Classification{"ICC elevado", "warn", "Riesgo cardiovascular por distribución central."}
		}
		a.WaistHipClass = &c
	}
	if in.KneeHeightC > 0 && in.Age > 0 {
		// Chumlea (1985): estatura estimada con altura de rodilla, para pacientes que no pueden ponerse de pie.
		if in.Sex == "M" {
			a.StatureChumlea = r1(64.19 - 0.04*in.Age + 2.02*in.KneeHeightC)
		} else {
			a.StatureChumlea = r1(84.88 - 0.24*in.Age + 1.83*in.KneeHeightC)
		}
	}
	if in.WristCm > 0 {
		// Complexión por r = estatura / circunferencia de muñeca (Grant et al.).
		r := in.HeightCm / in.WristCm
		a.FrameRatio = r2(r)
		small, large := 11.0, 10.1
		if in.Sex == "M" {
			small, large = 10.4, 9.6
		}
		switch {
		case r > small:
			a.Frame = "Complexión pequeña"
		case r < large:
			a.Frame = "Complexión grande"
		default:
			a.Frame = "Complexión mediana"
		}
	}
	return a
}

func computeComposition(in Inputs, w float64) Composition {
	pct, src := 0.0, ""
	switch {
	case in.BodyFatPct > 0:
		pct, src = in.BodyFatPct, "captured"
	default:
		if n, ok := bodyFatNavy(in); ok && n > 2 && n < 60 {
			pct, src = n, "navy"
		} else {
			bmi := w / math.Pow(in.HeightCm/100, 2)
			male := 0.0
			if in.Sex == "M" {
				male = 1
			}
			// Deurenberg (1991): estimación a partir del IMC, la edad y el sexo.
			pct, src = 1.2*bmi+0.23*in.Age-10.8*male-5.4, "deurenberg"
		}
	}
	pct = math.Max(3, math.Min(60, pct))
	fat := w * pct / 100
	c := Composition{FatPct: r1(pct), FatSource: src, FatMassKg: r1(fat), LeanMassKg: r1(w - fat)}
	if in.TargetFat > 0 && in.TargetFat < 60 {
		c.TargetFatPct = in.TargetFat
		c.TargetWeight = r1((w - fat) / (1 - in.TargetFat/100))
	}
	return c
}

// ---------- Energía ----------

var activityFactor = map[string]float64{"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "intense": 1.725, "very_intense": 1.9}

func bmrFor(formula string, in Inputs, w, lean float64) (float64, string) {
	male := in.Sex == "M"
	switch formula {
	case "harris":
		if male {
			return 88.362 + 13.397*w + 4.799*in.HeightCm - 5.677*in.Age, "harris"
		}
		return 447.593 + 9.247*w + 3.098*in.HeightCm - 4.330*in.Age, "harris"
	case "fao":
		switch {
		case in.Age >= 60 && male:
			return 11.711*w + 587.7, "fao"
		case in.Age >= 60:
			return 9.082*w + 658.5, "fao"
		case in.Age >= 30 && male:
			return 11.472*w + 873.1, "fao"
		case in.Age >= 30:
			return 8.126*w + 845.6, "fao"
		case male:
			return 15.057*w + 692.2, "fao"
		default:
			return 14.818*w + 486.6, "fao"
		}
	case "katch":
		if lean > 0 {
			return 370 + 21.6*lean, "katch"
		}
	case "cunningham":
		if lean > 0 {
			return 500 + 22*lean, "cunningham"
		}
	}
	// Mifflin-St Jeor (valor por omisión).
	s := -161.0
	if male {
		s = 5
	}
	return 10*w + 6.25*in.HeightCm - 5*in.Age + s, "mifflin"
}

func computeEnergy(in Inputs, w, lean float64, preg *PregnancyInfo) Energy {
	f := in.Formula
	if f == "" {
		f = "mifflin"
	}
	bmr, used := bmrFor(f, in, w, lean)
	af := activityFactor[in.Activity]
	if af == 0 {
		af = activityFactor["sedentary"]
	}
	if in.Hospital {
		af = 1.2
	}
	if in.Athlete && af < 1.725 {
		af = 1.725
	}
	tee := bmr * af
	e := Energy{Formula: f, FormulaUsed: used, BMR: r0(bmr), ActivityF: af}
	if in.Hospital {
		s := in.Stress
		if s < 1 {
			s = 1
		}
		if s > 2 {
			s = 2
		}
		e.Stress = s
		tee *= s
	}
	if in.Thermic {
		e.Thermic = r0(tee * 0.10)
		tee += tee * 0.10
	}
	e.TEE = r0(tee)
	if preg != nil {
		e.Pregnancy = preg.ExtraKcal
	}
	switch in.Lactation {
	case "0-6":
		e.Lactation = 330
	case "7-12":
		e.Lactation = 400
	}
	e.Adjust = in.AdjustKcal
	rx := tee + e.Pregnancy + e.Lactation + in.AdjustKcal
	rx = math.Round(rx/10) * 10 // la prescripción se redondea a 10 kcal
	if in.KcalTarget > 0 {
		rx = in.KcalTarget
	}
	e.Prescription = rx
	return e
}

// computePregnancy aplica las recomendaciones del IOM (2009) de ganancia de peso y el costo energético del IOM (2005).
func computePregnancy(in Inputs, w float64) *PregnancyInfo {
	p := in.Pregnancy
	if p == nil || p.Weeks <= 0 || in.Sex != "F" {
		return nil
	}
	pre := p.PreWeightKg
	assumed := false
	if pre <= 0 {
		pre, assumed = w, true
	}
	hm := in.HeightCm / 100
	pbmi := pre / (hm * hm)
	var min, max, rmin, rmax float64
	var cls string
	switch {
	case pbmi < 18.5:
		min, max, rmin, rmax, cls = 12.5, 18, 0.44, 0.58, "Bajo peso"
	case pbmi < 25:
		min, max, rmin, rmax, cls = 11.5, 16, 0.35, 0.50, "Peso normal"
	case pbmi < 30:
		min, max, rmin, rmax, cls = 7, 11.5, 0.23, 0.33, "Sobrepeso"
	default:
		min, max, rmin, rmax, cls = 5, 9, 0.17, 0.27, "Obesidad"
	}
	if p.MultiplePreg {
		// Gemelar (IOM 2009, rangos provisionales): normal 17–25, sobrepeso 14–23, obesidad 11–19 kg.
		switch {
		case pbmi < 25:
			min, max = 17, 25
		case pbmi < 30:
			min, max = 14, 23
		default:
			min, max = 11, 19
		}
	}
	tri := 1
	extra := 0.0
	switch {
	case p.Weeks >= 28:
		tri, extra = 3, 452
	case p.Weeks >= 14:
		tri, extra = 2, 340
	}
	// Ganancia esperada hasta hoy: 0.5–2 kg en el primer trimestre y la tasa semanal después.
	gmin, gmax := 0.5*math.Min(float64(p.Weeks), 13)/13, 2*math.Min(float64(p.Weeks), 13)/13
	if p.Weeks > 13 {
		gmin += rmin * float64(p.Weeks-13)
		gmax += rmax * float64(p.Weeks-13)
	}
	info := &PregnancyInfo{Trimester: tri, PreBMI: r1(pbmi), PreBMIClass: cls, GainMinTotal: min, GainMaxTotal: max,
		GainMinNow: r1(gmin), GainMaxNow: r1(gmax), ExtraKcal: extra, Source: "IOM 2009 (ganancia de peso) e IOM 2005 (energía)", PreBMIAssumed: assumed}
	if !assumed {
		g := in.WeightKg - pre
		info.CurrentGain = r1(g)
		switch {
		case g < gmin-0.5:
			info.GainStatus = "Por debajo de lo esperado"
		case g > gmax+0.5:
			info.GainStatus = "Por encima de lo esperado"
		default:
			info.GainStatus = "Dentro de lo esperado"
		}
	}
	return info
}

// ---------- Macronutrimentos ----------

func computeMacros(in Inputs, kcal, w float64) MacroTargets {
	m := in.Macros
	if m.CarbsPct <= 0 && m.LipidsPct <= 0 && m.ProteinPct <= 0 {
		m = Macros{CarbsPct: 55, LipidsPct: 25, ProteinPct: 20}
	}
	sum := m.CarbsPct + m.LipidsPct + m.ProteinPct
	if sum <= 0 {
		sum = 100
	}
	// Normaliza por si la suma no es exactamente 100 (el cliente ya la valida y avisa).
	cp, lp, pp := m.CarbsPct/sum*100, m.LipidsPct/sum*100, m.ProteinPct/sum*100
	t := MacroTargets{Kcal: kcal, CarbsG: r1(kcal * cp / 100 / 4), ProteinG: r1(kcal * pp / 100 / 4), LipidsG: r1(kcal * lp / 100 / 9),
		CarbsPct: r1(cp), ProteinPct: r1(pp), LipidsPct: r1(lp)}
	if w > 0 {
		t.ProteinGKg = r2(t.ProteinG / w)
	}
	return t
}

// ---------- Cuadro dietosintético (SMAE) ----------

// Group es un grupo de equivalentes con el aporte de UN equivalente (SMAE 4.ª ed.).
type Group struct {
	Code, Name    string
	Kcal, C, P, L float64
}

// Orden de presentación del cuadro.
var Groups = []Group{
	{"VER", "Verduras", 25, 4, 2, 0},
	{"FRU", "Frutas", 60, 15, 0, 0},
	{"CER", "Cereales y tubérculos (sin grasa)", 70, 15, 2, 0},
	{"LEG", "Leguminosas", 120, 20, 8, 1},
	{"AOA-MB", "AOA muy bajo aporte de grasa", 40, 0, 7, 1},
	{"AOA-B", "AOA bajo aporte de grasa", 55, 0, 7, 3},
	{"AOA-M", "AOA moderado aporte de grasa", 75, 0, 7, 5},
	{"LEC-D", "Leche descremada", 95, 12, 9, 2},
	{"GRA", "Aceites y grasas (sin proteína)", 45, 0, 0, 5},
	{"AZU", "Azúcares (sin grasa)", 40, 10, 0, 0},
}

func group(code string) Group {
	for _, g := range Groups {
		if g.Code == code {
			return g
		}
	}
	return Group{}
}

func baseFixed(kcal float64, pregnant, lactating bool) map[string]float64 {
	ver, fru, leg, lec := 4.0, 3.0, 1.0, 1.0
	switch {
	case kcal < 1400:
		fru, leg = 2, 0.5
	case kcal >= 2400:
		ver, fru, leg, lec = 5, 4, 2, 2
	case kcal >= 1800:
		leg = 1.5
	}
	if pregnant || lactating {
		lec++
	}
	return map[string]float64{"VER": ver, "FRU": fru, "LEG": leg, "LEC-D": lec}
}

// computeDietosintetico reparte los equivalentes para cubrir el objetivo de macros:
// 1) fija verduras, frutas, leguminosas y leche; 2) los cereales cubren los hidratos restantes;
// 3) los AOA cubren la proteína restante; 4) las grasas completan los lípidos. El subgrupo de AOA baja de
// aporte de grasa (moderado → bajo → muy bajo) si de otro modo los lípidos se pasarían del objetivo.
func computeDietosintetico(in Inputs, t MacroTargets) Dietosintetico {
	eq := map[string]float64{}
	fixed := map[string]bool{}
	for k, v := range baseFixed(t.Kcal, in.Pregnancy != nil, in.Lactation != "") {
		eq[k] = v
	}
	for k, v := range in.Equivalents {
		if group(k).Code != "" && v >= 0 {
			eq[k] = halves(v)
			fixed[k] = true
		}
	}
	get := func(c string) float64 { return eq[c] }
	cho := func() float64 {
		s := 0.0
		for _, g := range Groups {
			s += eq[g.Code] * g.C
		}
		return s
	}

	if !fixed["AZU"] {
		eq["AZU"] = 0
	}
	if !fixed["CER"] {
		other := cho() - eq["CER"]*group("CER").C
		eq["CER"] = math.Max(0, halves((t.CarbsG-other)/group("CER").C))
	}
	// AOA: proteína restante después de todo lo demás.
	protOther := func() float64 {
		s := 0.0
		for _, g := range Groups {
			if g.Code == "AOA-MB" || g.Code == "AOA-B" || g.Code == "AOA-M" {
				continue
			}
			s += eq[g.Code] * g.P
		}
		return s
	}
	aoaKind := "AOA-M"
	for _, k := range []string{"AOA-MB", "AOA-B", "AOA-M"} {
		if fixed[k] {
			aoaKind = k
		}
	}
	if !fixed["AOA-MB"] && !fixed["AOA-B"] && !fixed["AOA-M"] {
		need := math.Max(0, halves((t.ProteinG-protOther())/7))
		lipOther := 0.0
		for _, g := range Groups {
			if g.Code == "AOA-MB" || g.Code == "AOA-B" || g.Code == "AOA-M" || g.Code == "GRA" {
				continue
			}
			lipOther += eq[g.Code] * g.L
		}
		for _, k := range []string{"AOA-M", "AOA-B", "AOA-MB"} {
			aoaKind = k
			if lipOther+need*group(k).L <= t.LipidsG {
				break
			}
		}
		eq[aoaKind] = need
	}
	if !fixed["GRA"] {
		lip := 0.0
		for _, g := range Groups {
			if g.Code != "GRA" {
				lip += eq[g.Code] * g.L
			}
		}
		eq["GRA"] = math.Max(0, halves((t.LipidsG-lip)/5))
	}
	_ = get

	d := Dietosintetico{Target: Totals{Kcal: t.Kcal, Carbs: t.CarbsG, Prot: t.ProteinG, Lip: t.LipidsG}, AOAKind: aoaKind}
	var tot Totals
	for _, g := range Groups {
		e := eq[g.Code]
		if (g.Code == "AOA-MB" || g.Code == "AOA-B" || g.Code == "AOA-M") && g.Code != aoaKind && !fixed[g.Code] {
			continue
		}
		row := GroupRow{Code: g.Code, Name: g.Name, Eq: e, Kcal: r1(e * g.Kcal), Carbs: r1(e * g.C), Prot: r1(e * g.P), Lip: r1(e * g.L), Fixed: fixed[g.Code]}
		d.Rows = append(d.Rows, row)
		tot.Kcal += e * g.Kcal
		tot.Carbs += e * g.C
		tot.Prot += e * g.P
		tot.Lip += e * g.L
	}
	d.Totals = Totals{Kcal: r1(tot.Kcal), Carbs: r1(tot.Carbs), Prot: r1(tot.Prot), Lip: r1(tot.Lip)}
	d.DiffKcal = r1(tot.Kcal - t.Kcal)
	if t.Kcal > 0 {
		d.DiffPct = r1((tot.Kcal - t.Kcal) / t.Kcal * 100)
	}
	return d
}

// ---------- Distribución por tiempo de comida ----------

// DefaultSlots: reparto energético habitual en cinco tiempos.
var DefaultSlots = []Slot{
	{"Desayuno", 25}, {"Colación matutina", 10}, {"Comida", 30}, {"Colación vespertina", 10}, {"Cena", 25},
}

// Peso relativo de cada grupo en cada tiempo (por nombre canónico). Un tiempo con 0 % de energía no recibe nada.
var slotWeights = map[string]map[string]float64{
	"VER":   {"Desayuno": 1, "Colación matutina": 0, "Comida": 3, "Colación vespertina": 0, "Cena": 2},
	"FRU":   {"Desayuno": 2, "Colación matutina": 3, "Comida": 1, "Colación vespertina": 3, "Cena": 0},
	"CER":   {"Desayuno": 3, "Colación matutina": 1, "Comida": 4, "Colación vespertina": 1, "Cena": 3},
	"LEG":   {"Desayuno": 0, "Colación matutina": 0, "Comida": 4, "Colación vespertina": 0, "Cena": 2},
	"AOA":   {"Desayuno": 3, "Colación matutina": 0, "Comida": 4, "Colación vespertina": 0, "Cena": 3},
	"LEC-D": {"Desayuno": 3, "Colación matutina": 2, "Comida": 0, "Colación vespertina": 2, "Cena": 3},
	"GRA":   {"Desayuno": 2, "Colación matutina": 0, "Comida": 3, "Colación vespertina": 0, "Cena": 2},
	"AZU":   {"Desayuno": 1, "Colación matutina": 2, "Comida": 1, "Colación vespertina": 2, "Cena": 0},
}

func weightKey(code string) string {
	if len(code) >= 3 && code[:3] == "AOA" {
		return "AOA"
	}
	return code
}

// distribute reparte `eq` equivalentes (en medios) con el método del mayor residuo.
func distribute(eq float64, w []float64) []float64 {
	units := int(math.Round(eq * 2))
	out := make([]float64, len(w))
	sum := 0.0
	for _, x := range w {
		sum += x
	}
	if units <= 0 || sum <= 0 {
		return out
	}
	type rem struct {
		i int
		f float64
	}
	left := units
	rems := []rem{}
	cnt := make([]int, len(w))
	for i, x := range w {
		share := float64(units) * x / sum
		cnt[i] = int(math.Floor(share))
		left -= cnt[i]
		rems = append(rems, rem{i, share - math.Floor(share)})
	}
	sort.SliceStable(rems, func(a, b int) bool { return rems[a].f > rems[b].f })
	for k := 0; k < left; k++ {
		cnt[rems[k%len(rems)].i]++
	}
	for i := range out {
		out[i] = float64(cnt[i]) / 2
	}
	return out
}

func computeDistribution(in Inputs, d Dietosintetico) []SlotRow {
	slots := in.Slots
	if len(slots) == 0 {
		slots = DefaultSlots
	}
	rows := make([]SlotRow, len(slots))
	for i, s := range slots {
		rows[i] = SlotRow{Name: s.Name, Pct: s.Pct, Eq: map[string]float64{}, TargetKcal: r0(d.Target.Kcal * s.Pct / 100)}
	}
	for _, r := range d.Rows {
		if r.Eq <= 0 {
			continue
		}
		wk := weightKey(r.Code)
		w := make([]float64, len(slots))
		allZero := true
		for i, s := range slots {
			if s.Pct <= 0 {
				continue
			}
			base, ok := slotWeights[wk][s.Name]
			if !ok {
				base = 1 // tiempo personalizado: peso neutro
			}
			w[i] = base * s.Pct
			if w[i] > 0 {
				allZero = false
			}
		}
		if allZero {
			for i, s := range slots {
				w[i] = s.Pct
			}
		}
		parts := distribute(r.Eq, w)
		g := group(r.Code)
		for i, p := range parts {
			if p <= 0 {
				continue
			}
			rows[i].Eq[r.Code] = p
			rows[i].Totals.Kcal += p * g.Kcal
			rows[i].Totals.Carbs += p * g.C
			rows[i].Totals.Prot += p * g.P
			rows[i].Totals.Lip += p * g.L
		}
	}
	for i := range rows {
		t := rows[i].Totals
		rows[i].Totals = Totals{Kcal: r1(t.Kcal), Carbs: r1(t.Carbs), Prot: r1(t.Prot), Lip: r1(t.Lip)}
		rows[i].DiffKcal = r1(t.Kcal - rows[i].TargetKcal)
	}
	return rows
}

// ---------- Validación y punto de entrada ----------

type FieldErrors map[string]string

func (f FieldErrors) Error() string { return "datos inválidos" }

// Normalize completa valores por omisión y valida rangos clínicos razonables.
func (in *Inputs) Normalize() FieldErrors {
	e := FieldErrors{}
	if in.Sex != "F" && in.Sex != "M" {
		e["sex"] = "elige femenino o masculino"
	}
	if in.Age < 14 || in.Age > 110 {
		e["age"] = "la edad debe estar entre 14 y 110 años"
	}
	if in.WeightKg < 20 || in.WeightKg > 400 {
		e["weight_kg"] = "el peso debe estar entre 20 y 400 kg"
	}
	if in.HeightCm < 100 || in.HeightCm > 250 {
		e["height_cm"] = "la talla debe estar entre 100 y 250 cm"
	}
	if in.BodyFatPct < 0 || in.BodyFatPct > 70 {
		e["body_fat_pct"] = "el % de grasa debe estar entre 0 y 70"
	}
	if in.Pregnancy != nil && (in.Pregnancy.Weeks < 1 || in.Pregnancy.Weeks > 42) {
		e["pregnancy.weeks"] = "las semanas de gestación van de 1 a 42"
	}
	if in.Pregnancy != nil && in.Sex == "M" {
		e["pregnancy"] = "el embarazo solo aplica a pacientes de sexo femenino"
	}
	if in.Lactation != "" && in.Lactation != "0-6" && in.Lactation != "7-12" {
		e["lactation"] = "usa 0-6 o 7-12 meses"
	}
	if in.Activity == "" {
		in.Activity = "sedentary"
	}
	if _, ok := activityFactor[in.Activity]; !ok {
		e["activity"] = "actividad no válida"
	}
	switch in.Formula {
	case "", "mifflin", "harris", "fao", "katch", "cunningham":
	default:
		e["formula"] = "fórmula no válida"
	}
	if in.Goal == "" {
		in.Goal = "maintain"
	}
	m := in.Macros
	if m.CarbsPct < 0 || m.LipidsPct < 0 || m.ProteinPct < 0 {
		e["macros"] = "los porcentajes no pueden ser negativos"
	} else if s := m.CarbsPct + m.LipidsPct + m.ProteinPct; s > 0 && math.Abs(s-100) > 0.5 {
		e["macros"] = "los porcentajes deben sumar 100"
	}
	if in.KcalTarget < 0 || in.KcalTarget > 8000 {
		e["kcal_target"] = "la prescripción debe estar entre 0 y 8000 kcal"
	}
	for i, s := range in.Slots {
		if s.Pct < 0 || s.Pct > 100 {
			e["slots"] = "cada tiempo debe tener entre 0 y 100 %"
		}
		_ = i
	}
	if len(in.Slots) > 0 {
		sum := 0.0
		for _, s := range in.Slots {
			sum += s.Pct
		}
		if math.Abs(sum-100) > 0.5 {
			e["slots"] = "los tiempos de comida deben sumar 100 %"
		}
	}
	for _, a := range in.Amputations {
		if _, ok := AmputationPct[a]; !ok {
			e["amputations"] = "segmento no válido"
		}
	}
	if len(e) == 0 {
		return nil
	}
	return e
}

func warnings(in Inputs, r *Result) []Warning {
	var out []Warning
	add := func(code, msg, lvl string) { out = append(out, Warning{code, msg, lvl}) }
	if r.Macros.ProteinGKg > 0 {
		hi := 2.0
		if in.Athlete {
			hi = 2.4
		}
		if r.Macros.ProteinGKg > hi {
			add("protein_high", "La proteína supera 2 g/kg; revisa función renal y objetivo.", "warn")
		}
		if r.Macros.ProteinGKg < 0.8 {
			add("protein_low", "La proteína está por debajo de 0.8 g/kg (mínimo recomendado para adultos).", "warn")
		}
	}
	if r.Energy.Prescription < 1200 && in.Sex == "F" || r.Energy.Prescription < 1500 && in.Sex == "M" {
		add("kcal_low", "La prescripción es menor a 1200 kcal (mujeres) o 1500 kcal (hombres): requiere supervisión clínica.", "critical")
	}
	if (in.Formula == "katch" || in.Formula == "cunningham") && r.Composition.FatSource != "captured" {
		add("fat_estimated", "El % de grasa no está capturado: la fórmula usa una estimación ("+r.Composition.FatSource+"). Captura el % medido para mayor precisión.", "info")
	}
	if r.Macros.LipidsPct < 20 {
		add("lipids_low", "Los lípidos están por debajo de 20 % de la energía.", "warn")
	}
	if r.Macros.CarbsPct > 0 && r.Macros.CarbsPct < 45 {
		add("carbs_low", "Los hidratos de carbono están por debajo de 45 % de la energía.", "info")
	}
	if math.Abs(r.Dietosint.DiffPct) > 5 {
		add("cuadro_diff", "El cuadro dietosintético se desvía más de 5 % de la prescripción; ajusta equivalentes.", "warn")
	}
	if in.Age < 18 {
		add("age_minor", "En menores de 18 años estas fórmulas no son las indicadas (usa curvas y requerimientos pediátricos).", "critical")
	}
	if r.Pregnancy != nil && r.Pregnancy.PreBMIAssumed {
		add("preg_pre_weight", "No se indicó el peso pregestacional: se usó el peso actual para clasificar la ganancia.", "info")
	}
	return out
}

// Compute ejecuta todo el motor. Las entradas deben haber pasado por Normalize.
func Compute(in Inputs) Result {
	an := computeAnthro(in)
	w := an.WeightUsedKg
	if w <= 0 {
		w = in.WeightKg
	}
	comp := computeComposition(in, w)
	preg := computePregnancy(in, w)
	en := computeEnergy(in, w, comp.LeanMassKg, preg)
	mac := computeMacros(in, en.Prescription, w)
	cuadro := computeDietosintetico(in, mac)
	r := Result{Anthro: an, Composition: comp, Energy: en, Pregnancy: preg, Macros: mac, Dietosint: cuadro,
		Distribution: computeDistribution(in, cuadro), EngineVer: EngineVersion}
	r.Warnings = warnings(in, &r)
	if r.Warnings == nil {
		r.Warnings = []Warning{}
	}
	return r
}
