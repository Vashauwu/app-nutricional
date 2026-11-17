import { DietResult } from '../../features/dietocalculo/engine';
import { PlanTargets } from '../../shared/models/domain';

/** Aviso cuando el paciente aún no tiene Dietocálculo: los objetivos del plan salen de una estimación general. */
export const BASE_TARGETS_NOTICE =
  'Los objetivos se calculan con una estimación base (mediciones del paciente, actividad estándar y la meta registrada). ' +
  'Para obtener mayor precisión, usa el motor del Dietocálculo y enlázalo a este paciente.';

const fmt = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * Objetivos diarios de un plan a partir de lo que prescribe un Dietocálculo: energía de la prescripción, gramos de
 * macronutrimentos y el reparto de equivalentes del cuadro dietosintético (solo los grupos con equivalentes).
 */
export function planTargetsFromDiet(r: DietResult, version = 1): PlanTargets {
  const equivalents: Record<string, string> = {};
  for (const row of r.dietosintetico.rows) if (row.equivalents > 0) equivalents[row.code] = fmt(row.equivalents);
  return {
    energy: fmt(r.energy.prescription_kcal),
    protein: fmt(r.macros.protein_g),
    carbs: fmt(r.macros.carbs_g),
    lipids: fmt(r.macros.lipids_g),
    equivalents,
    version,
  };
}

/** «1810 kcal · 60 % HCO · 25 % LIP · 15 % PRO» */
export function dietSummary(r: DietResult): string {
  const m = r.macros;
  return `${fmt(r.energy.prescription_kcal)} kcal · ${Math.round(m.carbs_pct)} % HCO · ${Math.round(m.lipids_pct)} % LIP · ${Math.round(m.protein_pct)} % PRO`;
}

/** ¿Los objetivos del plan coinciden con los del Dietocálculo (energía y macronutrimentos)? */
export function sameTargets(a: PlanTargets, b: PlanTargets): boolean {
  const eq = (x: string, y: string): boolean => Math.abs(Number(x) - Number(y)) < 0.05;
  return eq(a.energy, b.energy) && eq(a.protein, b.protein) && eq(a.carbs, b.carbs) && eq(a.lipids, b.lipids);
}
