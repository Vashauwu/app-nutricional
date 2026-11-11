import { describe, expect, it } from 'vitest';
import { buildSeed } from '../data/seed';
import { evaluatePlanAlerts } from './alerts';
import {
  EngineError, FoodView, availableUnits, calcDish, calcIngredient, compareMacros, computeBmi, fromSmae, proposeTargets, toGrams,
} from './engine';
import { Db, DishVersion } from '../../shared/models/domain';

const db: Db = buildSeed();
const food = (code: string): FoodView => fromSmae(db.foods.find((f) => f.code === code && f.editionId === 'ed-4')!);

describe('motor nutricional del cliente', () => {
  it('convierte gramos y medidas caseras específicas de cada alimento', () => {
    expect(toGrams(food('POLL'), '120', 'g')).toBe('120');
    expect(toGrams(food('TORT'), '2', 'pieza')).toBe('60'); // 1 pieza = 30 g
    expect(toGrams(food('ARRO'), '1', 'taza')).toBe('160');
  });

  it('rechaza conversiones dimensionalmente inválidas (ml sin densidad, unidad inexistente)', () => {
    expect(() => toGrams(food('POLL'), '100', 'ml')).toThrow(EngineError);
    expect(() => toGrams(food('POLL'), '1', 'taza')).toThrow(EngineError);
    expect(() => toGrams(food('POLL'), '-5', 'g')).toThrow(EngineError);
  });

  it('solo ofrece ml cuando el alimento tiene densidad', () => {
    expect(availableUnits(food('POLL')).some((u) => u.unit === 'ml')).toBe(false);
    expect(availableUnits(food('LDES')).some((u) => u.unit === 'ml')).toBe(true);
  });

  it('calcula nutrientes proporcionales a la base y equivalentes por gramos de referencia', () => {
    const r = calcIngredient(food('POLL'), '60', 'g'); // base 100 g: 165 kcal; 1 eq = 30 g
    expect(r.nutrients.energy).toBe('99');
    expect(r.equivalent).toEqual({ subgroupCode: 'AOA-MB', value: '2' });
    expect(r.official).toBe(true);
  });

  it('divide por porciones con 16 decimales (Round Half Even) sin tocar los totales', () => {
    const ing = [calcIngredient(food('AVEN'), '100', 'g')];
    const snap = calcDish(ing, '3', 'ed-4');
    expect(snap.totals.energy).toBe('389');
    expect(snap.perServing.energy).toBe('129.6666666666666667');
  });

  it('rechaza porciones no positivas', () => {
    expect(() => calcDish([], '0', 'ed-4')).toThrow(EngineError);
  });

  it('calcula IMC con política decimal', () => {
    expect(computeBmi('70', '170')).toBe('24.22');
  });

  it('propone objetivos orientativos coherentes', () => {
    const r = proposeTargets({ sex: 'F', age: 34, weightKg: '78', heightCm: '164', goal: 'weight_loss' });
    expect(Number(r.energy)).toBeGreaterThan(1200);
    expect(Number(r.energy)).toBeLessThan(2200);
    expect(r.rationale.length).toBeGreaterThan(2);
  });

  it('marca desviaciones fuera de tolerancia con su dirección', () => {
    const rows = compareMacros(
      { nutrients: { energy: '1000', protein: '50', carbs: '100', lipids: '30', fiber: '0' }, equivalents: {} },
      { energy: '1500', protein: '50', carbs: '100', lipids: '30', equivalents: {}, version: 1 },
      { energyPct: 10, macroPct: 15, equivalent: 1 },
    );
    expect(rows.find((r) => r.key === 'energy')?.status).toBe('under');
    expect(rows.find((r) => r.key === 'protein')?.status).toBe('ok');
  });
});

describe('datos de ejemplo', () => {
  it('todo elemento de plan apunta a una versión existente e inmutable del platillo', () => {
    for (const plan of db.plans) {
      for (const day of plan.days) {
        for (const slot of day.slots) {
          for (const it of slot.items) {
            const v: DishVersion | undefined = db.dishes.find((d) => d.id === it.dishId)?.versions.find((x) => x.versionNumber === it.dishVersion);
            expect(v, `${plan.id} ${day.date} ${it.dishId}`).toBeDefined();
          }
        }
      }
    }
  });

  it('el catálogo de ejemplo declara que no es oficial', () => {
    expect(db.editions.every((e) => /ejemplo/i.test(e.name))).toBe(true);
  });
});

describe('alertas nutricionales', () => {
  it('detecta un alérgeno en un borrador y explica el origen', () => {
    const plan = db.plans.find((p) => p.id === 'pl-mariana')!;
    const patient = db.patients.find((p) => p.id === 'p-mariana')!;
    const alerts = evaluatePlanAlerts({
      patient, plan, settings: db.settings, dishes: db.dishes,
      lookup: (id, v) => db.dishes.find((d) => d.id === id)?.versions.find((x) => x.versionNumber === v),
      subgroupName: (c) => c,
    });
    const allergy = alerts.find((a) => a.kind === 'allergy');
    expect(allergy?.level).toBe('critical');
    expect(allergy?.reason).toContain('almendra');
    expect(allergy?.source).toContain('Frutos secos');
  });

  it('evalúa reglas clínicas configurables con la indicación del paciente', () => {
    const plan = db.plans.find((p) => p.id === 'pl-carlos')!;
    const patient = db.patients.find((p) => p.id === 'p-carlos')!;
    const alerts = evaluatePlanAlerts({
      patient, plan, settings: db.settings, dishes: db.dishes,
      lookup: (id, v) => db.dishes.find((d) => d.id === id)?.versions.find((x) => x.versionNumber === v),
      subgroupName: (c) => c,
    });
    expect(alerts.some((a) => a.kind === 'clinical')).toBe(true);
  });
});
