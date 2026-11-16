/**
 * Motor de Dietocálculo en el cliente. Es el espejo exacto de `backend/internal/dietocalculo/engine.go`:
 * los dos se prueban contra los mismos vectores (`engine.golden.json`). Si cambias una fórmula, cámbiala en ambos
 * lados y regenera los vectores con `UPDATE_GOLDEN=1 go test ./internal/dietocalculo`.
 * Los nombres de campo son los del API (snake_case) para que no haya mapeos intermedios.
 */

export type Sex = 'F' | 'M';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'intense' | 'very_intense';
export type Formula = 'mifflin' | 'harris' | 'fao' | 'katch' | 'cunningham';
export type Tone = 'ok' | 'warn' | 'critical' | 'info';

export interface Macros { carbs_pct: number; lipids_pct: number; protein_pct: number }
export interface PregnancyIn { weeks: number; pre_weight_kg?: number; multiple?: boolean }
export interface Slot { name: string; pct: number }

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
  activity: Activity;
  formula: Formula;
  thermic: boolean;
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
}

export interface Classification { label: string; tone: Tone; note?: string }
export interface Totals { kcal: number; carbs_g: number; protein_g: number; lipids_g: number }
export interface GroupRow { code: string; name: string; equivalents: number; kcal: number; carbs_g: number; protein_g: number; lipids_g: number; fixed?: boolean }
export interface SlotRow { name: string; pct: number; equivalents: Record<string, number>; totals: Totals; target_kcal: number; diff_kcal: number }
export interface Warning { code: string; message: string; level: 'info' | 'warn' | 'critical' }

export interface DietResult {
  anthro: {
    weight_used_kg: number; bmi: number; bmi_class: Classification; ideal_weight_kg: number; bsa_mosteller: number; bsa_dubois: number;
    waist_hip?: number; waist_hip_class?: Classification; waist_height?: number; waist_height_class?: Classification; waist_class?: Classification;
    stature_chumlea_cm?: number; frame_ratio?: number; frame?: string;
  };
  composition: { fat_pct: number; fat_source: 'captured' | 'navy' | 'deurenberg'; fat_mass_kg: number; lean_mass_kg: number; target_fat_pct?: number; target_weight_kg?: number };
  energy: {
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
  warnings: Warning[];
  engine_version: string;
}

export const ENGINE_VERSION = '1.0.0';
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
    bsa_mosteller: r2(Math.sqrt((i.height_cm * w) / 3600)), bsa_dubois: r2(0.007184 * Math.pow(w, 0.425) * Math.pow(i.height_cm, 0.725)),
  };
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

function computeComposition(i: DietInputs, w: number): DietResult['composition'] {
  let pct: number, src: 'captured' | 'navy' | 'deurenberg';
  const navy = bodyFatNavy(i);
  if ((i.body_fat_pct ?? 0) > 0) { pct = i.body_fat_pct as number; src = 'captured'; }
  else if (navy !== null && navy > 2 && navy < 60) { pct = navy; src = 'navy'; }
  else {
    const bmi = w / Math.pow(i.height_cm / 100, 2);
    pct = 1.2 * bmi + 0.23 * i.age - 10.8 * (i.sex === 'M' ? 1 : 0) - 5.4; src = 'deurenberg';
  }
  pct = Math.max(3, Math.min(60, pct));
  const fat = (w * pct) / 100;
  const c: DietResult['composition'] = { fat_pct: r1(pct), fat_source: src, fat_mass_kg: r1(fat), lean_mass_kg: r1(w - fat) };
  const t = i.target_fat_pct ?? 0;
  if (t > 0 && t < 60) { c.target_fat_pct = t; c.target_weight_kg = r1((w - fat) / (1 - t / 100)); }
  return c;
}

// ---------- Energía ----------
export const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, intense: 1.725, very_intense: 1.9 };

function bmrFor(formula: Formula, i: DietInputs, w: number, lean: number): [number, string] {
  const male = i.sex === 'M';
  switch (formula) {
    case 'harris':
      return [male ? 88.362 + 13.397 * w + 4.799 * i.height_cm - 5.677 * i.age : 447.593 + 9.247 * w + 3.098 * i.height_cm - 4.33 * i.age, 'harris'];
    case 'fao':
      if (i.age >= 60) return [male ? 11.711 * w + 587.7 : 9.082 * w + 658.5, 'fao'];
      if (i.age >= 30) return [male ? 11.472 * w + 873.1 : 8.126 * w + 845.6, 'fao'];
      return [male ? 15.057 * w + 692.2 : 14.818 * w + 486.6, 'fao'];
    case 'katch':
      if (lean > 0) return [370 + 21.6 * lean, 'katch'];
      break;
    case 'cunningham':
      if (lean > 0) return [500 + 22 * lean, 'cunningham'];
      break;
  }
  return [10 * w + 6.25 * i.height_cm - 5 * i.age + (male ? 5 : -161), 'mifflin'];
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
  const [bmr, used] = bmrFor(f, i, w, lean);
  let af = ACTIVITY_FACTOR[i.activity] ?? ACTIVITY_FACTOR.sedentary;
  if (i.hospitalized) af = 1.2;
  if (i.athlete && af < 1.725) af = 1.725;
  let tee = bmr * af;
  const e: DietResult['energy'] = {
    formula: f, formula_used: used, bmr: r0(bmr), activity_factor: af, tee: 0, thermic_kcal: 0, pregnancy_kcal: 0, lactation_kcal: 0, adjust_kcal: 0, prescription_kcal: 0,
  };
  if (i.hospitalized) {
    const s = Math.min(2, Math.max(1, i.stress_factor ?? 0));
    e.stress_factor = s;
    tee *= s;
  }
  if (i.thermic) { e.thermic_kcal = r0(tee * 0.1); tee += tee * 0.1; }
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
  let m = i.macros;
  if (m.carbs_pct <= 0 && m.lipids_pct <= 0 && m.protein_pct <= 0) m = { carbs_pct: 55, lipids_pct: 25, protein_pct: 20 };
  let sum = m.carbs_pct + m.lipids_pct + m.protein_pct;
  if (sum <= 0) sum = 100;
  const cp = (m.carbs_pct / sum) * 100, lp = (m.lipids_pct / sum) * 100, pp = (m.protein_pct / sum) * 100;
  const t = {
    kcal, carbs_g: r1((kcal * cp) / 100 / 4), protein_g: r1((kcal * pp) / 100 / 4), lipids_g: r1((kcal * lp) / 100 / 9),
    carbs_pct: r1(cp), protein_pct: r1(pp), lipids_pct: r1(lp), protein_g_per_kg: 0,
  };
  if (w > 0) t.protein_g_per_kg = r2(t.protein_g / w);
  return t;
}

// ---------- Cuadro dietosintético ----------
export interface Group { code: string; name: string; kcal: number; c: number; p: number; l: number }
/** Aporte de UN equivalente (SMAE 4.ª ed.). */
export const GROUPS: Group[] = [
  { code: 'VER', name: 'Verduras', kcal: 25, c: 4, p: 2, l: 0 },
  { code: 'FRU', name: 'Frutas', kcal: 60, c: 15, p: 0, l: 0 },
  { code: 'CER', name: 'Cereales y tubérculos (sin grasa)', kcal: 70, c: 15, p: 2, l: 0 },
  { code: 'LEG', name: 'Leguminosas', kcal: 120, c: 20, p: 8, l: 1 },
  { code: 'AOA-MB', name: 'AOA muy bajo aporte de grasa', kcal: 40, c: 0, p: 7, l: 1 },
  { code: 'AOA-B', name: 'AOA bajo aporte de grasa', kcal: 55, c: 0, p: 7, l: 3 },
  { code: 'AOA-M', name: 'AOA moderado aporte de grasa', kcal: 75, c: 0, p: 7, l: 5 },
  { code: 'LEC-D', name: 'Leche descremada', kcal: 95, c: 12, p: 9, l: 2 },
  { code: 'GRA', name: 'Aceites y grasas (sin proteína)', kcal: 45, c: 0, p: 0, l: 5 },
  { code: 'AZU', name: 'Azúcares (sin grasa)', kcal: 40, c: 10, p: 0, l: 0 },
];
const group = (code: string): Group | undefined => GROUPS.find((g) => g.code === code);
const isAOA = (c: string): boolean => c === 'AOA-MB' || c === 'AOA-B' || c === 'AOA-M';

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
  const e = (c: string): number => eq[c] ?? 0;
  const cho = (): number => GROUPS.reduce((s, g) => s + e(g.code) * g.c, 0);
  if (!fixed['AZU']) eq['AZU'] = 0;
  if (!fixed['CER']) {
    const other = cho() - e('CER') * (group('CER') as Group).c;
    eq['CER'] = Math.max(0, halves((t.carbs_g - other) / (group('CER') as Group).c));
  }
  const protOther = (): number => GROUPS.reduce((s, g) => (isAOA(g.code) ? s : s + e(g.code) * g.p), 0);
  let aoaKind = 'AOA-M';
  for (const k of ['AOA-MB', 'AOA-B', 'AOA-M']) if (fixed[k]) aoaKind = k;
  if (!fixed['AOA-MB'] && !fixed['AOA-B'] && !fixed['AOA-M']) {
    const need = Math.max(0, halves((t.protein_g - protOther()) / 7));
    const lipOther = GROUPS.reduce((s, g) => (isAOA(g.code) || g.code === 'GRA' ? s : s + e(g.code) * g.l), 0);
    for (const k of ['AOA-M', 'AOA-B', 'AOA-MB']) {
      aoaKind = k;
      if (lipOther + need * (group(k) as Group).l <= t.lipids_g) break;
    }
    eq[aoaKind] = need;
  }
  if (!fixed['GRA']) {
    const lip = GROUPS.reduce((s, g) => (g.code === 'GRA' ? s : s + e(g.code) * g.l), 0);
    eq['GRA'] = Math.max(0, halves((t.lipids_g - lip) / 5));
  }
  const rows: GroupRow[] = [];
  const tot = { kcal: 0, carbs_g: 0, protein_g: 0, lipids_g: 0 };
  for (const g of GROUPS) {
    const q = e(g.code);
    if (isAOA(g.code) && g.code !== aoaKind && !fixed[g.code]) continue;
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
  { name: 'Desayuno', pct: 25 }, { name: 'Colación matutina', pct: 10 }, { name: 'Comida', pct: 30 }, { name: 'Colación vespertina', pct: 10 }, { name: 'Cena', pct: 25 },
];
const SLOT_WEIGHTS: Record<string, Record<string, number>> = {
  VER: { 'Desayuno': 1, 'Colación matutina': 0, 'Comida': 3, 'Colación vespertina': 0, 'Cena': 2 },
  FRU: { 'Desayuno': 2, 'Colación matutina': 3, 'Comida': 1, 'Colación vespertina': 3, 'Cena': 0 },
  CER: { 'Desayuno': 3, 'Colación matutina': 1, 'Comida': 4, 'Colación vespertina': 1, 'Cena': 3 },
  LEG: { 'Desayuno': 0, 'Colación matutina': 0, 'Comida': 4, 'Colación vespertina': 0, 'Cena': 2 },
  AOA: { 'Desayuno': 3, 'Colación matutina': 0, 'Comida': 4, 'Colación vespertina': 0, 'Cena': 3 },
  'LEC-D': { 'Desayuno': 3, 'Colación matutina': 2, 'Comida': 0, 'Colación vespertina': 2, 'Cena': 3 },
  GRA: { 'Desayuno': 2, 'Colación matutina': 0, 'Comida': 3, 'Colación vespertina': 0, 'Cena': 2 },
  AZU: { 'Desayuno': 1, 'Colación matutina': 2, 'Comida': 1, 'Colación vespertina': 2, 'Cena': 0 },
};

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

function computeDistribution(i: DietInputs, d: DietResult['dietosintetico']): SlotRow[] {
  const slots = i.slots?.length ? i.slots : DEFAULT_SLOTS;
  const rows: SlotRow[] = slots.map((s) => ({ name: s.name, pct: s.pct, equivalents: {}, totals: { kcal: 0, carbs_g: 0, protein_g: 0, lipids_g: 0 }, target_kcal: r0((d.target.kcal * s.pct) / 100), diff_kcal: 0 }));
  for (const r of d.rows) {
    if (r.equivalents <= 0) continue;
    const wk = isAOA(r.code) ? 'AOA' : r.code;
    const w = slots.map(() => 0);
    let allZero = true;
    slots.forEach((s, idx) => {
      if (s.pct <= 0) return;
      const base = SLOT_WEIGHTS[wk]?.[s.name] ?? 1;
      w[idx] = base * s.pct;
      if (w[idx] > 0) allZero = false;
    });
    if (allZero) slots.forEach((s, idx) => { w[idx] = s.pct; });
    const g = group(r.code) as Group;
    distribute(r.equivalents, w).forEach((p, idx) => {
      if (p <= 0) return;
      rows[idx].equivalents[r.code] = p;
      rows[idx].totals.kcal += p * g.kcal; rows[idx].totals.carbs_g += p * g.c; rows[idx].totals.protein_g += p * g.p; rows[idx].totals.lipids_g += p * g.l;
    });
  }
  for (const row of rows) {
    const t = row.totals;
    row.totals = { kcal: r1(t.kcal), carbs_g: r1(t.carbs_g), protein_g: r1(t.protein_g), lipids_g: r1(t.lipids_g) };
    row.diff_kcal = r1(t.kcal - row.target_kcal);
  }
  return rows;
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
  if (i.pregnancy && (i.pregnancy.weeks < 1 || i.pregnancy.weeks > 42)) e['pregnancy.weeks'] = 'las semanas de gestación van de 1 a 42';
  if (i.pregnancy && i.sex === 'M') e['pregnancy'] = 'el embarazo solo aplica a pacientes de sexo femenino';
  if (i.lactation && i.lactation !== '0-6' && i.lactation !== '7-12') e['lactation'] = 'usa 0-6 o 7-12 meses';
  if (!i.activity) i.activity = 'sedentary';
  if (!(i.activity in ACTIVITY_FACTOR)) e['activity'] = 'actividad no válida';
  if (i.formula && !['mifflin', 'harris', 'fao', 'katch', 'cunningham'].includes(i.formula)) e['formula'] = 'fórmula no válida';
  if (!i.goal) i.goal = 'maintain';
  const m = i.macros;
  if (m.carbs_pct < 0 || m.lipids_pct < 0 || m.protein_pct < 0) e['macros'] = 'los porcentajes no pueden ser negativos';
  else {
    const s = m.carbs_pct + m.lipids_pct + m.protein_pct;
    if (s > 0 && Math.abs(s - 100) > 0.5) e['macros'] = 'los porcentajes deben sumar 100';
  }
  if ((i.kcal_target ?? 0) < 0 || (i.kcal_target ?? 0) > 8000) e['kcal_target'] = 'la prescripción debe estar entre 0 y 8000 kcal';
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
  if (r.pregnancy?.pre_bmi_assumed) add('preg_pre_weight', 'No se indicó el peso pregestacional: se usó el peso actual para clasificar la ganancia.', 'info');
  return out;
}

/** Ejecuta todo el motor. Las entradas deben haber pasado por `normalize`. */
export function compute(i: DietInputs): DietResult {
  const anthro = computeAnthro(i);
  const w = anthro.weight_used_kg > 0 ? anthro.weight_used_kg : i.weight_kg;
  const composition = computeComposition(i, w);
  const pregnancy = computePregnancy(i, w);
  const energy = computeEnergy(i, w, composition.lean_mass_kg, pregnancy);
  const macros = computeMacros(i, energy.prescription_kcal, w);
  const dietosintetico = computeDietosintetico(i, macros);
  const r: DietResult = { anthro, composition, energy, pregnancy, macros, dietosintetico, distribution: computeDistribution(i, dietosintetico), warnings: [], engine_version: ENGINE_VERSION };
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
