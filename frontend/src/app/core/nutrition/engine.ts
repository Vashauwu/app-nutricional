import {
  CustomFood,
  DecimalStr,
  Dish,
  DishVersion,
  EquivalentsMap,
  FoodRef,
  Goal,
  Id,
  Ingredient,
  Measurement,
  NutrientProfile,
  Nutrients,
  NutritionSnapshot,
  PlanDay,
  PlanTargets,
  Sex,
  SmaeFood,
  SmaePortion,
  EquivalenceRule,
} from '../../shared/models/domain';
import { add, dec, div, mul, sum } from '../../shared/utils/decimal';

/**
 * Motor nutricional del cliente (§7.2, §30). Funciones puras: sin Angular, sin
 * HTTP. Toda la aritmética pasa por decimal.js con la política del §7.3
 * (sumas/productos exactos; divisiones a 16 decimales, Round Half Even).
 */
export const ENGINE_VERSION = 'fe-1.0.0';

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export const NUTRIENT_KEYS = ['energy', 'protein', 'carbs', 'lipids', 'fiber'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export const zeroNutrients = (): Nutrients => ({ energy: '0', protein: '0', carbs: '0', lipids: '0', fiber: '0' });

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out = zeroNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = add(a[k], b[k]).toString();
  return out;
}

export function sumNutrients(list: Nutrients[]): Nutrients {
  return list.reduce(addNutrients, zeroNutrients());
}

export function scaleNutrients(n: Nutrients, factor: DecimalStr): Nutrients {
  const out = zeroNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = mul(n[k], factor).toString();
  return out;
}

export function divideNutrients(n: Nutrients, divisor: DecimalStr): Nutrients {
  const out = zeroNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = div(n[k], divisor).toString();
  return out;
}

export function diffNutrients(after: Nutrients, before: Nutrients): Nutrients {
  const out = zeroNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = dec(after[k]).minus(before[k]).toString();
  return out;
}

export function addEquivalents(a: EquivalentsMap, b: EquivalentsMap): EquivalentsMap {
  const out: EquivalentsMap = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = add(out[k] ?? '0', v).toString();
  return out;
}

export function scaleEquivalents(map: EquivalentsMap, factor: DecimalStr): EquivalentsMap {
  const out: EquivalentsMap = {};
  for (const [k, v] of Object.entries(map)) out[k] = mul(v, factor).toString();
  return out;
}

// ---------- Alimentos (SMAE o personalizados) ----------
export interface FoodView {
  ref: FoodRef;
  name: string;
  official: boolean;
  portions: SmaePortion[];
  profile: NutrientProfile;
  densityGPerMl?: DecimalStr;
  equivalence?: EquivalenceRule;
  tags: string[];
  editionId?: Id;
  code?: string;
}

export const fromSmae = (f: SmaeFood): FoodView => ({
  ref: { kind: 'smae', id: f.id },
  name: f.name,
  official: true,
  portions: f.portions,
  profile: f.profile,
  densityGPerMl: f.densityGPerMl,
  equivalence: f.equivalence,
  tags: f.tags,
  editionId: f.editionId,
  code: f.code,
});

export const fromCustom = (f: CustomFood): FoodView => ({
  ref: { kind: 'custom', id: f.id },
  name: f.name,
  official: false,
  portions: f.portions,
  profile: f.profile,
  equivalence: f.equivalence,
  tags: f.tags,
});

export interface UnitOption {
  unit: string;
  label: string;
}

/** Unidades válidas para el alimento. No se convierte masa↔volumen sin densidad (§30.4). */
export function availableUnits(food: FoodView): UnitOption[] {
  const units: UnitOption[] = [{ unit: 'g', label: 'gramos (g)' }];
  if (food.densityGPerMl || food.profile.basisUnit === 'ml') units.push({ unit: 'ml', label: 'mililitros (ml)' });
  for (const p of food.portions) {
    if (!units.some((u) => u.unit === p.unit)) {
      units.push({ unit: p.unit, label: `${p.name} (${Number(p.gramsEquivalent)} g)` });
    }
  }
  return units;
}

/** Cantidad normalizada en gramos. Rechaza conversiones dimensionalmente inválidas. */
export function toGrams(food: FoodView, quantity: DecimalStr, unit: string): string {
  const q = dec(quantity);
  if (q.isNaN() || q.isNegative()) throw new EngineError('La cantidad debe ser un número positivo.');
  if (unit === 'g') return q.toString();
  if (unit === 'ml') {
    if (!food.densityGPerMl) throw new EngineError(`"${food.name}" no tiene densidad registrada: no se puede convertir ml a g.`);
    return mul(q, food.densityGPerMl).toString();
  }
  const portion = food.portions.find((p) => p.unit === unit);
  if (!portion) throw new EngineError(`La unidad "${unit}" no está definida para "${food.name}".`);
  return mul(div(q, portion.quantity), portion.gramsEquivalent).toString();
}

export function calcIngredient(food: FoodView, quantity: DecimalStr, unit: string): Omit<Ingredient, 'id'> {
  const grams = toGrams(food, quantity, unit);
  const basis = food.profile;
  let qNorm = dec(grams);
  if (basis.basisUnit === 'ml') {
    if (!food.densityGPerMl) throw new EngineError(`"${food.name}" requiere densidad para calcular su base en ml.`);
    qNorm = div(grams, food.densityGPerMl);
  }
  const factor = div(qNorm, basis.basisQuantity);
  const nutrients: Nutrients = {
    energy: mul(basis.energy, factor).toString(),
    protein: mul(basis.protein, factor).toString(),
    carbs: mul(basis.carbs, factor).toString(),
    lipids: mul(basis.lipids, factor).toString(),
    fiber: mul(basis.fiber, factor).toString(),
  };
  const eq = food.equivalence;
  return {
    food: food.ref,
    nameSnapshot: food.name,
    quantity,
    unit,
    grams,
    nutrients,
    official: food.official,
    equivalent: eq
      ? { subgroupCode: eq.subgroupCode, value: mul(div(grams, eq.referenceGrams), eq.equivalentValue).toString() }
      : undefined,
  };
}

export function calcDish(
  ingredients: Pick<Ingredient, 'nutrients' | 'equivalent' | 'official'>[],
  servings: DecimalStr,
  smaeEditionId: Id,
): NutritionSnapshot {
  const s = dec(servings);
  if (s.isNaN() || s.lte(0)) throw new EngineError('Las porciones deben ser mayores a cero.');
  const totals = sumNutrients(ingredients.map((i) => i.nutrients));
  const eqTotals: EquivalentsMap = {};
  for (const i of ingredients) {
    if (i.equivalent) eqTotals[i.equivalent.subgroupCode] = add(eqTotals[i.equivalent.subgroupCode] ?? '0', i.equivalent.value).toString();
  }
  const equivalents: EquivalentsMap = {};
  for (const [k, v] of Object.entries(eqTotals)) equivalents[k] = div(v, servings).toString();
  return {
    totals,
    perServing: divideNutrients(totals, servings),
    equivalents,
    hasCustomFoods: ingredients.some((i) => !i.official),
    smaeEditionId,
    engineVersion: ENGINE_VERSION,
    calculatedAt: new Date().toISOString(),
  };
}

// ---------- Planes: agregación y comparación ----------
export interface Totals {
  nutrients: Nutrients;
  equivalents: EquivalentsMap;
}

export const emptyTotals = (): Totals => ({ nutrients: zeroNutrients(), equivalents: {} });

export function addTotals(a: Totals, b: Totals): Totals {
  return { nutrients: addNutrients(a.nutrients, b.nutrients), equivalents: addEquivalents(a.equivalents, b.equivalents) };
}

export type DishLookup = (dishId: Id, version: number) => DishVersion | undefined;

export function itemTotals(dish: DishVersion | undefined, servings: DecimalStr): Totals {
  if (!dish) return emptyTotals();
  return {
    nutrients: scaleNutrients(dish.nutrition.perServing, servings),
    equivalents: scaleEquivalents(dish.nutrition.equivalents, servings),
  };
}

export function slotTotals(
  items: { dishId: Id; dishVersion: number; servings: DecimalStr }[],
  lookup: DishLookup,
): Totals {
  return items.reduce((acc, it) => addTotals(acc, itemTotals(lookup(it.dishId, it.dishVersion), it.servings)), emptyTotals());
}

export function dayTotals(day: PlanDay, lookup: DishLookup): Totals {
  return day.slots.reduce((acc, s) => addTotals(acc, slotTotals(s.items, lookup)), emptyTotals());
}

export type CompareStatus = 'ok' | 'under' | 'over' | 'none';

export interface MetricComparison {
  key: string;
  label: string;
  unit: string;
  planned: DecimalStr;
  target: DecimalStr;
  diff: DecimalStr;
  pct: number;
  status: CompareStatus;
}

export interface Tolerances {
  energyPct: number;
  macroPct: number;
  equivalent: number;
}

function judge(planned: DecimalStr, target: DecimalStr, tolPct: number): { pct: number; status: CompareStatus } {
  if (dec(target).isZero()) return { pct: 0, status: 'none' };
  const pct = Number(div(dec(planned).minus(target), target).times(100).toFixed(2));
  if (Math.abs(pct) <= tolPct) return { pct, status: 'ok' };
  return { pct, status: pct < 0 ? 'under' : 'over' };
}

export function compareMacros(totals: Totals, targets: PlanTargets, tol: Tolerances): MetricComparison[] {
  const rows: [string, string, string, DecimalStr, DecimalStr, number][] = [
    ['energy', 'Energía', 'kcal', totals.nutrients.energy, targets.energy, tol.energyPct],
    ['protein', 'Proteínas', 'g', totals.nutrients.protein, targets.protein, tol.macroPct],
    ['carbs', 'Carbohidratos', 'g', totals.nutrients.carbs, targets.carbs, tol.macroPct],
    ['lipids', 'Lípidos', 'g', totals.nutrients.lipids, targets.lipids, tol.macroPct],
  ];
  return rows.map(([key, label, unit, planned, target, t]) => ({
    key,
    label,
    unit,
    planned,
    target,
    diff: dec(planned).minus(target).toString(),
    ...judge(planned, target, t),
  }));
}

export function compareEquivalents(
  totals: Totals,
  targets: PlanTargets,
  names: (code: string) => string,
  tol: Tolerances,
): MetricComparison[] {
  const ids = new Set([...Object.keys(targets.equivalents), ...Object.keys(totals.equivalents)]);
  return [...ids].map((id) => {
    const planned = totals.equivalents[id] ?? '0';
    const target = targets.equivalents[id] ?? '0';
    const diff = dec(planned).minus(target);
    const status: CompareStatus = dec(target).isZero() && dec(planned).isZero() ? 'none' : diff.abs().lte(tol.equivalent) ? 'ok' : diff.isNegative() ? 'under' : 'over';
    return { key: id, label: names(id), unit: 'eq.', planned, target, diff: diff.toString(), pct: 0, status };
  });
}

// ---------- Propuestas orientativas (§7.2, §30.7) ----------
export interface TargetProposal {
  energy: DecimalStr;
  protein: DecimalStr;
  carbs: DecimalStr;
  lipids: DecimalStr;
  /** Equivalentes sugeridos por código de subgrupo. */
  equivalentsByCode: Record<string, DecimalStr>;
  rationale: string[];
}

const BASE_EQUIVALENTS_2000: Record<string, number> = {
  'VER': 4, 'FRU': 3, 'CER-SG': 6, 'LEG': 1.5, 'AOA-MB': 3, 'AOA-B': 3, 'LEC-S': 1.5, 'GRA': 5, 'AZU': 2,
};

/** Mifflin-St Jeor + factor de actividad. Orientativo: la nutrióloga ajusta. */
export function proposeTargets(opts: {
  sex: Sex;
  age: number;
  weightKg: DecimalStr;
  heightCm: DecimalStr;
  goal: Goal;
  activityFactor?: number;
}): TargetProposal {
  const w = dec(opts.weightKg);
  const h = dec(opts.heightCm);
  const sexConst = opts.sex === 'M' ? 5 : opts.sex === 'F' ? -161 : -78;
  const bmr = w.times(10).plus(h.times(6.25)).minus(opts.age * 5).plus(sexConst);
  const activity = opts.activityFactor ?? 1.4;
  let energy = bmr.times(activity);
  const rationale = [
    `Tasa metabólica basal (Mifflin-St Jeor): ${bmr.toFixed(0)} kcal.`,
    `Factor de actividad ${activity}: ${energy.toFixed(0)} kcal de gasto estimado.`,
  ];
  if (opts.goal === 'weight_loss') {
    energy = energy.minus(500);
    rationale.push('Objetivo de pérdida de peso: −500 kcal/día (déficit moderado).');
  } else if (opts.goal === 'muscle_gain') {
    energy = energy.plus(300);
    rationale.push('Objetivo de ganancia muscular: +300 kcal/día.');
  }
  energy = energy.toDecimalPlaces(0, 6);
  const proteinPerKg = opts.goal === 'muscle_gain' ? 1.8 : opts.goal === 'weight_loss' ? 1.4 : 1.2;
  const protein = w.times(proteinPerKg).toDecimalPlaces(0, 6);
  const lipidKcal = energy.times(0.28);
  const lipids = lipidKcal.div(9).toDecimalPlaces(0, 6);
  const carbs = energy.minus(protein.times(4)).minus(lipids.times(9)).div(4).toDecimalPlaces(0, 6);
  rationale.push(`Proteínas ${proteinPerKg} g/kg, lípidos 28 % de la energía, carbohidratos por diferencia.`);
  const scale = energy.div(2000);
  const equivalentsByCode: Record<string, DecimalStr> = {};
  for (const [code, base] of Object.entries(BASE_EQUIVALENTS_2000)) {
    equivalentsByCode[code] = scale.times(base).times(2).toDecimalPlaces(0, 6).div(2).toString();
  }
  rationale.push('Distribución de equivalentes escalada desde una base de 2 000 kcal.');
  return {
    energy: energy.toString(),
    protein: protein.toString(),
    carbs: carbs.toString(),
    lipids: lipids.toString(),
    equivalentsByCode,
    rationale,
  };
}

/** IMC con la política decimal (peso / talla²). */
export function computeBmi(weightKg: DecimalStr, heightCm: DecimalStr): DecimalStr {
  const m = div(heightCm, '100');
  return div(weightKg, mul(m, m)).toDecimalPlaces(2, 6).toString();
}

export function latestMeasurement(list: Measurement[]): Measurement | undefined {
  return [...list].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
}

/** Reparto orientativo de equivalentes por tiempo de comida. */
export function distributeEquivalents(
  daily: EquivalentsMap,
  slotNames: readonly string[],
): Record<string, EquivalentsMap> {
  const weightsDefault: Record<string, number> = {
    Desayuno: 0.25,
    'Colación matutina': 0.1,
    Comida: 0.35,
    'Colación vespertina': 0.1,
    Cena: 0.2,
  };
  const raw = slotNames.map((n) => weightsDefault[n] ?? 0.15);
  const total = raw.reduce((a, b) => a + b, 0);
  const out: Record<string, EquivalentsMap> = {};
  slotNames.forEach((name, i) => {
    out[name] = {};
    for (const [sg, v] of Object.entries(daily)) {
      out[name][sg] = dec(v).times(raw[i] / total).times(2).toDecimalPlaces(0, 6).div(2).toString();
    }
  });
  return out;
}

export { sum };
