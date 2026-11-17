/**
 * Motor de Dietocálculo en el cliente. Es el espejo exacto de `backend/internal/dietocalculo/engine.go`:
 * los dos se prueban contra los mismos vectores (`engine.golden.json`). Si cambias una fórmula, cámbiala en ambos
 * lados y regenera los vectores con `UPDATE_GOLDEN=1 go test ./internal/dietocalculo`.
 * Los nombres de campo son los del API (snake_case) para que no haya mapeos intermedios.
 */

export type Sex = 'F' | 'M';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'intense' | 'very_intense';
export type Formula = 'valencia' | 'mifflin' | 'harris_orig' | 'harris' | 'fao' | 'owen' | 'katch' | 'cunningham';
export type FatMethodId = 'captured' | 'durnin' | 'faulkner' | 'navy' | 'deurenberg';
export type Tone = 'ok' | 'warn' | 'critical' | 'info';

export interface Macros { carbs_pct: number; lipids_pct: number; protein_pct: number; protein_g_per_kg?: number }
export interface PregnancyIn { weeks: number; pre_weight_kg?: number; multiple?: boolean }
export interface Slot { name: string; pct: number; time?: string }
export interface Skinfolds { triceps?: number; biceps?: number; subscapular?: number; suprailiac?: number; abdominal?: number; calf?: number }
/** Suplementación que se imprime como tabla en el documento del paciente. */
export interface Supplement { name: string; dose?: string; when?: string; how?: string }
export interface MenuItem {
  id: string; kind: 'dish' | 'food'; ref_id?: string; name: string; qty?: string; qty_n: number;
  kcal: number; protein_g: number; carbs_g: number; lipids_g: number; fiber_g: number; eq?: Record<string, number>;
}

export interface DietInputs {
  sex: Sex;
  age: number;
  weight_kg: number;
  height_cm: number;
  body_fat_pct?: number;
  waist_cm?: number;
  hip_cm?: number;
  neck_cm?: number;
  wrist_cm?: number;
  knee_height_cm?: number;
  target_fat_pct?: number;
  arm_circ_cm?: number;
  skinfolds?: Skinfolds;
  fat_method?: '' | FatMethodId;
  activity: Activity;
  formula: Formula;
  thermic: boolean;
  thermic_pct?: number;
  athlete: boolean;
  hospitalized: boolean;
  stress_factor?: number;
  amputations?: string[];
  pregnancy?: PregnancyIn;
  lactation?: '' | '0-6' | '7-12';
  goal: 'maintain' | 'lose' | 'gain';
  adjust_kcal?: number;
  kcal_target?: number;
  macros: Macros;
  equivalents?: Record<string, number>;
  slots?: Slot[];
  dist_override?: Record<string, number[]>;
  menu?: Record<string, MenuItem[]>;
  /** Entrega al paciente: no intervienen en ningún cálculo. */
  indications?: string;
  supplements?: Supplement[];
}

export interface FatMethodRow { id: FatMethodId; name: string; tag: string; available: boolean; fat_pct?: number; requires?: string }
export interface Equation { id: string; name: string; tag: string; available: boolean; bmr?: number; get?: number; note?: string }
export interface Classification { label: string; tone: Tone; note?: string }
export interface Totals { kcal: number; carbs_g: number; protein_g: number; lipids_g: number }
export interface GroupRow { code: string; name: string; equivalents: number; kcal: number; carbs_g: number; protein_g: number; lipids_g: number; fixed?: boolean }
export interface SlotRow { name: string; pct: number; time?: string; equivalents: Record<string, number>; totals: Totals; target_kcal: number; diff_kcal: number }
export interface Warning { code: string; message: string; level: 'info' | 'warn' | 'critical' }

export interface DietResult {
  anthro: {
    weight_used_kg: number; bmi: number; bmi_class: Classification; ideal_weight_kg: number; bsa_mosteller: number; bsa_dubois: number;
    waist_hip?: number; waist_hip_class?: Classification; waist_height?: number; waist_height_class?: Classification; waist_class?: Classification;
    ideal_weights: { id: string; name: string; kg: number }[]; ideal_avg_kg: number; adjusted_weight_kg?: number;
    stature_chumlea_cm?: number; frame_ratio?: number; frame?: string;
  };
  composition: {
    fat_pct: number; fat_source: FatMethodId; methods: FatMethodRow[]; fat_mass_kg: number; lean_mass_kg: number; ffmi: number; cama_cm2?: number; agb_cm2?: number; tbw_l: number;
    target_fat_pct?: number; target_weight_kg?: number;
  };
  energy: {
    equations: Equation[]; thermic_pct?: number;
    formula: string; formula_used: string; bmr: number; activity_factor: number; tee: number; thermic_kcal: number; stress_factor?: number;
    pregnancy_kcal: number; lactation_kcal: number; adjust_kcal: number; prescription_kcal: number;
  };
  pregnancy?: {
    trimester: number; pre_bmi: number; pre_bmi_class: string; gain_min_total_kg: number; gain_max_total_kg: number; gain_min_now_kg: number; gain_max_now_kg: number;
    current_gain_kg?: number; gain_status?: string; extra_kcal: number; source: string; pre_bmi_assumed: boolean;
  };
  macros: { kcal: number; carbs_g: number; protein_g: number; lipids_g: number; carbs_pct: number; protein_pct: number; lipids_pct: number; protein_g_per_kg: number };
  dietosintetico: { rows: GroupRow[]; totals: Totals; target: Totals; diff_kcal: number; diff_pct: number; aoa_kind: string };
  distribution: SlotRow[];
  distribution_remaining: Record<string, number>;
  warnings: Warning[];
  engine_version: string;
}

export const ENGINE_VERSION = '1.1.0';
export type FieldErrors = Record<string, string>;

// ---------- Utilidades (redondeo «lejos de cero», igual que Go) ----------
const rnd = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));
const r1 = (x: number): number => rnd(x * 10) / 10;
const r2 = (x: number): number => rnd(x * 100) / 100;
const r0 = (x: number): number => rnd(x);
const halves = (x: number): number => rnd(x * 2) / 2;
const opt = (x: number): number | undefined => (x ? x : undefined);

// ---------- Antropometría ----------
export function bmiClass(bmi: number, heightCm: number, sex: Sex): Classification {
  const low = (sex === 'F' && heightCm < 150) || (sex === 'M' && heightCm < 160);
  const over = low ? 23 : 25;
  const obese = low ? 25 : 30;
  const note = low ? 'Estatura baja: la NOM-008 usa 23 y 25 kg/m² como puntos de corte.' : undefined;
  const c = (label: string, tone: Tone): Classification => (note ? { label, tone, note } : { label, tone });
  if (bmi < 18.5) return c('Bajo peso', 'warn');
  if (bmi < over) return c('Peso normal', 'ok');
  if (bmi < obese) return c('Sobrepeso', 'warn');
  if (bmi < 35) return c('Obesidad grado I', 'critical');
  if (bmi < 40) return c('Obesidad grado II', 'critical');
  return c('Obesidad grado III', 'critical');
}

/** Segmentos amputados y % del peso corporal que representan (Osterkamp 1995). */
export const AMPUTATION_PCT: Record<string, number> = { hand: 0.7, forearm_hand: 3.0, arm_total: 5.0, foot: 1.5, below_knee: 5.9, whole_leg: 16.0 };
export const AMPUTATION_LABEL: Record<string, string> = {
  hand: 'Mano', forearm_hand: 'Antebrazo y mano', arm_total: 'Brazo completo', foot: 'Pie', below_knee: 'Pierna debajo de la rodilla', whole_leg: 'Pierna completa',
};

const correctedWeight = (w: number, amps: string[] = []): number => {
  const total = amps.reduce((s, a) => s + (AMPUTATION_PCT[a] ?? 0), 0);
  return total <= 0 || total >= 60 ? w : w / (1 - total / 100);
};

const idealWeight = (h: number, sex: Sex): number => {
  const over = Math.max(0, h / 2.54 - 60);
  return sex === 'M' ? 50 + 2.3 * over : 45.5 + 2.3 * over;
};

function bodyFatNavy(i: DietInputs): number | null {
  const waist = i.waist_cm ?? 0, neck = i.neck_cm ?? 0, hip = i.hip_cm ?? 0;
  if (waist <= 0 || neck <= 0 || i.height_cm <= 0) return null;
  if (i.sex === 'M') {
    const d = waist - neck;
    return d <= 0 ? null : 495 / (1.0324 - 0.19077 * Math.log10(d) + 0.15456 * Math.log10(i.height_cm)) - 450;
  }
  if (hip <= 0) return null;
  const d = waist + hip - neck;
  return d <= 0 ? null : 495 / (1.29579 - 0.35004 * Math.log10(d) + 0.221 * Math.log10(i.height_cm)) - 450;
}

function computeAnthro(i: DietInputs): DietResult['anthro'] {
  const w = correctedWeight(i.weight_kg, i.amputations);
  const hm = i.height_cm / 100;
  const bmi = w / (hm * hm);
  const a: DietResult['anthro'] = {
    weight_used_kg: r1(w), bmi: r1(bmi), bmi_class: bmiClass(bmi, i.height_cm, i.sex), ideal_weight_kg: r1(idealWeight(i.height_cm, i.sex)),
    bsa_mosteller: r2(Math.sqrt((i.height_cm * w) / 3600)), bsa_dubois: r2(0.007184 * Math.pow(w, 0.425) * Math.pow(i.height_cm, 0.725)), ideal_weights: [], ideal_avg_kg: 0,
  };
  const iw = idealWeights(i.height_cm, i.sex);
  a.ideal_weights = iw.list;
  a.ideal_avg_kg = iw.avg;
  const devine = idealWeight(i.height_cm, i.sex);
  if (w > devine) a.adjusted_weight_kg = r1(devine + 0.25 * (w - devine));
  const waist = i.waist_cm ?? 0, hip = i.hip_cm ?? 0;
  if (waist > 0) {
    const lim = i.sex === 'M' ? 90 : 80;
    a.waist_class = waist >= lim
      ? { label: 'Obesidad abdominal', tone: 'warn', note: `Riesgo cardiometabólico por cintura (≥ ${lim} cm en ${i.sex === 'M' ? 'hombres' : 'mujeres'})` }
      : { label: 'Cintura sin riesgo', tone: 'ok' };
    a.waist_height = r2(waist / i.height_cm);
    a.waist_height_class = a.waist_height >= 0.5 ? { label: 'ICT ≥ 0.50', tone: 'warn', note: 'Riesgo por distribución de grasa central.' } : { label: 'ICT < 0.50', tone: 'ok' };
  }
  if (waist > 0 && hip > 0) {
    a.waist_hip = r2(waist / hip);
    const lim = i.sex === 'M' ? 0.9 : 0.85;
    a.waist_hip_class = a.waist_hip > lim ? { label: 'ICC elevado', tone: 'warn', note: 'Riesgo cardiovascular por distribución central.' } : { label: 'ICC sin riesgo', tone: 'ok' };
  }
  const knee = i.knee_height_cm ?? 0;
  if (knee > 0 && i.age > 0) {
    a.stature_chumlea_cm = r1(i.sex === 'M' ? 64.19 - 0.04 * i.age + 2.02 * knee : 84.88 - 0.24 * i.age + 1.83 * knee);
  }
  const wrist = i.wrist_cm ?? 0;
  if (wrist > 0) {
    const r = i.height_cm / wrist;
    a.frame_ratio = r2(r);
    const small = i.sex === 'M' ? 10.4 : 11, large = i.sex === 'M' ? 9.6 : 10.1;
    a.frame = r > small ? 'Complexión pequeña' : r < large ? 'Complexión grande' : 'Complexión mediana';
  }
  return a;
}

const KG_PER_LB = 0.45359237;

/** Pesos teóricos con fórmulas publicadas (Hamwi, Robinson, Miller, Lorentz, Devine) y su promedio. */
function idealWeights(h: number, sex: Sex): { list: { id: string; name: string; kg: number }[]; avg: number } {
  const i = Math.max(0, h / 2.54 - 60);
  const m = sex === 'M';
  const pick = (f: number, mm: number): number => (m ? mm : f);
  const lorentzDiv = pick(2, 4);
  const list = [
    { id: 'hamwi', name: 'Hamwi', kg: r1(pick(100 + 5 * i, 106 + 6 * i) * KG_PER_LB) },
    { id: 'robinson', name: 'Robinson', kg: r1(pick(49 + 1.7 * i, 52 + 1.9 * i)) },
    { id: 'miller', name: 'Miller', kg: r1(pick(53.1 + 1.36 * i, 56.2 + 1.41 * i)) },
    { id: 'lorentz', name: 'Lorentz', kg: r1(h - 100 - (h - 150) / lorentzDiv) },
    { id: 'devine', name: 'Devine', kg: r1(pick(45.5 + 2.3 * i, 50 + 2.3 * i)) },
  ];
  let sum = 0;
  for (const x of list) sum += x.kg;
  return { list, avg: r1(sum / list.length) };
}

/** Durnin-Womersley (1974) con la suma de 4 pliegues y Siri (1961). */
function durninFat(sex: Sex, age: number, sum4: number): number | null {
  if (age < 17 || sum4 <= 0) return null;
  let c: number, m: number;
  if (sex === 'M') {
    if (age < 20) [c, m] = [1.162, 0.063];
    else if (age < 30) [c, m] = [1.1631, 0.0632];
    else if (age < 40) [c, m] = [1.1422, 0.0544];
    else if (age < 50) [c, m] = [1.162, 0.07];
    else [c, m] = [1.1715, 0.0779];
  } else if (age < 30) [c, m] = [1.1549, 0.0678];
  else if (age < 40) [c, m] = [1.1599, 0.0717];
  else if (age < 50) [c, m] = [1.1423, 0.0632];
  else [c, m] = [1.1333, 0.0612];
  const d = c - m * Math.log10(sum4);
  return 495 / d - 450;
}

function computeComposition(i: DietInputs, w: number): { c: DietResult['composition']; lean: number } {
  const sf = i.skinfolds ?? {};
  const tri = sf.triceps ?? 0, bic = sf.biceps ?? 0, sub = sf.subscapular ?? 0, sup = sf.suprailiac ?? 0, abd = sf.abdominal ?? 0;
  const bmi = w / Math.pow(i.height_cm / 100, 2);
  const male = i.sex === 'M' ? 1 : 0;
  interface Cand { id: FatMethodId; name: string; tag: string; req: string; pct: number; ok: boolean }
  const cands: Cand[] = [{ id: 'captured', name: 'Capturado', tag: 'Medido', req: 'Captura el % de grasa', pct: i.body_fat_pct ?? 0, ok: (i.body_fat_pct ?? 0) > 0 }];
  let dp: number | null = null;
  if (tri > 0 && bic > 0 && sub > 0 && sup > 0) dp = durninFat(i.sex, i.age, tri + bic + sub + sup);
  cands.push({ id: 'durnin', name: 'Durnin-Womersley (4 pliegues)', tag: 'Siri', req: 'Requiere edad ≥ 17 y tríceps, bíceps, subescapular y suprailíaco', pct: dp ?? 0, ok: dp !== null });
  const fok = tri > 0 && sub > 0 && sup > 0 && abd > 0;
  cands.push({ id: 'faulkner', name: 'Faulkner (deportistas)', tag: '4 pliegues', req: 'Requiere tríceps, subescapular, suprailíaco y abdominal', pct: fok ? (tri + sub + sup + abd) * 0.153 + 5.783 : 0, ok: fok });
  const np = bodyFatNavy(i);
  cands.push({ id: 'navy', name: 'US Navy', tag: 'Circunferencias', req: 'Requiere cintura, cuello (y cadera en mujeres)', pct: np ?? 0, ok: np !== null && np > 2 && np < 60 });
  cands.push({ id: 'deurenberg', name: 'Deurenberg', tag: 'Poblacional', req: '', pct: 1.2 * bmi + 0.23 * i.age - 10.8 * male - 5.4, ok: true });

  const methods: FatMethodRow[] = [];
  let chosen = -1;
  cands.forEach((c, idx) => {
    const fm: FatMethodRow = { id: c.id, name: c.name, tag: c.tag, available: c.ok };
    if (c.ok) fm.fat_pct = r1(Math.max(3, Math.min(60, c.pct)));
    else fm.requires = c.req;
    methods.push(fm);
    if (c.ok && c.id === i.fat_method) chosen = idx;
  });
  if (chosen < 0) chosen = cands.findIndex((c) => c.ok);
  const pct = Math.max(3, Math.min(60, cands[chosen].pct));
  const fat = (w * pct) / 100;
  const lean = w - fat;
  const tbw = i.sex === 'M' ? 2.447 - 0.09516 * i.age + 0.1074 * i.height_cm + 0.3362 * w : -2.097 + 0.1069 * i.height_cm + 0.2466 * w;
  const c: DietResult['composition'] = {
    fat_pct: r1(pct), fat_source: cands[chosen].id, methods, fat_mass_kg: r1(fat), lean_mass_kg: r1(lean), ffmi: r1(lean / Math.pow(i.height_cm / 100, 2)), tbw_l: r1(tbw),
  };
  if ((i.arm_circ_cm ?? 0) > 0 && tri > 0) {
    const tsf = tri / 10;
    const corr = i.sex === 'M' ? 10 : 6.5;
    const arm = i.arm_circ_cm as number;
    c.cama_cm2 = opt(r1(Math.pow(arm - Math.PI * tsf, 2) / (4 * Math.PI) - corr));
    c.agb_cm2 = opt(r1((arm * tsf) / 2 - (Math.PI * tsf * tsf) / 4));
  }
  const t = i.target_fat_pct ?? 0;
  if (t > 0 && t < 60) { c.target_fat_pct = t; c.target_weight_kg = r1(lean / (1 - t / 100)); }
  return { c, lean };
}

// ---------- Energía ----------
export const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, intense: 1.725, very_intense: 1.9 };

/** Ecuaciones comparables, en el orden en que se muestran. */
export const EQUATION_DEFS: { id: Formula; name: string; tag: string }[] = [
  { id: 'valencia', name: 'Valencia (2008) · México', tag: 'Población mexicana' },
  { id: 'mifflin', name: 'Mifflin-St Jeor (1990)', tag: 'Clínica general' },
  { id: 'harris_orig', name: 'Harris-Benedict (1919)', tag: 'Clásica' },
  { id: 'harris', name: 'Roza y Shizgal (1984)', tag: 'Harris-Benedict revisada' },
  { id: 'fao', name: 'FAO/OMS/UNU (1985)', tag: 'Peso (Schofield)' },
  { id: 'owen', name: 'Owen (1986/1987)', tag: 'Adulto' },
  { id: 'katch', name: 'Katch-McArdle (1996)', tag: 'Masa magra' },
  { id: 'cunningham', name: 'Cunningham (1980)', tag: 'Deporte / masa magra' },
];

function bmrOf(id: string, i: DietInputs, w: number, lean: number): { bmr: number; ok: boolean; note: string } {
  const male = i.sex === 'M';
  const ok = (bmr: number): { bmr: number; ok: boolean; note: string } => ({ bmr, ok: true, note: '' });
  switch (id) {
    case 'valencia':
      // Solo está cargado el tramo de mujeres de 18 a 30 años, verificado contra la referencia.
      if (!male && i.age >= 18 && i.age < 30) return ok(11.02 * w + 679);
      return { bmr: 0, ok: false, note: 'Solo disponible para mujeres de 18 a 29 años; falta validar los demás tramos.' };
    case 'harris_orig':
      return ok(male ? 66.47 + 13.75 * w + 5.0 * i.height_cm - 6.76 * i.age : 655.1 + 9.563 * w + 1.85 * i.height_cm - 4.676 * i.age);
    case 'harris':
      return ok(male ? 88.362 + 13.397 * w + 4.799 * i.height_cm - 5.677 * i.age : 447.593 + 9.247 * w + 3.098 * i.height_cm - 4.33 * i.age);
    case 'fao':
      if (i.age >= 60) return ok(male ? 11.711 * w + 587.7 : 9.082 * w + 658.5);
      if (i.age >= 30) return ok(male ? 11.472 * w + 873.1 : 8.126 * w + 845.6);
      return ok(male ? 15.057 * w + 692.2 : 14.818 * w + 486.6);
    case 'owen':
      return ok(male ? 879 + 10.2 * w : 795 + 7.18 * w);
    case 'katch':
      return { bmr: 370 + 21.6 * lean, ok: lean > 0, note: '' };
    case 'cunningham':
      return { bmr: 500 + 22 * lean, ok: lean > 0, note: '' };
  }
  return ok(10 * w + 6.25 * i.height_cm - 5 * i.age + (male ? 5 : -161)); // Mifflin-St Jeor
}

function computePregnancy(i: DietInputs, w: number): DietResult['pregnancy'] | undefined {
  const p = i.pregnancy;
  if (!p || p.weeks <= 0 || i.sex !== 'F') return undefined;
  let pre = p.pre_weight_kg ?? 0;
  let assumed = false;
  if (pre <= 0) { pre = w; assumed = true; }
  const hm = i.height_cm / 100;
  const pbmi = pre / (hm * hm);
  let min: number, max: number, rmin: number, rmax: number, cls: string;
  if (pbmi < 18.5) [min, max, rmin, rmax, cls] = [12.5, 18, 0.44, 0.58, 'Bajo peso'];
  else if (pbmi < 25) [min, max, rmin, rmax, cls] = [11.5, 16, 0.35, 0.5, 'Peso normal'];
  else if (pbmi < 30) [min, max, rmin, rmax, cls] = [7, 11.5, 0.23, 0.33, 'Sobrepeso'];
  else [min, max, rmin, rmax, cls] = [5, 9, 0.17, 0.27, 'Obesidad'];
  if (p.multiple) {
    if (pbmi < 25) [min, max] = [17, 25];
    else if (pbmi < 30) [min, max] = [14, 23];
    else [min, max] = [11, 19];
  }
  let tri = 1, extra = 0;
  if (p.weeks >= 28) { tri = 3; extra = 452; } else if (p.weeks >= 14) { tri = 2; extra = 340; }
  let gmin = (0.5 * Math.min(p.weeks, 13)) / 13, gmax = (2 * Math.min(p.weeks, 13)) / 13;
  if (p.weeks > 13) { gmin += rmin * (p.weeks - 13); gmax += rmax * (p.weeks - 13); }
  const info: NonNullable<DietResult['pregnancy']> = {
    trimester: tri, pre_bmi: r1(pbmi), pre_bmi_class: cls, gain_min_total_kg: min, gain_max_total_kg: max, gain_min_now_kg: r1(gmin), gain_max_now_kg: r1(gmax),
    extra_kcal: extra, source: 'IOM 2009 (ganancia de peso) e IOM 2005 (energía)', pre_bmi_assumed: assumed,
  };
  if (!assumed) {
    const g = i.weight_kg - pre;
    info.current_gain_kg = opt(r1(g));
    info.gain_status = g < gmin - 0.5 ? 'Por debajo de lo esperado' : g > gmax + 0.5 ? 'Por encima de lo esperado' : 'Dentro de lo esperado';
  }
  return info;
}

function computeEnergy(i: DietInputs, w: number, lean: number, preg: DietResult['pregnancy']): DietResult['energy'] {
  const f = i.formula || 'mifflin';
  let af = ACTIVITY_FACTOR[i.activity] ?? ACTIVITY_FACTOR.sedentary;
  if (i.hospitalized) af = 1.2;
  if (i.athlete && af < 1.725) af = 1.725;
  const stress = i.hospitalized ? Math.min(2, Math.max(1, i.stress_factor ?? 0)) : 1;
  let pct = 0;
  if (i.thermic) { pct = i.thermic_pct ?? 0; if (pct <= 0) pct = 10; }
  const e: DietResult['energy'] = {
    equations: [], formula: f, formula_used: f, bmr: 0, activity_factor: af, tee: 0, thermic_kcal: 0, pregnancy_kcal: 0, lactation_kcal: 0, adjust_kcal: 0, prescription_kcal: 0,
  };
  if (pct > 0) e.thermic_pct = pct;
  if (i.hospitalized) e.stress_factor = stress;
  let chosenOk = false;
  for (const d of EQUATION_DEFS) {
    const { bmr, ok, note } = bmrOf(d.id, i, w, lean);
    const eq: Equation = { id: d.id, name: d.name, tag: d.tag, available: ok };
    if (note) eq.note = note;
    if (ok) { eq.bmr = r0(bmr); eq.get = r0(bmr * af * stress * (1 + pct / 100)); }
    e.equations.push(eq);
    if (d.id === f && ok) chosenOk = true;
  }
  const used = chosenOk ? f : 'mifflin';
  e.formula_used = used;
  const b = bmrOf(used, i, w, lean).bmr;
  e.bmr = r0(b);
  let tee = b * af * stress;
  if (i.thermic) { e.thermic_kcal = r0((tee * pct) / 100); tee += (tee * pct) / 100; }
  e.tee = r0(tee);
  e.pregnancy_kcal = preg?.extra_kcal ?? 0;
  e.lactation_kcal = i.lactation === '0-6' ? 330 : i.lactation === '7-12' ? 400 : 0;
  e.adjust_kcal = i.adjust_kcal ?? 0;
  let rx = tee + e.pregnancy_kcal + e.lactation_kcal + e.adjust_kcal;
  rx = rnd(rx / 10) * 10;
  if ((i.kcal_target ?? 0) > 0) rx = i.kcal_target as number;
  e.prescription_kcal = rx;
  return e;
}

// ---------- Macros ----------
function computeMacros(i: DietInputs, kcal: number, w: number): DietResult['macros'] {
  const m = i.macros;
  if ((m.protein_g_per_kg ?? 0) > 0) {
    const lp = m.lipids_pct > 0 ? m.lipids_pct : 25;
    const pKcal = (m.protein_g_per_kg as number) * w * 4;
    const lKcal = (kcal * lp) / 100;
    const cKcal = Math.max(0, kcal - pKcal - lKcal);
    const t = { kcal, carbs_g: r1(cKcal / 4), protein_g: r1(pKcal / 4), lipids_g: r1(lKcal / 9), carbs_pct: 0, protein_pct: 0, lipids_pct: 0, protein_g_per_kg: 0 };
    if (kcal > 0) { t.carbs_pct = r1((cKcal / kcal) * 100); t.protein_pct = r1((pKcal / kcal) * 100); t.lipids_pct = r1((lKcal / kcal) * 100); }
    t.protein_g_per_kg = r2(t.protein_g / w);
    return t;
  }
  let mm = m;
  if (mm.carbs_pct <= 0 && mm.lipids_pct <= 0 && mm.protein_pct <= 0) mm = { carbs_pct: 55, lipids_pct: 25, protein_pct: 20 };
  let sum = mm.carbs_pct + mm.lipids_pct + mm.protein_pct;
  if (sum <= 0) sum = 100;
  const cp = (mm.carbs_pct / sum) * 100, lp = (mm.lipids_pct / sum) * 100, pp = (mm.protein_pct / sum) * 100;
  const t = {
    kcal, carbs_g: r1((kcal * cp) / 100 / 4), protein_g: r1((kcal * pp) / 100 / 4), lipids_g: r1((kcal * lp) / 100 / 9),
    carbs_pct: r1(cp), protein_pct: r1(pp), lipids_pct: r1(lp), protein_g_per_kg: 0,
  };
  if (w > 0) t.protein_g_per_kg = r2(t.protein_g / w);
  return t;
}

// ---------- Cuadro dietosintético ----------
export interface Group { code: string; name: string; kcal: number; c: number; p: number; l: number }
/** Aporte de UN equivalente (SMAE 4.ª ed.). Los códigos son los de los subgrupos del catálogo. */
export const GROUPS: Group[] = [
  { code: 'VER', name: 'Verduras', kcal: 25, c: 4, p: 2, l: 0 },
  { code: 'FRU', name: 'Frutas', kcal: 60, c: 15, p: 0, l: 0 },
  { code: 'CER-SG', name: 'Cereales sin grasa', kcal: 70, c: 15, p: 2, l: 0 },
  { code: 'CER-CG', name: 'Cereales con grasa', kcal: 115, c: 15, p: 2, l: 5 },
  { code: 'LEG', name: 'Leguminosas', kcal: 120, c: 20, p: 8, l: 1 },
  { code: 'AOA-MB', name: 'AOA muy bajo aporte de grasa', kcal: 40, c: 0, p: 7, l: 1 },
  { code: 'AOA-B', name: 'AOA bajo aporte de grasa', kcal: 55, c: 0, p: 7, l: 3 },
  { code: 'AOA-M', name: 'AOA moderado aporte de grasa', kcal: 75, c: 0, p: 7, l: 5 },
  { code: 'AOA-A', name: 'AOA alto aporte de grasa', kcal: 100, c: 0, p: 7, l: 8 },
  { code: 'LEC-D', name: 'Leche descremada', kcal: 95, c: 12, p: 9, l: 2 },
  { code: 'LEC-S', name: 'Leche semidescremada', kcal: 110, c: 12, p: 9, l: 4 },
  { code: 'LEC-E', name: 'Leche entera', kcal: 150, c: 12, p: 9, l: 8 },
  { code: 'LEC-A', name: 'Leche con azúcar', kcal: 200, c: 30, p: 8, l: 5 },
  { code: 'GRA', name: 'Aceites y grasas sin proteína', kcal: 45, c: 0, p: 0, l: 5 },
  { code: 'GRP', name: 'Aceites y grasas con proteína', kcal: 70, c: 3, p: 3, l: 5 },
  { code: 'AZU', name: 'Azúcares sin grasa', kcal: 40, c: 10, p: 0, l: 0 },
  { code: 'AZU-CG', name: 'Azúcares con grasa', kcal: 85, c: 10, p: 0, l: 5 },
];
export const group = (code: string): Group | undefined => GROUPS.find((g) => g.code === code);
const isAOA = (c: string): boolean => c === 'AOA-MB' || c === 'AOA-B' || c === 'AOA-M' || c === 'AOA-A';

function baseFixed(kcal: number, pregnant: boolean, lactating: boolean): Record<string, number> {
  let ver = 4, fru = 3, leg = 1, lec = 1;
  if (kcal < 1400) { fru = 2; leg = 0.5; }
  else if (kcal >= 2400) { ver = 5; fru = 4; leg = 2; lec = 2; }
  else if (kcal >= 1800) leg = 1.5;
  if (pregnant || lactating) lec++;
  return { VER: ver, FRU: fru, LEG: leg, 'LEC-D': lec };
}

function computeDietosintetico(i: DietInputs, t: DietResult['macros']): DietResult['dietosintetico'] {
  const eq: Record<string, number> = {};
  const fixed: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(baseFixed(t.kcal, !!i.pregnancy, !!i.lactation))) eq[k] = v;
  for (const [k, v] of Object.entries(i.equivalents ?? {})) {
    if (group(k) && v >= 0) { eq[k] = halves(v); fixed[k] = true; }
  }
  for (const g of GROUPS) {
    if (['VER', 'FRU', 'LEG', 'LEC-D', 'CER-SG', 'GRA'].includes(g.code)) continue;
    if (!fixed[g.code] && !isAOA(g.code)) eq[g.code] = 0;
  }
  const e = (c: string): number => eq[c] ?? 0;
  const cho = (): number => GROUPS.reduce((s, g) => s + e(g.code) * g.c, 0);
  const cer = group('CER-SG') as Group;
  if (!fixed['CER-SG']) {
    const other = cho() - e('CER-SG') * cer.c;
    eq['CER-SG'] = Math.max(0, halves((t.carbs_g - other) / cer.c));
  }
  const protOther = (): number => GROUPS.reduce((s, g) => (isAOA(g.code) ? s : s + e(g.code) * g.p), 0);
  let aoaKind = 'AOA-M';
  let anyAOAFixed = false;
  for (const k of ['AOA-MB', 'AOA-B', 'AOA-M', 'AOA-A']) if (fixed[k]) { aoaKind = k; anyAOAFixed = true; }
  if (!anyAOAFixed) {
    const need = Math.max(0, halves((t.protein_g - protOther()) / 7));
    const lipOther = GROUPS.reduce((s, g) => (isAOA(g.code) || g.code === 'GRA' ? s : s + e(g.code) * g.l), 0);
    for (const k of ['AOA-M', 'AOA-B', 'AOA-MB']) {
      aoaKind = k;
      if (lipOther + need * (group(k) as Group).l <= t.lipids_g) break;
    }
    eq[aoaKind] = need;
  }
  for (const k of ['AOA-MB', 'AOA-B', 'AOA-M', 'AOA-A']) if (!fixed[k] && k !== aoaKind) eq[k] = 0;
  if (!fixed['GRA']) {
    const lip = GROUPS.reduce((s, g) => (g.code === 'GRA' ? s : s + e(g.code) * g.l), 0);
    eq['GRA'] = Math.max(0, halves((t.lipids_g - lip) / 5));
  }
  const rows: GroupRow[] = [];
  const tot = { kcal: 0, carbs_g: 0, protein_g: 0, lipids_g: 0 };
  for (const g of GROUPS) {
    const q = e(g.code);
    const row: GroupRow = { code: g.code, name: g.name, equivalents: q, kcal: r1(q * g.kcal), carbs_g: r1(q * g.c), protein_g: r1(q * g.p), lipids_g: r1(q * g.l) };
    if (fixed[g.code]) row.fixed = true;
    rows.push(row);
    tot.kcal += q * g.kcal; tot.carbs_g += q * g.c; tot.protein_g += q * g.p; tot.lipids_g += q * g.l;
  }
  return {
    rows,
    totals: { kcal: r1(tot.kcal), carbs_g: r1(tot.carbs_g), protein_g: r1(tot.protein_g), lipids_g: r1(tot.lipids_g) },
    target: { kcal: t.kcal, carbs_g: t.carbs_g, protein_g: t.protein_g, lipids_g: t.lipids_g },
    diff_kcal: r1(tot.kcal - t.kcal), diff_pct: t.kcal > 0 ? r1(((tot.kcal - t.kcal) / t.kcal) * 100) : 0, aoa_kind: aoaKind,
  };
}

// ---------- Distribución ----------
export const DEFAULT_SLOTS: Slot[] = [
  { name: 'Desayuno', pct: 25, time: '08:00' }, { name: 'Colación matutina', pct: 10, time: '11:00' }, { name: 'Comida', pct: 30, time: '14:30' },
  { name: 'Colación vespertina', pct: 10, time: '18:00' }, { name: 'Cena', pct: 25, time: '21:00' },
];
const SLOT_WEIGHTS: Record<string, Record<string, number>> = {
  VER: { 'Desayuno': 1, 'Colación matutina': 0, 'Comida': 3, 'Colación vespertina': 0, 'Cena': 2 },
  FRU: { 'Desayuno': 2, 'Colación matutina': 3, 'Comida': 1, 'Colación vespertina': 3, 'Cena': 0 },
  CER: { 'Desayuno': 3, 'Colación matutina': 1, 'Comida': 4, 'Colación vespertina': 1, 'Cena': 3 },
  LEG: { 'Desayuno': 0, 'Colación matutina': 0, 'Comida': 4, 'Colación vespertina': 0, 'Cena': 2 },
  AOA: { 'Desayuno': 3, 'Colación matutina': 0, 'Comida': 4, 'Colación vespertina': 0, 'Cena': 3 },
  LEC: { 'Desayuno': 3, 'Colación matutina': 2, 'Comida': 0, 'Colación vespertina': 2, 'Cena': 3 },
  GRA: { 'Desayuno': 2, 'Colación matutina': 0, 'Comida': 3, 'Colación vespertina': 0, 'Cena': 2 },
  AZU: { 'Desayuno': 1, 'Colación matutina': 2, 'Comida': 1, 'Colación vespertina': 2, 'Cena': 0 },
};
/** Familia de subgrupos que comparte patrón de reparto. */
function weightKey(code: string): string {
  if (isAOA(code)) return 'AOA';
  if (code.startsWith('CER')) return 'CER';
  if (code.startsWith('LEC')) return 'LEC';
  if (code === 'GRA' || code === 'GRP') return 'GRA';
  if (code.startsWith('AZU')) return 'AZU';
  return code;
}

/** Reparte `eq` equivalentes (en medios) con el método del mayor residuo. */
function distribute(eq: number, w: number[]): number[] {
  const units = rnd(eq * 2);
  const out = w.map(() => 0);
  const sum = w.reduce((s, x) => s + x, 0);
  if (units <= 0 || sum <= 0) return out;
  let left = units;
  const cnt: number[] = [];
  const rems: { i: number; f: number }[] = [];
  w.forEach((x, i) => {
    const share = (units * x) / sum;
    cnt[i] = Math.floor(share);
    left -= cnt[i];
    rems.push({ i, f: share - Math.floor(share) });
  });
  rems.sort((a, b) => b.f - a.f); // Array.prototype.sort es estable: igual que sort.SliceStable
  for (let k = 0; k < left; k++) cnt[rems[k % rems.length].i]++;
  return cnt.map((c) => c / 2);
}

function computeDistribution(i: DietInputs, d: DietResult['dietosintetico']): { rows: SlotRow[]; remaining: Record<string, number> } {
  const slots = i.slots?.length ? i.slots : DEFAULT_SLOTS;
  const rows: SlotRow[] = slots.map((s) => {
    const row: SlotRow = { name: s.name, pct: s.pct, equivalents: {}, totals: { kcal: 0, carbs_g: 0, protein_g: 0, lipids_g: 0 }, target_kcal: r0((d.target.kcal * s.pct) / 100), diff_kcal: 0 };
    if (s.time) row.time = s.time;
    return row;
  });
  const remaining: Record<string, number> = {};
  for (const r of d.rows) {
    if (r.equivalents <= 0) continue;
    let parts: number[];
    const ov = i.dist_override?.[r.code];
    if (ov && ov.length === slots.length) {
      parts = ov.map((v) => halves(Math.max(0, v)));
    } else {
      const wk = weightKey(r.code);
      const w = slots.map(() => 0);
      let allZero = true;
      slots.forEach((s, idx) => {
        if (s.pct <= 0) return;
        const base = SLOT_WEIGHTS[wk]?.[s.name] ?? 1;
        w[idx] = base * s.pct;
        if (w[idx] > 0) allZero = false;
      });
      if (allZero) slots.forEach((s, idx) => { w[idx] = s.pct; });
      parts = distribute(r.equivalents, w);
    }
    const g = group(r.code) as Group;
    let assigned = 0;
    parts.forEach((p, idx) => {
      assigned += p;
      if (p <= 0) return;
      rows[idx].equivalents[r.code] = p;
      rows[idx].totals.kcal += p * g.kcal; rows[idx].totals.carbs_g += p * g.c; rows[idx].totals.protein_g += p * g.p; rows[idx].totals.lipids_g += p * g.l;
    });
    remaining[r.code] = r1(r.equivalents - assigned);
  }
  for (const row of rows) {
    const t = row.totals;
    row.totals = { kcal: r1(t.kcal), carbs_g: r1(t.carbs_g), protein_g: r1(t.protein_g), lipids_g: r1(t.lipids_g) };
    row.diff_kcal = r1(t.kcal - row.target_kcal);
  }
  return { rows, remaining };
}

// ---------- Validación y punto de entrada ----------
/** Completa valores por omisión (muta `i`) y valida rangos. Devuelve null si todo está bien. */
export function normalize(i: DietInputs): FieldErrors | null {
  const e: FieldErrors = {};
  if (i.sex !== 'F' && i.sex !== 'M') e['sex'] = 'elige femenino o masculino';
  if (!(i.age >= 14 && i.age <= 110)) e['age'] = 'la edad debe estar entre 14 y 110 años';
  if (!(i.weight_kg >= 20 && i.weight_kg <= 400)) e['weight_kg'] = 'el peso debe estar entre 20 y 400 kg';
  if (!(i.height_cm >= 100 && i.height_cm <= 250)) e['height_cm'] = 'la talla debe estar entre 100 y 250 cm';
  if ((i.body_fat_pct ?? 0) < 0 || (i.body_fat_pct ?? 0) > 70) e['body_fat_pct'] = 'el % de grasa debe estar entre 0 y 70';
  if ([...(i.indications ?? '')].length > 1200) e['indications'] = 'las indicaciones admiten hasta 1200 caracteres';
  if ((i.supplements?.length ?? 0) > 12) e['supplements'] = 'usa como máximo 12 suplementos';
  (i.supplements ?? []).forEach((sp, n) => {
    if (sp.name.trim() === '' || [...sp.name].length > 80) e[`supplements[${n}].name`] = 'el nombre es obligatorio (hasta 80 caracteres)';
    if ([...(sp.dose ?? '')].length > 60 || [...(sp.when ?? '')].length > 80 || [...(sp.how ?? '')].length > 200) e[`supplements[${n}]`] = 'dosis hasta 60, momento hasta 80 y forma de tomarlo hasta 200 caracteres';
  });
  if (i.pregnancy && (i.pregnancy.weeks < 1 || i.pregnancy.weeks > 42)) e['pregnancy.weeks'] = 'las semanas de gestación van de 1 a 42';
  if (i.pregnancy && i.sex === 'M') e['pregnancy'] = 'el embarazo solo aplica a pacientes de sexo femenino';
  if (i.lactation && i.lactation !== '0-6' && i.lactation !== '7-12') e['lactation'] = 'usa 0-6 o 7-12 meses';
  if (!i.activity) i.activity = 'sedentary';
  if (!(i.activity in ACTIVITY_FACTOR)) e['activity'] = 'actividad no válida';
  if (i.formula && !EQUATION_DEFS.some((d) => d.id === i.formula)) e['formula'] = 'fórmula no válida';
  if (!i.goal) i.goal = 'maintain';
  const m = i.macros;
  const pk = m.protein_g_per_kg ?? 0;
  if (pk < 0 || pk > 4) e['macros'] = 'la proteína debe estar entre 0 y 4 g/kg';
  else if (pk > 0) {
    if (m.lipids_pct < 0 || m.lipids_pct > 60) e['macros'] = 'los lípidos deben estar entre 0 y 60 %';
  } else if (m.carbs_pct < 0 || m.lipids_pct < 0 || m.protein_pct < 0) e['macros'] = 'los porcentajes no pueden ser negativos';
  else {
    const s = m.carbs_pct + m.lipids_pct + m.protein_pct;
    if (s > 0 && Math.abs(s - 100) > 0.5) e['macros'] = 'los porcentajes deben sumar 100';
  }
  if ((i.thermic_pct ?? 0) < 0 || (i.thermic_pct ?? 0) > 30) e['thermic_pct'] = 'el efecto térmico va de 0 a 30 %';
  if (i.fat_method && !['captured', 'durnin', 'faulkner', 'navy', 'deurenberg'].includes(i.fat_method)) e['fat_method'] = 'método no válido';
  if (i.skinfolds && Object.values(i.skinfolds).some((v) => (v ?? 0) < 0 || (v ?? 0) > 100)) e['skinfolds'] = 'los pliegues deben estar entre 0 y 100 mm';
  if ((i.arm_circ_cm ?? 0) < 0 || (i.arm_circ_cm ?? 0) > 100) e['arm_circ_cm'] = 'la circunferencia del brazo debe estar entre 0 y 100 cm';
  if ((i.kcal_target ?? 0) < 0 || (i.kcal_target ?? 0) > 8000) e['kcal_target'] = 'la prescripción debe estar entre 0 y 8000 kcal';
  if ((i.slots?.length ?? 0) > 8) e['slots'] = 'usa como máximo 8 tiempos de comida';
  if (i.slots?.some((s) => s.name.length === 0 || s.name.length > 40)) e['slots'] = 'cada tiempo necesita un nombre de hasta 40 caracteres';
  for (const [code, arr] of Object.entries(i.dist_override ?? {})) {
    if (!group(code)) e['dist_override'] = 'grupo no válido';
    if (arr.some((v) => !(v >= 0 && v <= 100))) e['dist_override'] = 'los equivalentes por tiempo deben estar entre 0 y 100';
  }
  for (const [slot, items] of Object.entries(i.menu ?? {})) {
    if (items.length > 40 || slot.length > 40) e['menu'] = 'demasiados elementos en un tiempo de comida';
    for (const it of items) {
      if (it.kind !== 'dish' && it.kind !== 'food') e['menu'] = 'tipo de elemento no válido';
      if (it.name.length === 0 || it.name.length > 160 || it.qty_n <= 0 || it.qty_n > 100 || it.kcal < 0 || it.protein_g < 0 || it.carbs_g < 0 || it.lipids_g < 0 || it.fiber_g < 0) e['menu'] = 'elemento de dieta no válido';
    }
  }
  if (i.slots?.length) {
    if (i.slots.some((s) => s.pct < 0 || s.pct > 100)) e['slots'] = 'cada tiempo debe tener entre 0 y 100 %';
    const sum = i.slots.reduce((s, x) => s + x.pct, 0);
    if (Math.abs(sum - 100) > 0.5) e['slots'] = 'los tiempos de comida deben sumar 100 %';
  }
  if ((i.amputations ?? []).some((a) => !(a in AMPUTATION_PCT))) e['amputations'] = 'segmento no válido';
  return Object.keys(e).length ? e : null;
}

function warningsFor(i: DietInputs, r: DietResult): Warning[] {
  const out: Warning[] = [];
  const add = (code: string, message: string, level: Warning['level']): void => { out.push({ code, message, level }); };
  if (r.macros.protein_g_per_kg > 0) {
    const hi = i.athlete ? 2.4 : 2;
    if (r.macros.protein_g_per_kg > hi) add('protein_high', 'La proteína supera 2 g/kg; revisa función renal y objetivo.', 'warn');
    if (r.macros.protein_g_per_kg < 0.8) add('protein_low', 'La proteína está por debajo de 0.8 g/kg (mínimo recomendado para adultos).', 'warn');
  }
  if ((r.energy.prescription_kcal < 1200 && i.sex === 'F') || (r.energy.prescription_kcal < 1500 && i.sex === 'M')) {
    add('kcal_low', 'La prescripción es menor a 1200 kcal (mujeres) o 1500 kcal (hombres): requiere supervisión clínica.', 'critical');
  }
  if ((i.formula === 'katch' || i.formula === 'cunningham') && r.composition.fat_source !== 'captured') {
    add('fat_estimated', `El % de grasa no está capturado: la fórmula usa una estimación (${r.composition.fat_source}). Captura el % medido para mayor precisión.`, 'info');
  }
  if (r.macros.lipids_pct < 20) add('lipids_low', 'Los lípidos están por debajo de 20 % de la energía.', 'warn');
  if (r.macros.carbs_pct > 0 && r.macros.carbs_pct < 45) add('carbs_low', 'Los hidratos de carbono están por debajo de 45 % de la energía.', 'info');
  if (Math.abs(r.dietosintetico.diff_pct) > 5) add('cuadro_diff', 'El cuadro dietosintético se desvía más de 5 % de la prescripción; ajusta equivalentes.', 'warn');
  if (i.age < 18) add('age_minor', 'En menores de 18 años estas fórmulas no son las indicadas (usa curvas y requerimientos pediátricos).', 'critical');
  if (i.formula === 'valencia' && r.energy.formula_used !== 'valencia') add('formula_fallback', 'La ecuación de Valencia no está disponible para este paciente; se usó Mifflin-St Jeor.', 'info');
  if (Object.values(r.distribution_remaining).some((v) => v !== 0)) add('dist_remaining', 'Hay equivalentes sin repartir (o repartidos de más) entre los tiempos de comida.', 'warn');
  if (r.pregnancy?.pre_bmi_assumed) add('preg_pre_weight', 'No se indicó el peso pregestacional: se usó el peso actual para clasificar la ganancia.', 'info');
  return out;
}

/** Ejecuta todo el motor. Las entradas deben haber pasado por `normalize`. */
export function compute(i: DietInputs): DietResult {
  const anthro = computeAnthro(i);
  const w = anthro.weight_used_kg > 0 ? anthro.weight_used_kg : i.weight_kg;
  const { c: composition, lean } = computeComposition(i, w);
  const pregnancy = computePregnancy(i, w);
  const energy = computeEnergy(i, w, lean, pregnancy);
  const macros = computeMacros(i, energy.prescription_kcal, w);
  const dietosintetico = computeDietosintetico(i, macros);
  const dist = computeDistribution(i, dietosintetico);
  const r: DietResult = { anthro, composition, energy, pregnancy, macros, dietosintetico, distribution: dist.rows, distribution_remaining: dist.remaining, warnings: [], engine_version: ENGINE_VERSION };
  r.warnings = warningsFor(i, r);
  return r;
}

/** Entradas iniciales de una «Nueva dieta». */
export function defaultInputs(): DietInputs {
  return {
    sex: 'F', age: 30, weight_kg: 65, height_cm: 165, activity: 'light', formula: 'mifflin', thermic: false, athlete: false, hospitalized: false,
    goal: 'maintain', macros: { carbs_pct: 55, lipids_pct: 25, protein_pct: 20 }, slots: DEFAULT_SLOTS.map((s) => ({ ...s })),
  };
}
