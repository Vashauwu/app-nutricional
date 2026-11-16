import { DietInputs, DietResult, GROUPS, compute, normalize } from './engine';

/**
 * «Inteligencia de equivalentes»: propone y audita la distribución de equivalentes según un objetivo clínico.
 * Es una herramienta de orientación basada en recomendaciones generales de alimentación (no en un algoritmo
 * propietario) y no sustituye el criterio profesional. Solo lee el motor del Dietocálculo: lo que se aplica
 * son equivalentes y porcentajes de macronutrimentos, que el servidor recalcula al guardar.
 */
export type ObjectiveId = 'general' | 'weight' | 'glycemic' | 'muscle' | 'lipids' | 'pressure';

interface Range { min?: number; max?: number }
interface Rule { code: string; label: string; range: Range }
export interface Objective {
  id: ObjectiveId; name: string; note: string;
  /** Porcentaje de la energía (HCO / LIP / PRO). */
  macros: [number, number, number];
  /** Equivalentes que fija la propuesta; el motor reparte el resto. */
  fixed: Record<string, number>;
  /** Criterios que revisa «Auditar». */
  rules: Rule[];
}

export const OBJECTIVES: Objective[] = [
  { id: 'general', name: 'Salud general', note: 'Patrón equilibrado de la Guía de alimentación saludable.', macros: [55, 25, 20], fixed: { AZU: 0, 'AZU-CG': 0 },
    rules: [{ code: 'VER', label: 'Verduras', range: { min: 3 } }, { code: 'FRU', label: 'Frutas', range: { min: 2 } }, { code: 'AZU', label: 'Azúcares', range: { max: 2 } }] },
  { id: 'weight', name: 'Pérdida de peso', note: 'Más verdura y proteína, menos grasa añadida y sin azúcares.', macros: [45, 30, 25], fixed: { VER: 5, FRU: 3, AZU: 0, 'AZU-CG': 0, 'LEC-D': 1, 'CER-CG': 0 },
    rules: [{ code: 'VER', label: 'Verduras', range: { min: 4 } }, { code: 'AZU', label: 'Azúcares', range: { max: 0 } }, { code: 'AZU-CG', label: 'Azúcares con grasa', range: { max: 0 } }, { code: 'GRA', label: 'Aceites y grasas', range: { max: 5 } }] },
  { id: 'glycemic', name: 'Control glucémico', note: 'Sin azúcares, fruta moderada y más leguminosas y verduras.', macros: [50, 30, 20], fixed: { VER: 5, FRU: 2, LEG: 2, AZU: 0, 'AZU-CG': 0, 'LEC-A': 0 },
    rules: [{ code: 'AZU', label: 'Azúcares', range: { max: 0 } }, { code: 'AZU-CG', label: 'Azúcares con grasa', range: { max: 0 } }, { code: 'LEC-A', label: 'Leche con azúcar', range: { max: 0 } }, { code: 'VER', label: 'Verduras', range: { min: 4 } }, { code: 'LEG', label: 'Leguminosas', range: { min: 1 } }] },
  { id: 'muscle', name: 'Masa muscular', note: 'Proteína alta distribuida durante el día y energía suficiente.', macros: [50, 25, 25], fixed: { VER: 4, FRU: 3, 'LEC-D': 2, AZU: 0 },
    rules: [{ code: 'VER', label: 'Verduras', range: { min: 3 } }, { code: 'LEC-D', label: 'Leche descremada', range: { min: 1 } }] },
  { id: 'lipids', name: 'Dislipidemias', note: 'Grasa saturada baja: proteína magra, leguminosas y sin cortes grasos.', macros: [55, 25, 20], fixed: { VER: 5, FRU: 3, LEG: 2, 'LEC-E': 0, 'LEC-A': 0, AZU: 0, 'AZU-CG': 0, 'CER-CG': 0 },
    rules: [{ code: 'AOA-A', label: 'AOA alto aporte de grasa', range: { max: 0 } }, { code: 'LEC-E', label: 'Leche entera', range: { max: 0 } }, { code: 'LEG', label: 'Leguminosas', range: { min: 1 } }, { code: 'VER', label: 'Verduras', range: { min: 4 } }] },
  { id: 'pressure', name: 'Hipertensión', note: 'Patrón tipo DASH: verduras, fruta y lácteos descremados.', macros: [55, 27, 18], fixed: { VER: 5, FRU: 4, 'LEC-D': 2, LEG: 1.5, AZU: 0, 'AZU-CG': 0 },
    rules: [{ code: 'VER', label: 'Verduras', range: { min: 4 } }, { code: 'FRU', label: 'Frutas', range: { min: 3 } }, { code: 'LEC-D', label: 'Leche descremada', range: { min: 2 } }, { code: 'AZU', label: 'Azúcares', range: { max: 0 } }] },
];
export const objective = (id: string): Objective => OBJECTIVES.find((o) => o.id === id) ?? OBJECTIVES[0];

/** Nombre corto de cada grupo para listas compactas. */
export const SHORT: Record<string, string> = {
  VER: 'Verduras', FRU: 'Frutas', 'CER-SG': 'Cereales S/G', 'CER-CG': 'Cereales C/G', LEG: 'Leguminosas',
  'AOA-MB': 'AOA MBAG', 'AOA-B': 'AOA BAG', 'AOA-M': 'AOA MAG', 'AOA-A': 'AOA AAG',
  'LEC-D': 'Leche Des', 'LEC-S': 'Leche Semi', 'LEC-E': 'Leche Ent', 'LEC-A': 'Leche c/Az', GRA: 'Aceites S/P', GRP: 'Aceites C/P', AZU: 'Azúcares S/G', 'AZU-CG': 'Azúcares C/G',
};

/** Porciones diarias que un menú real difícilmente supera por grupo. */
const PRACTICAL_MAX: Record<string, number> = {
  VER: 8, FRU: 6, 'CER-SG': 12, 'CER-CG': 4, LEG: 3, 'AOA-MB': 6, 'AOA-B': 6, 'AOA-M': 5, 'AOA-A': 3,
  'LEC-D': 3, 'LEC-S': 3, 'LEC-E': 3, 'LEC-A': 2, GRA: 8, GRP: 3, AZU: 4, 'AZU-CG': 2,
};

export interface Adjust { code: string; name: string; current: number; suggested: number; delta: number }
export interface Check { label: string; expected: string; actual: string; ok: boolean }
export interface Realism { score: number; band: 'ok' | 'warn' | 'crit'; label: string; reasons: string[] }
export interface Audit {
  objective: Objective;
  suggestedKcal: number;
  currentKcal: number;
  /** Los 17 grupos con su valor actual y sugerido. */
  rows: Adjust[];
  adjustments: Adjust[];
  deviations: Adjust[];
  realism: Realism;
  checks: Check[];
  macros: { carbs_pct: number; lipids_pct: number; protein_pct: number };
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const eqOf = (r: DietResult): Record<string, number> => Object.fromEntries(r.dietosintetico.rows.map((x) => [x.code, x.equivalents]));
export const DEVIATION = 1.5;

/** Corre el motor con el objetivo elegido y devuelve los equivalentes que propone. */
function propose(inp: DietInputs, o: Objective): DietResult {
  const c = structuredClone(inp);
  c.macros = { carbs_pct: o.macros[0], lipids_pct: o.macros[1], protein_pct: o.macros[2] };
  c.equivalents = { ...o.fixed };
  c.dist_override = undefined;
  normalize(c);
  return compute(c);
}

/** Índice de practicidad culinaria (0–100): qué tan cocinable es un reparto. Criterio propio, explicado en `reasons`. */
export function realism(eq: Record<string, number>, suggested?: Record<string, number>): Realism {
  let score = 100;
  const reasons: string[] = [];
  const active = Object.entries(eq).filter(([, v]) => v > 0);
  for (const [code, v] of active) {
    const cap = PRACTICAL_MAX[code];
    if (cap !== undefined && v > cap) { score -= 6; reasons.push(`${SHORT[code]}: ${v} eq supera lo habitual (${cap}).`); }
    if (v < 0.5) { score -= 2; reasons.push(`${SHORT[code]}: menos de media porción.`); }
  }
  const aoa = active.filter(([c]) => c.startsWith('AOA')).length;
  if (aoa > 2) { score -= 4; reasons.push(`Se reparten ${aoa} tipos de AOA: conviene concentrarlos en uno o dos.`); }
  if (active.length > 13) { score -= 5; reasons.push(`${active.length} grupos distintos hacen el menú difícil de armar.`); }
  if (active.length < 4) { score -= 10; reasons.push('Pocos grupos activos: el menú sería muy repetitivo.'); }
  if (suggested) {
    for (const g of GROUPS) {
      const d = Math.abs((eq[g.code] ?? 0) - (suggested[g.code] ?? 0));
      if (d >= DEVIATION) { score -= 5; reasons.push(`${SHORT[g.code]}: ${d} eq de diferencia con la propuesta.`); }
    }
  }
  score = Math.max(0, Math.min(100, score));
  const band = score >= 80 ? 'ok' : score >= 60 ? 'warn' : 'crit';
  return { score, band, label: band === 'ok' ? 'Óptimo' : band === 'warn' ? 'Aceptable' : 'Revisar', reasons };
}

export function audit(inp: DietInputs, current: DietResult, id: ObjectiveId): Audit {
  const o = objective(id);
  const sug = propose(inp, o);
  const cur = eqOf(current);
  const want = eqOf(sug);
  const all: Adjust[] = GROUPS.map((g) => ({ code: g.code, name: SHORT[g.code], current: cur[g.code] ?? 0, suggested: want[g.code] ?? 0, delta: r1((want[g.code] ?? 0) - (cur[g.code] ?? 0)) }));
  const adjustments = all.filter((a) => a.delta !== 0);
  const deviations = adjustments.filter((a) => Math.abs(a.delta) >= DEVIATION);

  const checks: Check[] = o.rules.map((r) => {
    const v = cur[r.code] ?? 0;
    const ok = (r.range.min === undefined || v >= r.range.min) && (r.range.max === undefined || v <= r.range.max);
    const expected = r.range.min !== undefined && r.range.max !== undefined ? `${r.range.min}–${r.range.max} eq` : r.range.min !== undefined ? `≥ ${r.range.min} eq` : `≤ ${r.range.max} eq`;
    return { label: r.label, expected, actual: `${v} eq`, ok };
  });
  const m = current.macros;
  const dev = (a: number, b: number): boolean => Math.abs(a - b) <= 5;
  checks.push({ label: 'Reparto de macronutrimentos (HCO-LIP-PRO)', expected: `${o.macros.join('-')} ±5`, actual: `${Math.round(m.carbs_pct)}-${Math.round(m.lipids_pct)}-${Math.round(m.protein_pct)}`, ok: dev(m.carbs_pct, o.macros[0]) && dev(m.lipids_pct, o.macros[1]) && dev(m.protein_pct, o.macros[2]) });
  checks.push({ label: 'Energía cubierta por los equivalentes', expected: '±5 % de la meta', actual: `${current.dietosintetico.diff_pct > 0 ? '+' : ''}${current.dietosintetico.diff_pct} %`, ok: Math.abs(current.dietosintetico.diff_pct) <= 5 });

  return {
    objective: o, suggestedKcal: sug.dietosintetico.totals.kcal, currentKcal: current.dietosintetico.totals.kcal,
    rows: all, adjustments, deviations, realism: realism(cur, want), checks,
    macros: { carbs_pct: o.macros[0], lipids_pct: o.macros[1], protein_pct: o.macros[2] },
  };
}

/** Cambios que se escriben en el cuadro al aplicar. «Solo desvíos» toca únicamente lo que se aleja 1.5 eq o más. */
export function applyPlan(inp: DietInputs, a: Audit, onlyDeviations: boolean): Partial<DietInputs> {
  if (onlyDeviations) {
    const eq = { ...(inp.equivalents ?? {}) };
    for (const x of a.deviations) eq[x.code] = x.suggested;
    return { equivalents: eq, dist_override: undefined };
  }
  return { macros: a.macros, equivalents: Object.fromEntries(a.rows.map((x) => [x.code, x.suggested])), dist_override: undefined };
}
