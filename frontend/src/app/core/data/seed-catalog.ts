import { SmaeEdition, SmaeFood, SmaeGroup, SmaeSubgroup } from '../../shared/models/domain';

/**
 * Catálogo de EJEMPLO para desarrollo y demostración. No reproduce tablas del
 * libro SMAE (§30, §25.1): son valores aproximados y sintéticos para ejercitar
 * el motor. La carga real requiere una fuente licenciada.
 */
export const ED1 = 'ed-4';
export const ED2 = 'ed-4b';

type GroupSeed = [code: string, name: string, tone: SmaeGroup['tone'], subgroups: [string, string][]];

const GROUPS: GroupSeed[] = [
  ['VER', 'Verduras', 'salvia', [['VER', 'Verduras']]],
  ['FRU', 'Frutas', 'rosa', [['FRU', 'Frutas']]],
  ['CER', 'Cereales y tubérculos', 'mantequilla', [['CER-SG', 'Cereales sin grasa'], ['CER-CG', 'Cereales con grasa']]],
  ['LEG', 'Leguminosas', 'lavanda', [['LEG', 'Leguminosas']]],
  ['AOA', 'Alimentos de origen animal', 'cielo', [
    ['AOA-MB', 'Muy bajo aporte de grasa'], ['AOA-B', 'Bajo aporte de grasa'], ['AOA-M', 'Moderado aporte de grasa'], ['AOA-A', 'Alto aporte de grasa'],
  ]],
  ['LEC', 'Leche', 'cielo', [['LEC-D', 'Leche descremada'], ['LEC-S', 'Leche semidescremada'], ['LEC-E', 'Leche entera']]],
  ['ACE', 'Aceites y grasas', 'mantequilla', [['GRA', 'Grasas sin proteína'], ['GRP', 'Grasas con proteína']]],
  ['AZU', 'Azúcares', 'rosa', [['AZU', 'Azúcares sin grasa']]],
  ['LIB', 'Libres de energía', 'salvia', [['LIB', 'Libres de energía']]],
];

// [código, nombre, subgrupo, [kcal, prot, carb, lip, fibra] por 100 g, gramos por 1 eq., porciones [nombre, unidad, g], etiquetas, densidad]
type FoodSeed = [
  string, string, string, [number, number, number, number, number], number,
  [string, string, number][], string[], number?,
];

export const FOODS: FoodSeed[] = [
  ['BROC', 'Brócoli cocido', 'VER', [35, 2.4, 7.2, 0.4, 3.3], 70, [['Taza', 'taza', 90]], ['verdura']],
  ['JITO', 'Jitomate', 'VER', [18, 0.9, 3.9, 0.2, 1.2], 140, [['Pieza mediana', 'pieza', 120]], ['verdura']],
  ['ESPI', 'Espinaca cruda', 'VER', [23, 2.9, 3.6, 0.4, 2.2], 110, [['Taza', 'taza', 30]], ['verdura']],
  ['ZANA', 'Zanahoria', 'VER', [41, 0.9, 9.6, 0.2, 2.8], 60, [['Pieza mediana', 'pieza', 70]], ['verdura']],
  ['CALA', 'Calabacita cocida', 'VER', [17, 1.2, 3.1, 0.3, 1], 150, [['Taza', 'taza', 180]], ['verdura']],
  ['NOPA', 'Nopal cocido', 'VER', [16, 1.3, 3.3, 0.1, 2.2], 150, [['Taza', 'taza', 150]], ['verdura']],
  ['LECH', 'Lechuga romana', 'VER', [17, 1.2, 3.3, 0.3, 2.1], 150, [['Taza', 'taza', 50]], ['verdura']],
  ['PEPI', 'Pepino', 'VER', [15, 0.7, 3.6, 0.1, 0.5], 160, [['Taza rebanado', 'taza', 120]], ['verdura']],
  ['CHAY', 'Chayote cocido', 'VER', [24, 0.6, 5.1, 0.3, 1.7], 100, [['Taza', 'taza', 160]], ['verdura']],
  ['CEBO', 'Cebolla', 'VER', [40, 1.1, 9.3, 0.1, 1.7], 60, [['Pieza mediana', 'pieza', 110]], ['verdura']],
  ['MANZ', 'Manzana', 'FRU', [52, 0.3, 13.8, 0.2, 2.4], 115, [['Pieza mediana', 'pieza', 180]], ['fruta']],
  ['PLAT', 'Plátano', 'FRU', [89, 1.1, 22.8, 0.3, 2.6], 65, [['Pieza mediana', 'pieza', 120]], ['fruta']],
  ['NARA', 'Naranja', 'FRU', [47, 0.9, 11.8, 0.1, 2.4], 130, [['Pieza mediana', 'pieza', 150]], ['fruta', 'cítrico']],
  ['FRES', 'Fresa', 'FRU', [32, 0.7, 7.7, 0.3, 2], 185, [['Taza', 'taza', 150]], ['fruta']],
  ['PAPA', 'Papaya', 'FRU', [43, 0.5, 11, 0.3, 1.7], 140, [['Taza picada', 'taza', 140]], ['fruta']],
  ['MANG', 'Mango', 'FRU', [60, 0.8, 15, 0.4, 1.6], 100, [['Taza picado', 'taza', 165]], ['fruta']],
  ['UVAS', 'Uvas', 'FRU', [69, 0.7, 18, 0.2, 0.9], 85, [['Taza', 'taza', 150]], ['fruta']],
  ['SAND', 'Sandía', 'FRU', [30, 0.6, 7.6, 0.2, 0.4], 200, [['Taza picada', 'taza', 150]], ['fruta']],
  ['TORT', 'Tortilla de maíz', 'CER-SG', [218, 5.7, 44.6, 2.9, 6.3], 32, [['Pieza', 'pieza', 30]], ['cereal', 'maíz']],
  ['ARRO', 'Arroz cocido', 'CER-SG', [130, 2.7, 28, 0.3, 0.4], 54, [['Taza', 'taza', 160]], ['cereal']],
  ['PANI', 'Pan integral', 'CER-SG', [247, 13, 41, 3.4, 7], 28, [['Rebanada', 'rebanada', 28]], ['cereal', 'trigo', 'gluten']],
  ['AVEN', 'Avena en hojuelas', 'CER-SG', [389, 16.9, 66, 6.9, 10.6], 18, [['Taza', 'taza', 80], ['Cucharada', 'cda', 8]], ['cereal', 'avena']],
  ['PAPC', 'Papa cocida', 'CER-SG', [87, 1.9, 20, 0.1, 1.8], 80, [['Pieza mediana', 'pieza', 150]], ['tubérculo']],
  ['PAST', 'Pasta cocida', 'CER-SG', [158, 5.8, 30.9, 0.9, 1.8], 45, [['Taza', 'taza', 140]], ['cereal', 'trigo', 'gluten']],
  ['CAMO', 'Camote cocido', 'CER-SG', [90, 2, 20.7, 0.2, 3.3], 78, [['Pieza mediana', 'pieza', 130]], ['tubérculo']],
  ['FRIJ', 'Frijol cocido', 'LEG', [127, 8.7, 22.8, 0.5, 6.4], 90, [['Taza', 'taza', 170]], ['leguminosa']],
  ['LENT', 'Lenteja cocida', 'LEG', [116, 9, 20, 0.4, 7.9], 100, [['Taza', 'taza', 200]], ['leguminosa']],
  ['GARB', 'Garbanzo cocido', 'LEG', [164, 8.9, 27.4, 2.6, 7.6], 70, [['Taza', 'taza', 164]], ['leguminosa']],
  ['POLL', 'Pechuga de pollo sin piel, cocida', 'AOA-MB', [165, 31, 0, 3.6, 0], 30, [['Pieza mediana', 'pieza', 120]], ['pollo', 'carne']],
  ['CLAR', 'Clara de huevo', 'AOA-MB', [52, 10.9, 0.7, 0.2, 0], 66, [['Clara', 'pieza', 33]], ['huevo']],
  ['ATUN', 'Atún en agua', 'AOA-MB', [116, 25.5, 0, 0.8, 0], 35, [['Lata', 'lata', 140]], ['pescado', 'atún']],
  ['TILA', 'Pescado blanco (tilapia) cocido', 'AOA-MB', [128, 26.2, 0, 2.7, 0], 40, [['Filete', 'pieza', 120]], ['pescado']],
  ['HUEV', 'Huevo entero', 'AOA-B', [143, 12.6, 0.7, 9.5, 0], 50, [['Pieza', 'pieza', 50]], ['huevo']],
  ['PANE', 'Queso panela', 'AOA-B', [264, 18, 3, 20, 0], 40, [['Rebanada', 'rebanada', 40]], ['lácteo', 'queso']],
  ['RESM', 'Carne de res magra, cocida', 'AOA-B', [217, 26, 0, 12, 0], 30, [['Porción', 'porcion', 90]], ['res', 'carne']],
  ['SALM', 'Salmón cocido', 'AOA-M', [208, 20, 0, 13, 0], 35, [['Filete', 'pieza', 120]], ['pescado', 'salmón']],
  ['LDES', 'Leche descremada', 'LEC-D', [35, 3.4, 5, 0.1, 0], 240, [['Taza (240 ml)', 'taza', 247]], ['lácteo', 'leche'], 1.03],
  ['LSEM', 'Leche semidescremada', 'LEC-S', [47, 3.4, 4.8, 1.6, 0], 240, [['Taza (240 ml)', 'taza', 247]], ['lácteo', 'leche'], 1.03],
  ['YOGU', 'Yogurt natural', 'LEC-S', [61, 3.5, 4.7, 3.3, 0], 245, [['Taza', 'taza', 245]], ['lácteo', 'yogurt']],
  ['ACEI', 'Aceite de oliva', 'GRA', [884, 0, 0, 100, 0], 5, [['Cucharadita', 'cdita', 4.5], ['Cucharada', 'cda', 13.5]], ['grasa'], 0.91],
  ['AGUA', 'Aguacate', 'GRA', [160, 2, 8.5, 14.7, 6.7], 28, [['Pieza mediana', 'pieza', 150], ['Rebanada', 'rebanada', 30]], ['grasa', 'aguacate']],
  ['ALME', 'Almendras', 'GRP', [579, 21, 21.6, 49.9, 12.5], 8, [['Pieza', 'pieza', 1.2], ['Cucharada', 'cda', 10]], ['oleaginosa', 'almendra', 'frutos secos']],
  ['CACA', 'Cacahuate', 'GRP', [567, 25.8, 16.1, 49.2, 8.5], 9, [['Cucharada', 'cda', 9]], ['oleaginosa', 'cacahuate']],
  ['MIEL', 'Miel de abeja', 'AZU', [304, 0.3, 82, 0, 0.2], 13, [['Cucharadita', 'cdita', 7]], ['azúcar', 'miel']],
  ['AZUC', 'Azúcar', 'AZU', [387, 0, 100, 0, 0], 10, [['Cucharadita', 'cdita', 4]], ['azúcar']],
  ['CAFE', 'Café sin azúcar', 'LIB', [1, 0.1, 0, 0, 0], 240, [['Taza', 'taza', 240]], ['bebida']],
];

/** Cambios de la "fe de erratas" de ejemplo (edición borrador para probar el recálculo, §7.4). */
export const ERRATA: Record<string, Partial<Record<'energy' | 'protein' | 'carbs' | 'lipids', number>>> = {
  AVEN: { energy: 379, protein: 13.2, carbs: 67.7 },
  ARRO: { energy: 128 },
  AGUA: { energy: 167, lipids: 15.4 },
  HUEV: { energy: 148, lipids: 9.9 },
};

export function buildEditions(): SmaeEdition[] {
  return [
    {
      id: ED1,
      name: 'SMAE 4.ª edición (datos de ejemplo)',
      editionNumber: 4,
      publisher: 'Referencia — pendiente de fuente licenciada',
      sourceReference: 'Carga sintética para desarrollo',
      licenseReference: 'Sin licencia: no usar en producción',
      effectiveDate: '2024-01-01',
      importedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      status: 'active',
      notes: 'Valores aproximados para ejercitar el motor. No son datos oficiales.',
    },
    {
      id: ED2,
      name: 'SMAE 4.ª edición — fe de erratas 2026-1 (ejemplo)',
      editionNumber: 4,
      publisher: 'Referencia — pendiente de fuente licenciada',
      sourceReference: 'Lote de importación de ejemplo #2',
      licenseReference: 'Sin licencia: no usar en producción',
      effectiveDate: '2026-11-01',
      importedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      status: 'draft',
      notes: 'Borrador: corrige 4 alimentos. No se activa hasta autorizar el recálculo.',
    },
  ];
}

export function buildTaxonomy(editionId: string): { groups: SmaeGroup[]; subgroups: SmaeSubgroup[] } {
  const suffix = editionId === ED1 ? '' : '2';
  const groups: SmaeGroup[] = [];
  const subgroups: SmaeSubgroup[] = [];
  GROUPS.forEach(([code, name, tone, subs], i) => {
    const gid = `g${suffix}-${code}`;
    groups.push({ id: gid, editionId, code, name, sortOrder: i + 1, tone });
    for (const [scode, sname] of subs) subgroups.push({ id: `sg${suffix}-${scode}`, groupId: gid, code: scode, name: sname });
  });
  return { groups, subgroups };
}

export function buildFoods(editionId: string): SmaeFood[] {
  const suffix = editionId === ED1 ? '' : '2';
  return FOODS.map(([code, name, sub, [kcal, p, c, l, f], ref, portions, tags, density]) => {
    const fix = editionId === ED2 ? ERRATA[code] : undefined;
    const n = (v: number): string => String(v);
    return {
      id: `f${suffix}-${code}`,
      editionId,
      code,
      name,
      foodState: 'Peso neto, parte comestible',
      ediblePct: '100',
      portions: portions.map(([pname, unit, grams], i) => ({
        id: `p${suffix}-${code}-${i}`,
        name: pname,
        quantity: '1',
        unit,
        gramsEquivalent: n(grams),
        isReference: i === 0,
      })),
      profile: {
        basisQuantity: '100',
        basisUnit: 'g' as const,
        energy: n(fix?.energy ?? kcal),
        protein: n(fix?.protein ?? p),
        carbs: n(fix?.carbs ?? c),
        lipids: n(fix?.lipids ?? l),
        fiber: n(f),
      },
      equivalence: { subgroupCode: sub, referenceGrams: n(ref), equivalentValue: '1' },
      densityGPerMl: density !== undefined ? n(density) : undefined,
      tags,
      sourceReference: 'Dato de ejemplo',
    };
  });
}
