import { describe, expect, it } from 'vitest';
import golden from './engine.golden.json';
import { DietInputs, DietResult, compute, normalize, bmiClass } from './engine';

describe('Motor de Dietocálculo (paridad con Go)', () => {
  (golden as unknown as { in: DietInputs; out: DietResult }[]).forEach((c, idx) => {
    it(`vector ${idx + 1} coincide con el backend`, () => {
      const input = structuredClone(c.in);
      expect(normalize(input)).toBeNull();
      // Se compara tras JSON para ignorar `undefined` y -0, igual que lo que viaja por el API.
      expect(JSON.parse(JSON.stringify(compute(input)))).toEqual(c.out);
    });
  });

  it('clasifica el IMC con la NOM-008 y estatura baja', () => {
    expect(bmiClass(18.4, 173, 'F').label).toBe('Bajo peso');
    expect(bmiClass(23.5, 148, 'F').label).toBe('Sobrepeso');
    expect(bmiClass(23.5, 165, 'F').label).toBe('Peso normal');
  });

  it('valida rangos y suma de macros', () => {
    const e = normalize({ sex: 'F', age: 5, weight_kg: 5, height_cm: 173, activity: 'light', formula: 'mifflin', thermic: false, athlete: false, hospitalized: false, goal: 'maintain', macros: { carbs_pct: 50, lipids_pct: 30, protein_pct: 30 } });
    expect(Object.keys(e ?? {})).toEqual(expect.arrayContaining(['age', 'weight_kg', 'macros']));
  });
});
