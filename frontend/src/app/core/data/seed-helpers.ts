import { PlanTargets } from '../../shared/models/domain';
import { Totals } from '../nutrition/engine';
import { dec } from '../../shared/utils/decimal';

/** Promedia los días y redondea: usado solo para derivar objetivos de los planes de ejemplo. */
export function sumNutrientsToTargets(days: Totals[], eqCodes: string[]): PlanTargets {
  const n = Math.max(days.length, 1);
  const avg = (get: (t: Totals) => string): string => days.reduce((a, t) => a.plus(get(t)), dec('0')).div(n).toString();
  const round = (v: string, step: number): string => dec(v).div(step).toDecimalPlaces(0, 6).times(step).toString();
  const equivalents: Record<string, string> = {};
  for (const code of eqCodes) {
    const v = avg((t) => t.equivalents[code] ?? '0');
    if (dec(v).gt(0)) equivalents[code] = round(v, 0.5);
  }
  return {
    energy: round(avg((t) => t.nutrients.energy), 50),
    protein: round(avg((t) => t.nutrients.protein), 5),
    carbs: round(avg((t) => t.nutrients.carbs), 5),
    lipids: round(avg((t) => t.nutrients.lipids), 5),
    equivalents,
    version: 1,
  };
}
