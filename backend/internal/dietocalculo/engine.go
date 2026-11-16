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
	// Si es > 0, la proteína se fija en g/kg, los lípidos en su % y los hidratos son el resto.
	ProteinGKg float64 `json:"protein_g_per_kg,omitempty"`
}

type Pregnancy struct {
	Weeks        int     `json:"weeks"`
	PreWeightKg  float64 `json:"pre_weight_kg,omitempty"`
	MultiplePreg bool    `json:"multiple,omitempty"`
}

type Slot struct {
	Name string  `json:"name"`
	Pct  float64 `json:"pct"`
	Time string  `json:"time,omitempty"` // HH:MM
}

// Skinfolds son pliegues cutáneos en mm.
type Skinfolds struct {
	Triceps     float64 `json:"triceps,omitempty"`
	Biceps      float64 `json:"biceps,omitempty"`
	Subscapular float64 `json:"subscapular,omitempty"`
	Suprailiac  float64 `json:"suprailiac,omitempty"`
	Abdominal   float64 `json:"abdominal,omitempty"`
	Calf        float64 `json:"calf,omitempty"`
}

// MenuItem es un platillo o alimento agregado a un tiempo de comida. Guarda una copia de sus aportes
// para que la dieta no cambie si después se edita el platillo o el catálogo.
type MenuItem struct {
	ID       string             `json:"id"`
	Kind     string             `json:"kind"` // dish | food
	RefID    string             `json:"ref_id,omitempty"`
	Name     string             `json:"name"`
	Qty      string             `json:"qty,omitempty"` // unidad: «porción», «taza», «pieza»…
	QtyN     float64            `json:"qty_n"`         // cuántas unidades; los aportes de abajo son por UNA unidad
	Kcal     float64            `json:"kcal"`
	ProteinG float64            `json:"protein_g"`
	CarbsG   float64            `json:"carbs_g"`
	LipidsG  float64            `json:"lipids_g"`
	FiberG   float64            `json:"fiber_g"`
	Eq       map[string]float64 `json:"eq,omitempty"`
}

type Inputs struct {
	Sex         string     `json:"sex"` // "F" | "M"
	Age         float64    `json:"age"`
	WeightKg    float64    `json:"weight_kg"`
	HeightCm    float64    `json:"height_cm"`
	BodyFatPct  float64    `json:"body_fat_pct,omitempty"`
	WaistCm     float64    `json:"waist_cm,omitempty"`
	HipCm       float64    `json:"hip_cm,omitempty"`
	NeckCm      float64    `json:"neck_cm,omitempty"`
	WristCm     float64    `json:"wrist_cm,omitempty"`
	KneeHeightC float64    `json:"knee_height_cm,omitempty"`
	TargetFat   float64    `json:"target_fat_pct,omitempty"`
	ArmCircCm   float64    `json:"arm_circ_cm,omitempty"`
	Skinfolds   *Skinfolds `json:"skinfolds,omitempty"`
	FatMethod   string     `json:"fat_method,omitempty"` // "" (automático) | captured | durnin | faulkner | navy | deurenberg

	Activity   string  `json:"activity"`              // sedentary|light|moderate|intense|very_intense
	Formula    string  `json:"formula"`               // mifflin|harris|fao|katch|cunningham
	Thermic    bool    `json:"thermic"`               // suma efecto térmico de los alimentos
	ThermicPct float64 `json:"thermic_pct,omitempty"` // % de ETA (10 por omisión)
	Athlete    bool    `json:"athlete"`
	Hospital   bool    `json:"hospitalized"`
	Stress     float64 `json:"stress_factor,omitempty"` // factor de estrés (hospitalizado), 1.0–2.0
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
	// Reparto manual por grupo: equivalentes por tiempo de comida (mismo orden que Slots). Lo no indicado se reparte solo.
	DistOverride map[string][]float64 `json:"dist_override,omitempty"`
	// Platillos y alimentos de la dieta, por nombre de tiempo de comida.
	Menu map[string][]MenuItem `json:"menu,omitempty"`
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
	IdealWeights   []IdealWeight   `json:"ideal_weights"`
	IdealAvg       float64         `json:"ideal_avg_kg"`
	AdjustedWeight float64         `json:"adjusted_weight_kg,omitempty"`
	StatureChumlea float64         `json:"stature_chumlea_cm,omitempty"`
	FrameRatio     float64         `json:"frame_ratio,omitempty"`
	Frame          string          `json:"frame,omitempty"`
}

type IdealWeight struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Kg   float64 `json:"kg"`
}

// FatMethod es un método para estimar el % de grasa; solo trae valor si hay datos suficientes.
type FatMethod struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Tag       string  `json:"tag"`
	Available bool    `json:"available"`
	FatPct    float64 `json:"fat_pct,omitempty"`
	Requires  string  `json:"requires,omitempty"`
}

type Composition struct {
	FatPct       float64     `json:"fat_pct"`
	FatSource    string      `json:"fat_source"` // captured | durnin | faulkner | navy | deurenberg
	Methods      []FatMethod `json:"methods"`
	FFMI         float64     `json:"ffmi"`
	CAMA         float64     `json:"cama_cm2,omitempty"`
	AGB          float64     `json:"agb_cm2,omitempty"`
	TBW          float64     `json:"tbw_l"`
	lean         float64     // masa magra sin redondear, para las ecuaciones de gasto
	FatMassKg    float64     `json:"fat_mass_kg"`
	LeanMassKg   float64     `json:"lean_mass_kg"`
	TargetFatPct float64     `json:"target_fat_pct,omitempty"`
	TargetWeight float64     `json:"target_weight_kg,omitempty"`
}

// Equation es una ecuación de gasto basal calculada con los datos actuales, para compararlas lado a lado.
type Equation struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Tag       string  `json:"tag"`
	Available bool    `json:"available"`
	BMR       float64 `json:"bmr,omitempty"`
	GET       float64 `json:"get,omitempty"` // gasto de mantenimiento con actividad, estrés y ETA
	Note      string  `json:"note,omitempty"`
}

type Energy struct {
	Equations    []Equation `json:"equations"`
	Formula      string     `json:"formula"`
	FormulaUsed  string     `json:"formula_used"` // puede diferir si faltan datos (p. ej. Katch sin % de grasa)
	BMR          float64    `json:"bmr"`
	ActivityF    float64    `json:"activity_factor"`
	TEE          float64    `json:"tee"` // gasto energético total
	Thermic      float64    `json:"thermic_kcal"`
	ThermicPct   float64    `json:"thermic_pct,omitempty"`
	Stress       float64    `json:"stress_factor,omitempty"`
	Pregnancy    float64    `json:"pregnancy_kcal"`
	Lactation    float64    `json:"lactation_kcal"`
	Adjust       float64    `json:"adjust_kcal"`
	Prescription float64    `json:"prescription_kcal"`
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
	Time   string             `json:"time,omitempty"`
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
	// Equivalentes por repartir (total del grupo − lo asignado a los tiempos); 0 cuando todo está repartido.
	Remaining map[string]float64 `json:"distribution_remaining"`
	Warnings  []Warning          `json:"warnings"`
	EngineVer string             `json:"engine_version"`
}

const EngineVersion = "1.1.0"

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
	a.IdealWeights, a.IdealAvg = idealWeights(in.HeightCm, in.Sex)
	if ideal := idealWeight(in.HeightCm, in.Sex); w > ideal {
		a.AdjustedWeight = r1(ideal + 0.25*(w-ideal)) // peso ajustado (25 %) para obesidad
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

// kgPerLb convierte libras a kilogramos (fórmulas de Hamwi).
const kgPerLb = 0.45359237

// idealWeights calcula los pesos teóricos con varias fórmulas publicadas (Hamwi 1964, Robinson 1983, Miller 1983,
// Lorentz y Devine 1974) y su promedio.
func idealWeights(h float64, sex string) ([]IdealWeight, float64) {
	i := math.Max(0, h/2.54-60)
	m := sex == "M"
	pick := func(f, mm float64) float64 {
		if m {
			return mm
		}
		return f
	}
	lorentzDiv := pick(2, 4)
	list := []IdealWeight{
		{"hamwi", "Hamwi", r1(pick(100+5*i, 106+6*i) * kgPerLb)},
		{"robinson", "Robinson", r1(pick(49+1.7*i, 52+1.9*i))},
		{"miller", "Miller", r1(pick(53.1+1.36*i, 56.2+1.41*i))},
		{"lorentz", "Lorentz", r1(h - 100 - (h-150)/lorentzDiv)},
		{"devine", "Devine", r1(pick(45.5+2.3*i, 50+2.3*i))},
	}
	sum := 0.0
	for _, x := range list {
		sum += x.Kg
	}
	return list, r1(sum / float64(len(list)))
}

// durninDensity: densidad corporal de Durnin-Womersley (1974) con la suma de 4 pliegues (tríceps, bíceps,
// subescapular, suprailíaco).
func durninFat(sex string, age, sum4 float64) (float64, bool) {
	if age < 17 || sum4 <= 0 {
		return 0, false
	}
	var c, m float64
	if sex == "M" {
		switch {
		case age < 20:
			c, m = 1.1620, 0.0630
		case age < 30:
			c, m = 1.1631, 0.0632
		case age < 40:
			c, m = 1.1422, 0.0544
		case age < 50:
			c, m = 1.1620, 0.0700
		default:
			c, m = 1.1715, 0.0779
		}
	} else {
		switch {
		case age < 30:
			c, m = 1.1549, 0.0678
		case age < 40:
			c, m = 1.1599, 0.0717
		case age < 50:
			c, m = 1.1423, 0.0632
		default:
			c, m = 1.1333, 0.0612
		}
	}
	d := c - m*math.Log10(sum4)
	return 495/d - 450, true // Siri (1961)
}

func computeComposition(in Inputs, w float64) Composition {
	sf := Skinfolds{}
	if in.Skinfolds != nil {
		sf = *in.Skinfolds
	}
	bmi := w / math.Pow(in.HeightCm/100, 2)
	male := 0.0
	if in.Sex == "M" {
		male = 1
	}
	type cand struct {
		id, name, tag, req string
		pct                float64
		ok                 bool
	}
	cands := []cand{{id: "captured", name: "Capturado", tag: "Medido", req: "Captura el % de grasa"}}
	if in.BodyFatPct > 0 {
		cands[0].pct, cands[0].ok = in.BodyFatPct, true
	}
	dp, dok := 0.0, false
	if sf.Triceps > 0 && sf.Biceps > 0 && sf.Subscapular > 0 && sf.Suprailiac > 0 {
		dp, dok = durninFat(in.Sex, in.Age, sf.Triceps+sf.Biceps+sf.Subscapular+sf.Suprailiac)
	}
	cands = append(cands, cand{"durnin", "Durnin-Womersley (4 pliegues)", "Siri", "Requiere edad ≥ 17 y tríceps, bíceps, subescapular y suprailíaco", dp, dok})
	fp, fok := 0.0, false
	if sf.Triceps > 0 && sf.Subscapular > 0 && sf.Suprailiac > 0 && sf.Abdominal > 0 {
		fp, fok = (sf.Triceps+sf.Subscapular+sf.Suprailiac+sf.Abdominal)*0.153+5.783, true
	}
	cands = append(cands, cand{"faulkner", "Faulkner (deportistas)", "4 pliegues", "Requiere tríceps, subescapular, suprailíaco y abdominal", fp, fok})
	np, nok := bodyFatNavy(in)
	cands = append(cands, cand{"navy", "US Navy", "Circunferencias", "Requiere cintura, cuello (y cadera en mujeres)", np, nok && np > 2 && np < 60})
	cands = append(cands, cand{"deurenberg", "Deurenberg", "Poblacional", "", 1.2*bmi + 0.23*in.Age - 10.8*male - 5.4, true})

	methods := make([]FatMethod, 0, len(cands))
	chosen := -1
	for i, c := range cands {
		fm := FatMethod{ID: c.id, Name: c.name, Tag: c.tag, Available: c.ok}
		if c.ok {
			fm.FatPct = r1(math.Max(3, math.Min(60, c.pct)))
		} else {
			fm.Requires = c.req
		}
		methods = append(methods, fm)
		if c.ok && c.id == in.FatMethod {
			chosen = i
		}
	}
	if chosen < 0 { // automático: el más directo disponible
		for i, c := range cands {
			if c.ok {
				chosen = i
				break
			}
		}
	}
	pct := math.Max(3, math.Min(60, cands[chosen].pct))
	fat := w * pct / 100
	lean := w - fat
	tbw := -2.097 + 0.1069*in.HeightCm + 0.2466*w
	if in.Sex == "M" {
		tbw = 2.447 - 0.09516*in.Age + 0.1074*in.HeightCm + 0.3362*w
	}
	c := Composition{FatPct: r1(pct), FatSource: cands[chosen].id, Methods: methods, FatMassKg: r1(fat), LeanMassKg: r1(lean),
		FFMI: r1(lean / math.Pow(in.HeightCm/100, 2)), TBW: r1(tbw), lean: lean}
	if in.ArmCircCm > 0 && sf.Triceps > 0 {
		tsf := sf.Triceps / 10 // cm
		corr := 6.5
		if in.Sex == "M" {
			corr = 10
		}
		// Heymsfield (1982): área muscular del brazo corregida; Frisancho: área grasa del brazo.
		c.CAMA = r1(math.Pow(in.ArmCircCm-math.Pi*tsf, 2)/(4*math.Pi) - corr)
		c.AGB = r1(in.ArmCircCm*tsf/2 - math.Pi*tsf*tsf/4)
	}
	if in.TargetFat > 0 && in.TargetFat < 60 {
		c.TargetFatPct = in.TargetFat
		c.TargetWeight = r1(lean / (1 - in.TargetFat/100))
	}
	return c
}

// ---------- Energía ----------

var activityFactor = map[string]float64{"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "intense": 1.725, "very_intense": 1.9}

type eqDef struct{ id, name, tag string }

// Ecuaciones comparables, en el orden en que se muestran.
var equationDefs = []eqDef{
	{"valencia", "Valencia (2008) · México", "Población mexicana"},
	{"mifflin", "Mifflin-St Jeor (1990)", "Clínica general"},
	{"harris_orig", "Harris-Benedict (1919)", "Clásica"},
	{"harris", "Roza y Shizgal (1984)", "Harris-Benedict revisada"},
	{"fao", "FAO/OMS/UNU (1985)", "Peso (Schofield)"},
	{"owen", "Owen (1986/1987)", "Adulto"},
	{"katch", "Katch-McArdle (1996)", "Masa magra"},
	{"cunningham", "Cunningham (1980)", "Deporte / masa magra"},
}

// bmrOf devuelve el gasto basal de una ecuación y si se pudo calcular con los datos actuales.
func bmrOf(id string, in Inputs, w, lean float64) (bmr float64, ok bool, note string) {
	male := in.Sex == "M"
	switch id {
	case "valencia":
		// Solo está cargado el tramo de mujeres de 18 a 30 años, verificado contra la referencia. Los demás tramos
		// quedan sin calcular hasta validar los coeficientes con la publicación.
		if !male && in.Age >= 18 && in.Age < 30 {
			return 11.02*w + 679, true, ""
		}
		return 0, false, "Solo disponible para mujeres de 18 a 29 años; falta validar los demás tramos."
	case "harris_orig":
		if male {
			return 66.47 + 13.75*w + 5.0*in.HeightCm - 6.76*in.Age, true, ""
		}
		return 655.1 + 9.563*w + 1.85*in.HeightCm - 4.676*in.Age, true, ""
	case "harris":
		if male {
			return 88.362 + 13.397*w + 4.799*in.HeightCm - 5.677*in.Age, true, ""
		}
		return 447.593 + 9.247*w + 3.098*in.HeightCm - 4.33*in.Age, true, ""
	case "fao":
		switch {
		case in.Age >= 60 && male:
			return 11.711*w + 587.7, true, ""
		case in.Age >= 60:
			return 9.082*w + 658.5, true, ""
		case in.Age >= 30 && male:
			return 11.472*w + 873.1, true, ""
		case in.Age >= 30:
			return 8.126*w + 845.6, true, ""
		case male:
			return 15.057*w + 692.2, true, ""
		default:
			return 14.818*w + 486.6, true, ""
		}
	case "owen":
		if male {
			return 879 + 10.2*w, true, ""
		}
		return 795 + 7.18*w, true, ""
	case "katch":
		return 370 + 21.6*lean, lean > 0, ""
	case "cunningham":
		return 500 + 22*lean, lean > 0, ""
	}
	// Mifflin-St Jeor (valor por omisión).
	s := -161.0
	if male {
		s = 5
	}
	return 10*w + 6.25*in.HeightCm - 5*in.Age + s, true, ""
}

func computeEnergy(in Inputs, w, lean float64, preg *PregnancyInfo) Energy {
	f := in.Formula
	if f == "" {
		f = "mifflin"
	}
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
	stress := 1.0
	if in.Hospital {
		stress = math.Min(2, math.Max(1, in.Stress))
	}
	pct := 0.0
	if in.Thermic {
		pct = in.ThermicPct
		if pct <= 0 {
			pct = 10
		}
	}
	e := Energy{Formula: f, ActivityF: af, ThermicPct: pct}
	if in.Hospital {
		e.Stress = stress
	}
	var chosen *Equation
	for _, d := range equationDefs {
		b, ok, note := bmrOf(d.id, in, w, lean)
		eq := Equation{ID: d.id, Name: d.name, Tag: d.tag, Available: ok, Note: note}
		if ok {
			eq.BMR = r0(b)
			eq.GET = r0(b * af * stress * (1 + pct/100))
		}
		e.Equations = append(e.Equations, eq)
		if d.id == f && ok {
			c := eq
			chosen = &c
		}
	}
	used := f
	if chosen == nil { // la elegida no está disponible: Mifflin-St Jeor
		used = "mifflin"
	}
	e.FormulaUsed = used
	b, _, _ := bmrOf(used, in, w, lean)
	e.BMR = r0(b)
	tee := b * af * stress
	if in.Thermic {
		e.Thermic = r0(tee * pct / 100)
		tee += tee * pct / 100
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
	if m.ProteinGKg > 0 {
		// Proteína por kg, lípidos por %, hidratos = lo que resta.
		lp := m.LipidsPct
		if lp <= 0 {
			lp = 25
		}
		pKcal := m.ProteinGKg * w * 4
		lKcal := kcal * lp / 100
		cKcal := math.Max(0, kcal-pKcal-lKcal)
		t := MacroTargets{Kcal: kcal, CarbsG: r1(cKcal / 4), ProteinG: r1(pKcal / 4), LipidsG: r1(lKcal / 9)}
		if kcal > 0 {
			t.CarbsPct, t.ProteinPct, t.LipidsPct = r1(cKcal/kcal*100), r1(pKcal/kcal*100), r1(lKcal/kcal*100)
		}
		t.ProteinGKg = r2(t.ProteinG / w)
		return t
	}
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

// Group es un grupo de equivalentes con el aporte de UN equivalente (SMAE 4.ª ed.). Los códigos son los de los
// subgrupos del catálogo.
type Group struct {
	Code, Name    string
	Kcal, C, P, L float64
}

// Orden de presentación del cuadro.
var Groups = []Group{
	{"VER", "Verduras", 25, 4, 2, 0},
	{"FRU", "Frutas", 60, 15, 0, 0},
	{"CER-SG", "Cereales sin grasa", 70, 15, 2, 0},
	{"CER-CG", "Cereales con grasa", 115, 15, 2, 5},
	{"LEG", "Leguminosas", 120, 20, 8, 1},
	{"AOA-MB", "AOA muy bajo aporte de grasa", 40, 0, 7, 1},
	{"AOA-B", "AOA bajo aporte de grasa", 55, 0, 7, 3},
	{"AOA-M", "AOA moderado aporte de grasa", 75, 0, 7, 5},
	{"AOA-A", "AOA alto aporte de grasa", 100, 0, 7, 8},
	{"LEC-D", "Leche descremada", 95, 12, 9, 2},
	{"LEC-S", "Leche semidescremada", 110, 12, 9, 4},
	{"LEC-E", "Leche entera", 150, 12, 9, 8},
	{"LEC-A", "Leche con azúcar", 200, 30, 8, 5},
	{"GRA", "Aceites y grasas sin proteína", 45, 0, 0, 5},
	{"GRP", "Aceites y grasas con proteína", 70, 3, 3, 5},
	{"AZU", "Azúcares sin grasa", 40, 10, 0, 0},
	{"AZU-CG", "Azúcares con grasa", 85, 10, 0, 5},
}

func group(code string) Group {
	for _, g := range Groups {
		if g.Code == code {
			return g
		}
	}
	return Group{}
}

func isAOA(c string) bool { return c == "AOA-MB" || c == "AOA-B" || c == "AOA-M" || c == "AOA-A" }

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
// Lo que la nutrióloga fija a mano (`equivalents`) no se toca. Devuelve una fila por grupo (con 0 si no se usa).
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
	// Los grupos que no entran en el cálculo automático arrancan en 0 si no están fijos.
	for _, g := range Groups {
		switch g.Code {
		case "VER", "FRU", "LEG", "LEC-D", "CER-SG", "GRA":
		default:
			if !fixed[g.Code] && !isAOA(g.Code) {
				eq[g.Code] = 0
			}
		}
	}
	cho := func() float64 {
		s := 0.0
		for _, g := range Groups {
			s += eq[g.Code] * g.C
		}
		return s
	}
	if !fixed["CER-SG"] {
		other := cho() - eq["CER-SG"]*group("CER-SG").C
		eq["CER-SG"] = math.Max(0, halves((t.CarbsG-other)/group("CER-SG").C))
	}
	protOther := func() float64 {
		s := 0.0
		for _, g := range Groups {
			if isAOA(g.Code) {
				continue
			}
			s += eq[g.Code] * g.P
		}
		return s
	}
	aoaKind := "AOA-M"
	anyAOAFixed := false
	for _, k := range []string{"AOA-MB", "AOA-B", "AOA-M", "AOA-A"} {
		if fixed[k] {
			aoaKind, anyAOAFixed = k, true
		}
	}
	if !anyAOAFixed {
		need := math.Max(0, halves((t.ProteinG-protOther())/7))
		lipOther := 0.0
		for _, g := range Groups {
			if isAOA(g.Code) || g.Code == "GRA" {
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
	for _, k := range []string{"AOA-MB", "AOA-B", "AOA-M", "AOA-A"} {
		if !fixed[k] && k != aoaKind {
			eq[k] = 0
		}
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

	d := Dietosintetico{Target: Totals{Kcal: t.Kcal, Carbs: t.CarbsG, Prot: t.ProteinG, Lip: t.LipidsG}, AOAKind: aoaKind}
	var tot Totals
	for _, g := range Groups {
		e := eq[g.Code]
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
	{"Desayuno", 25, "08:00"}, {"Colación matutina", 10, "11:00"}, {"Comida", 30, "14:30"}, {"Colación vespertina", 10, "18:00"}, {"Cena", 25, "21:00"},
}

// Peso relativo de cada grupo en cada tiempo (por nombre canónico). Un tiempo con 0 % de energía no recibe nada.
var slotWeights = map[string]map[string]float64{
	"VER": {"Desayuno": 1, "Colación matutina": 0, "Comida": 3, "Colación vespertina": 0, "Cena": 2},
	"FRU": {"Desayuno": 2, "Colación matutina": 3, "Comida": 1, "Colación vespertina": 3, "Cena": 0},
	"CER": {"Desayuno": 3, "Colación matutina": 1, "Comida": 4, "Colación vespertina": 1, "Cena": 3},
	"LEG": {"Desayuno": 0, "Colación matutina": 0, "Comida": 4, "Colación vespertina": 0, "Cena": 2},
	"AOA": {"Desayuno": 3, "Colación matutina": 0, "Comida": 4, "Colación vespertina": 0, "Cena": 3},
	"LEC": {"Desayuno": 3, "Colación matutina": 2, "Comida": 0, "Colación vespertina": 2, "Cena": 3},
	"GRA": {"Desayuno": 2, "Colación matutina": 0, "Comida": 3, "Colación vespertina": 0, "Cena": 2},
	"AZU": {"Desayuno": 1, "Colación matutina": 2, "Comida": 1, "Colación vespertina": 2, "Cena": 0},
}

// weightKey agrupa los subgrupos en la familia que comparte patrón de reparto.
func weightKey(code string) string {
	switch {
	case isAOA(code):
		return "AOA"
	case len(code) >= 3 && code[:3] == "CER":
		return "CER"
	case len(code) >= 3 && code[:3] == "LEC":
		return "LEC"
	case code == "GRA" || code == "GRP":
		return "GRA"
	case len(code) >= 3 && code[:3] == "AZU":
		return "AZU"
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

func computeDistribution(in Inputs, d Dietosintetico) ([]SlotRow, map[string]float64) {
	slots := in.Slots
	if len(slots) == 0 {
		slots = DefaultSlots
	}
	rows := make([]SlotRow, len(slots))
	for i, s := range slots {
		rows[i] = SlotRow{Name: s.Name, Pct: s.Pct, Time: s.Time, Eq: map[string]float64{}, TargetKcal: r0(d.Target.Kcal * s.Pct / 100)}
	}
	remaining := map[string]float64{}
	for _, r := range d.Rows {
		if r.Eq <= 0 {
			continue
		}
		var parts []float64
		if ov, ok := in.DistOverride[r.Code]; ok && len(ov) == len(slots) {
			parts = make([]float64, len(ov))
			for i, v := range ov {
				parts[i] = halves(math.Max(0, v))
			}
		} else {
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
			parts = distribute(r.Eq, w)
		}
		g := group(r.Code)
		assigned := 0.0
		for i, p := range parts {
			assigned += p
			if p <= 0 {
				continue
			}
			rows[i].Eq[r.Code] = p
			rows[i].Totals.Kcal += p * g.Kcal
			rows[i].Totals.Carbs += p * g.C
			rows[i].Totals.Prot += p * g.P
			rows[i].Totals.Lip += p * g.L
		}
		remaining[r.Code] = r1(r.Eq - assigned)
	}
	for i := range rows {
		t := rows[i].Totals
		rows[i].Totals = Totals{Kcal: r1(t.Kcal), Carbs: r1(t.Carbs), Prot: r1(t.Prot), Lip: r1(t.Lip)}
		rows[i].DiffKcal = r1(t.Kcal - rows[i].TargetKcal)
	}
	return rows, remaining
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
	case "", "valencia", "mifflin", "harris_orig", "harris", "fao", "owen", "katch", "cunningham":
	default:
		e["formula"] = "fórmula no válida"
	}
	if in.Goal == "" {
		in.Goal = "maintain"
	}
	m := in.Macros
	switch {
	case m.ProteinGKg < 0 || m.ProteinGKg > 4:
		e["macros"] = "la proteína debe estar entre 0 y 4 g/kg"
	case m.ProteinGKg > 0:
		if m.LipidsPct < 0 || m.LipidsPct > 60 {
			e["macros"] = "los lípidos deben estar entre 0 y 60 %"
		}
	case m.CarbsPct < 0 || m.LipidsPct < 0 || m.ProteinPct < 0:
		e["macros"] = "los porcentajes no pueden ser negativos"
	default:
		if s := m.CarbsPct + m.LipidsPct + m.ProteinPct; s > 0 && math.Abs(s-100) > 0.5 {
			e["macros"] = "los porcentajes deben sumar 100"
		}
	}
	if in.ThermicPct < 0 || in.ThermicPct > 30 {
		e["thermic_pct"] = "el efecto térmico va de 0 a 30 %"
	}
	switch in.FatMethod {
	case "", "captured", "durnin", "faulkner", "navy", "deurenberg":
	default:
		e["fat_method"] = "método no válido"
	}
	if sf := in.Skinfolds; sf != nil {
		for _, v := range []float64{sf.Triceps, sf.Biceps, sf.Subscapular, sf.Suprailiac, sf.Abdominal, sf.Calf} {
			if v < 0 || v > 100 {
				e["skinfolds"] = "los pliegues deben estar entre 0 y 100 mm"
			}
		}
	}
	if in.ArmCircCm < 0 || in.ArmCircCm > 100 {
		e["arm_circ_cm"] = "la circunferencia del brazo debe estar entre 0 y 100 cm"
	}
	if in.KcalTarget < 0 || in.KcalTarget > 8000 {
		e["kcal_target"] = "la prescripción debe estar entre 0 y 8000 kcal"
	}
	if len(in.Slots) > 8 {
		e["slots"] = "usa como máximo 8 tiempos de comida"
	}
	for _, s := range in.Slots {
		if s.Pct < 0 || s.Pct > 100 {
			e["slots"] = "cada tiempo debe tener entre 0 y 100 %"
		}
		if len([]rune(s.Name)) == 0 || len([]rune(s.Name)) > 40 {
			e["slots"] = "cada tiempo necesita un nombre de hasta 40 caracteres"
		}
	}
	for code, arr := range in.DistOverride {
		if group(code).Code == "" {
			e["dist_override"] = "grupo no válido"
		}
		for _, v := range arr {
			if v < 0 || v > 100 || math.IsNaN(v) {
				e["dist_override"] = "los equivalentes por tiempo deben estar entre 0 y 100"
			}
		}
	}
	for slot, items := range in.Menu {
		if len(items) > 40 || len([]rune(slot)) > 40 {
			e["menu"] = "demasiados elementos en un tiempo de comida"
		}
		for _, it := range items {
			if it.Kind != "dish" && it.Kind != "food" {
				e["menu"] = "tipo de elemento no válido"
			}
			if len([]rune(it.Name)) == 0 || len([]rune(it.Name)) > 160 || it.QtyN <= 0 || it.QtyN > 100 || it.Kcal < 0 || it.ProteinG < 0 || it.CarbsG < 0 || it.LipidsG < 0 || it.FiberG < 0 {
				e["menu"] = "elemento de dieta no válido"
			}
		}
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
	if in.Formula == "valencia" && r.Energy.FormulaUsed != "valencia" {
		add("formula_fallback", "La ecuación de Valencia no está disponible para este paciente; se usó Mifflin-St Jeor.", "info")
	}
	for _, v := range r.Remaining {
		if v != 0 {
			add("dist_remaining", "Hay equivalentes sin repartir (o repartidos de más) entre los tiempos de comida.", "warn")
			break
		}
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
	en := computeEnergy(in, w, comp.lean, preg)
	mac := computeMacros(in, en.Prescription, w)
	cuadro := computeDietosintetico(in, mac)
	dist, rem := computeDistribution(in, cuadro)
	r := Result{Anthro: an, Composition: comp, Energy: en, Pregnancy: preg, Macros: mac, Dietosint: cuadro,
		Distribution: dist, Remaining: rem, EngineVer: EngineVersion}
	r.Warnings = warnings(in, &r)
	if r.Warnings == nil {
		r.Warnings = []Warning{}
	}
	return r
}
