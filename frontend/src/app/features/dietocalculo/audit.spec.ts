import { describe, expect, it } from 'vitest';
import { OBJECTIVES, applyPlan, audit, realism } from './audit';
import { compute, defaultInputs, normalize } from './engine';

function base() {
  const i = defaultInputs();
  i.age = 35; i.weight_kg = 72; i.height_cm = 164; i.sex = 'F';
  normalize(i);
  return i;
}

describe('audit (Inteligencia de equivalentes)', () => {
  it.each(OBJECTIVES.map((o) => o.id))('la propuesta «%s» cubre la meta de energía dentro de ±8 %', (id) => {
    const i = base();
    const a = audit(i, compute(i), id);
    expect(Math.abs(a.suggestedKcal - compute(i).dietosintetico.target.kcal) / a.suggestedKcal).toBeLessThan(0.08);
    expect(a.rows).toHaveLength(17);
  });

  it('aplicar la propuesta completa deja el cuadro en el objetivo y sin ajustes pendientes', () => {
    const i = base();
    const a = audit(i, compute(i), 'weight');
    const j = { ...i, ...applyPlan(i, a, false) };
    const b = audit(j, compute(j), 'weight');
    expect(b.deviations).toHaveLength(0);
    expect(j.macros.carbs_pct).toBe(45);
  });

  it('«solo desvíos» no toca lo que ya coincide', () => {
    const i = base();
    const a = audit(i, compute(i), 'glycemic');
    const p = applyPlan(i, a, true);
    expect(Object.keys(p.equivalents ?? {}).sort()).toEqual(a.deviations.map((d) => d.code).sort());
  });

  it('el índice de practicidad baja con porciones irreales', () => {
    expect(realism({ VER: 4, FRU: 3, 'CER-SG': 8, LEG: 1, 'AOA-M': 4, 'LEC-D': 1, GRA: 3 }).score).toBeGreaterThanOrEqual(80);
    expect(realism({ VER: 20, 'CER-SG': 30, GRA: 15 }).score).toBeLessThan(75);
  });
});
