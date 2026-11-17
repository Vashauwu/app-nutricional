import { describe, expect, it } from 'vitest';
import { compute, defaultInputs, normalize } from '../../features/dietocalculo/engine';
import { dietLinkState, dietSummary, planTargetsFromDiet, sameTargets } from './diet-targets';

function diet() {
  const i = { ...defaultInputs(), age: 34, weight_kg: 72, height_cm: 168, activity: 'moderate' as const, kcal_target: 1810 };
  normalize(i);
  return compute(i);
}

describe('objetivos del plan desde el Dietocálculo', () => {
  const r = diet();
  const t = planTargetsFromDiet(r);

  it('toma la energía de la prescripción y los gramos de cada macronutrimento', () => {
    expect(Number(t.energy)).toBeCloseTo(r.energy.prescription_kcal, 1);
    expect(Number(t.protein)).toBeCloseTo(r.macros.protein_g, 1);
    expect(Number(t.carbs)).toBeCloseTo(r.macros.carbs_g, 1);
    expect(Number(t.lipids)).toBeCloseTo(r.macros.lipids_g, 1);
  });

  it('copia el reparto de equivalentes del cuadro dietosintético, solo de los grupos con equivalentes', () => {
    const rows = r.dietosintetico.rows.filter((x) => x.equivalents > 0);
    expect(Object.keys(t.equivalents).sort()).toEqual(rows.map((x) => x.code).sort());
    for (const x of rows) expect(Number(t.equivalents[x.code])).toBeCloseTo(x.equivalents, 1);
  });

  it('resume la prescripción y reconoce si los objetivos coinciden', () => {
    expect(dietSummary(r)).toMatch(/kcal · \d+ % HCO · \d+ % LIP · \d+ % PRO/);
    expect(sameTargets(t, { ...t })).toBe(true);
    expect(sameTargets(t, { ...t, energy: '2412' })).toBe(false);
  });

  it('guarda el origen (id y versión del Dietocálculo) en los objetivos', () => {
    const o = planTargetsFromDiet(r, 1, { id: 'dc-1', updatedAt: '2026-11-17T10:00:00Z' });
    expect(o.dietCalcId).toBe('dc-1');
    expect(o.dietSyncedAt).toBe('2026-11-17T10:00:00Z');
    expect(planTargetsFromDiet(r).dietCalcId).toBeNull();
  });

  it('distingue objetivos iguales, ajustados a mano y Dietocálculo modificado después', () => {
    const diet = { result: r, updatedAt: '2026-11-17T10:00:00Z' };
    const applied = planTargetsFromDiet(r, 1, { id: 'dc-1', updatedAt: diet.updatedAt });
    expect(dietLinkState(applied, diet)).toBe('same');
    expect(dietLinkState({ ...applied, energy: '1900' }, diet)).toBe('manual');
    expect(dietLinkState({ ...applied, energy: '1900' }, { ...diet, updatedAt: '2026-11-18T10:00:00Z' })).toBe('outdated');
    expect(dietLinkState({ ...applied, dietSyncedAt: null, energy: '1900' }, diet)).toBe('manual');
  });
});
