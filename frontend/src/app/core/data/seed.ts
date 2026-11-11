import {
  ConsentAcceptance,
  ConsentDocument,
  CustomFood,
  Db,
  DEFAULT_SLOTS,
  Dish,
  Id,
  Ingredient,
  Measurement,
  MealPlan,
  Patient,
  PlanDay,
  PlanTargets,
  PlanTemplate,
  Settings,
  TrackingEntry,
  User,
} from '../../shared/models/domain';
import { addDays, startOfWeek, todayIso, uid } from '../../shared/utils/format';
import { div } from '../../shared/utils/decimal';
import { ED1, buildEditions, buildFoods, buildTaxonomy } from './seed-catalog';
import { FoodView, calcDish, calcIngredient, computeBmi, dayTotals, fromCustom, fromSmae, slotTotals } from '../nutrition/engine';
import { sumNutrientsToTargets } from './seed-helpers';

export const DB_SCHEMA = 4;
const NUTRI = 'Lic. Valeria Montoya';
const ago = (days: number, hour = 9): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
};

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Platillos ----------
interface DishSeed {
  id: string;
  name: string;
  category: string;
  tags: string[];
  description: string;
  servings: string;
  prep: number;
  ingredients: [food: string, qty: string, unit: string][];
  steps: string[];
  recs: string;
  mode?: 'structured' | 'free';
  free?: string;
}

const DISHES: DishSeed[] = [
  { id: 'd-avena', name: 'Avena con fresa y almendras', category: 'Desayuno', tags: ['avena', 'almendras', 'fibra'], description: 'Avena cocida en leche descremada con fresas frescas y almendras troceadas.', servings: '1', prep: 10,
    ingredients: [['AVEN', '40', 'g'], ['LDES', '1', 'taza'], ['FRES', '1', 'taza'], ['ALME', '10', 'g']],
    steps: ['Calienta la leche a fuego medio.', 'Agrega la avena y cocina 5 minutos moviendo.', 'Sirve con fresas picadas y almendras.'], recs: 'Puedes usar canela en lugar de endulzante.' },
  { id: 'd-huevo-mex', name: 'Huevo a la mexicana con tortillas', category: 'Desayuno', tags: ['huevo', 'tradicional'], description: 'Huevo revuelto con jitomate y cebolla, acompañado de tortillas de maíz.', servings: '1', prep: 15,
    ingredients: [['HUEV', '2', 'pieza'], ['JITO', '1', 'pieza'], ['CEBO', '30', 'g'], ['TORT', '2', 'pieza'], ['ACEI', '1', 'cdita']],
    steps: ['Pica jitomate y cebolla.', 'Sofríe con el aceite 3 minutos.', 'Agrega los huevos y revuelve hasta cuajar.', 'Sirve con las tortillas calientes.'], recs: 'Evita agregar sal en exceso.' },
  { id: 'd-tostada', name: 'Tostada de aguacate con huevo', category: 'Desayuno', tags: ['huevo', 'aguacate', 'trigo'], description: 'Pan integral tostado con aguacate machacado y huevo cocido.', servings: '1', prep: 10,
    ingredients: [['PANI', '2', 'rebanada'], ['AGUA', '1', 'rebanada'], ['HUEV', '1', 'pieza'], ['JITO', '60', 'g']],
    steps: ['Tuesta el pan.', 'Machaca el aguacate con unas gotas de limón.', 'Unta, añade el huevo cocido en rebanadas y el jitomate.'], recs: 'Contiene gluten.' },
  { id: 'd-yogurt', name: 'Yogurt con manzana, avena y miel', category: 'Colación', tags: ['yogurt', 'miel', 'lácteo'], description: 'Yogurt natural con manzana picada, avena y un toque de miel.', servings: '1', prep: 5,
    ingredients: [['YOGU', '1', 'taza'], ['MANZ', '1', 'pieza'], ['AVEN', '2', 'cda'], ['MIEL', '1', 'cdita']],
    steps: ['Pica la manzana.', 'Mezcla con el yogurt y la avena.', 'Termina con la miel.'], recs: 'Para controlar azúcares, omite la miel.' },
  { id: 'd-fruta', name: 'Fruta picada de temporada', category: 'Colación', tags: ['fruta', 'ligero'], description: 'Papaya y sandía con limón.', servings: '1', prep: 5,
    ingredients: [['PAPA', '1', 'taza'], ['SAND', '1', 'taza']],
    steps: ['Pica la fruta.', 'Sirve fría con jugo de limón.'], recs: 'Mejor si la fruta está madura y se consume al momento.' },
  { id: 'd-pollo-bowl', name: 'Bowl de pollo con arroz y verduras', category: 'Comida', tags: ['pollo', 'arroz', 'verduras'], description: 'Pechuga a la plancha sobre arroz con brócoli y zanahoria.', servings: '1', prep: 30,
    ingredients: [['POLL', '120', 'g'], ['ARRO', '1', 'taza'], ['BROC', '1', 'taza'], ['ZANA', '1', 'pieza'], ['ACEI', '1', 'cdita']],
    steps: ['Cocina el arroz.', 'Sazona y asa la pechuga.', 'Cuece al vapor las verduras.', 'Arma el bowl.'], recs: 'Sazona con hierbas y limón; evita sal añadida.' },
  { id: 'd-atun-garb', name: 'Ensalada de atún con garbanzos', category: 'Comida', tags: ['atún', 'pescado', 'garbanzo'], description: 'Atún en agua con garbanzos, pepino y jitomate.', servings: '1', prep: 15,
    ingredients: [['ATUN', '1', 'lata'], ['GARB', '1', 'taza'], ['PEPI', '1', 'taza'], ['JITO', '1', 'pieza'], ['ACEI', '1', 'cdita']],
    steps: ['Escurre el atún.', 'Mezcla con garbanzos y verduras picadas.', 'Aliña con aceite de oliva y limón.'], recs: 'Contiene pescado.' },
  { id: 'd-pescado', name: 'Pescado a la plancha con calabacitas y camote', category: 'Comida', tags: ['pescado', 'tilapia'], description: 'Filete de tilapia con calabacitas y camote cocido.', servings: '1', prep: 25,
    ingredients: [['TILA', '150', 'g'], ['CALA', '1', 'taza'], ['CAMO', '1', 'pieza'], ['ACEI', '1', 'cdita']],
    steps: ['Cuece el camote.', 'Asa el pescado 4 min por lado.', 'Saltea las calabacitas.'], recs: 'Contiene pescado.' },
  { id: 'd-lentejas', name: 'Sopa de lentejas con tortillas', category: 'Comida', tags: ['lenteja', 'leguminosa'], description: 'Sopa de lentejas con verduras, acompañada de tortillas.', servings: '1', prep: 40,
    ingredients: [['LENT', '1', 'taza'], ['ZANA', '1', 'pieza'], ['JITO', '1', 'pieza'], ['TORT', '2', 'pieza'], ['AGUA', '1', 'rebanada']],
    steps: ['Cuece las lentejas con zanahoria.', 'Licúa el jitomate y agrégalo.', 'Sirve con aguacate.'], recs: 'Remoja las lentejas para reducir el tiempo.' },
  { id: 'd-pasta', name: 'Pasta con pollo y jitomate', category: 'Comida', tags: ['pasta', 'pollo', 'trigo'], description: 'Pasta con salsa de jitomate y pollo desmenuzado.', servings: '1', prep: 25,
    ingredients: [['PAST', '1', 'taza'], ['POLL', '90', 'g'], ['JITO', '2', 'pieza'], ['ESPI', '1', 'taza'], ['ACEI', '1', 'cdita']],
    steps: ['Cuece la pasta.', 'Prepara la salsa de jitomate.', 'Integra pollo y espinaca.'], recs: 'Contiene gluten.' },
  { id: 'd-salmon', name: 'Salmón al horno con papa y espinacas', category: 'Cena', tags: ['salmón', 'pescado', 'omega-3'], description: 'Salmón horneado con papa cocida y espinacas salteadas.', servings: '1', prep: 30,
    ingredients: [['SALM', '120', 'g'], ['PAPC', '1', 'pieza'], ['ESPI', '2', 'taza'], ['ACEI', '1', 'cdita']],
    steps: ['Hornea el salmón 15 min a 190 °C.', 'Cuece la papa.', 'Saltea las espinacas.'], recs: 'Contiene pescado.' },
  { id: 'd-frijoles', name: 'Frijoles con nopales y tortilla', category: 'Cena', tags: ['frijol', 'nopal', 'tradicional'], description: 'Frijoles de la olla con nopales asados y tortillas.', servings: '1', prep: 20,
    ingredients: [['FRIJ', '1', 'taza'], ['NOPA', '1', 'taza'], ['TORT', '2', 'pieza'], ['CEBO', '30', 'g']],
    steps: ['Calienta los frijoles.', 'Asa los nopales.', 'Sirve con cebolla picada.'], recs: 'Cena rica en fibra.' },
  { id: 'd-nopales', name: 'Nopales con queso panela', category: 'Cena', tags: ['nopal', 'panela', 'lácteo'], description: 'Nopales asados con queso panela y tortilla.', servings: '1', prep: 15,
    ingredients: [['NOPA', '2', 'taza'], ['PANE', '2', 'rebanada'], ['TORT', '1', 'pieza'], ['JITO', '1', 'pieza']],
    steps: ['Asa nopales y panela.', 'Sirve con jitomate picado.'], recs: 'El queso panela puede contener sal elevada.' },
  { id: 'd-ensalada', name: 'Ensalada fresca con aceite de oliva', category: 'Guarnición', tags: ['ensalada', 'verduras'], description: 'Lechuga, pepino y jitomate aliñados con limón y aceite de oliva.', servings: '1', prep: 8,
    ingredients: [['LECH', '2', 'taza'], ['PEPI', '1', 'taza'], ['JITO', '1', 'pieza'], ['ACEI', '1', 'cdita']],
    steps: ['Lava y corta las verduras.', 'Aliña al servir.'], recs: 'Ideal como acompañamiento de comida o cena.' },
  { id: 'd-pollo-libre', name: 'Pollo con verduras al ajillo', category: 'Comida', tags: ['pollo', 'ajo'], description: 'Receta en texto libre: pollo guisado con verduras de temporada.', servings: '1', prep: 30,
    mode: 'free',
    free: 'Sofríe ajo en una cucharadita de aceite, agrega la pechuga en cubos y deja dorar. Suma calabacitas y zanahoria en rodajas, tapa y cocina a fuego bajo 15 minutos. Ajusta con pimienta y hierbas.',
    ingredients: [['POLL', '120', 'g'], ['CALA', '1', 'taza'], ['ZANA', '1', 'pieza'], ['ACEI', '1', 'cdita']],
    steps: [], recs: 'Receta en texto libre; los cálculos usan los ingredientes capturados.' },
];

export const CUSTOM_FOODS: CustomFood[] = [
  {
    id: 'cf-barra', name: 'Barra de proteína (marca ejemplo)', brand: 'Marca Ejemplo', description: 'Barra de 45 g con sabor chocolate.',
    portions: [{ id: 'cfp-1', name: 'Barra', quantity: '1', unit: 'pieza', gramsEquivalent: '45', isReference: true }],
    profile: { basisQuantity: '100', basisUnit: 'g', energy: '380', protein: '33', carbs: '35', lipids: '12', fiber: '8' },
    sourceType: 'label', sourceReference: 'Etiqueta nutrimental 2026', createdBy: NUTRI, status: 'active', tags: ['snack', 'proteína'], createdAt: ago(60),
  },
  {
    id: 'cf-tortilla-nopal', name: 'Tortilla de nopal (artesanal)', description: 'Tortilla con 30 % de nopal deshidratado.',
    portions: [{ id: 'cfp-2', name: 'Pieza', quantity: '1', unit: 'pieza', gramsEquivalent: '28', isReference: true }],
    profile: { basisQuantity: '100', basisUnit: 'g', energy: '195', protein: '5.5', carbs: '38', lipids: '2.5', fiber: '9' },
    sourceType: 'manufacturer', sourceReference: 'Ficha técnica del fabricante', createdBy: NUTRI, validatedBy: NUTRI, validatedAt: ago(30), status: 'active', tags: ['cereal', 'maíz', 'nopal'],
    equivalence: { subgroupCode: 'CER-SG', referenceGrams: '35', equivalentValue: '1', assignedBy: NUTRI, assignedAt: ago(30), criterion: 'Equivalente a tortilla de maíz según aporte de carbohidratos y energía.' },
    createdAt: ago(45),
  },
];

function buildDishes(foods: FoodView[], editionId: Id): Dish[] {
  const byCode = new Map(foods.filter((f) => f.code).map((f) => [f.code as string, f]));
  return DISHES.map((s) => {
    const ingredients: Ingredient[] = s.ingredients.map(([code, qty, unit], i) => {
      const food = byCode.get(code);
      if (!food) throw new Error(`Alimento semilla desconocido: ${code}`);
      return { id: `${s.id}-i${i}`, ...calcIngredient(food, qty, unit) };
    });
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      tags: s.tags,
      status: 'active',
      currentVersion: 1,
      createdAt: ago(120),
      versions: [
        {
          id: `${s.id}-v1`,
          versionNumber: 1,
          description: s.description,
          recipeMode: s.mode ?? 'structured',
          instructionsText: s.free ?? '',
          steps: s.steps,
          servings: s.servings,
          prepTimeMinutes: s.prep,
          ingredients,
          recommendations: s.recs,
          nutrition: calcDish(ingredients, s.servings, editionId),
          substitutions: [],
          changeReason: 'Versión inicial',
          createdBy: NUTRI,
          createdAt: ago(120),
        },
      ],
    };
  });
}

// ---------- Pacientes ----------
let mid = 0;
function measurements(startWeight: number, height: number, weeks: number, delta: number, waist: number, hip: number, fat: number): Measurement[] {
  const out: Measurement[] = [];
  for (let i = 0; i < weeks; i++) {
    const w = (startWeight + delta * i).toFixed(1);
    out.push({
      id: `m${++mid}`,
      measuredAt: addDays(todayIso(), -(weeks - 1 - i) * 21),
      weightKg: w,
      heightCm: String(height),
      bmi: computeBmi(w, String(height)),
      waistCm: (waist + delta * i * 1.1).toFixed(1),
      hipCm: (hip + delta * i * 0.6).toFixed(1),
      bodyFatPct: (fat + delta * i * 0.9).toFixed(1),
      notes: i === 0 ? 'Medición inicial' : undefined,
      createdBy: NUTRI,
    });
  }
  return out;
}

function blankPatient(id: string, userId: string | undefined, first: string, last: string, birth: string, sex: 'F' | 'M' | 'O', email: string, phone: string): Patient {
  return {
    id, userId, status: userId ? 'active' : 'invited',
    profile: { firstName: first, lastName: last, birthDate: birth, sex, email, phone },
    goal: 'maintenance', goalNotes: '', clinicalIndications: '', measurementsVisibleToPatient: true,
    usedBytes: 0, conditions: [], allergies: [], medications: [], preferences: [], notes: [], documents: [], measurements: [],
    createdAt: ago(150), createdBy: NUTRI,
  };
}

function buildPatients(): Patient[] {
  const ana = blankPatient('p-ana', 'u-ana', 'Ana Lucía', 'Ramírez Soto', '1991-04-12', 'F', 'ana@demo.mx', '55 1234 5678');
  Object.assign(ana, {
    goal: 'weight_loss', goalNotes: 'Reducir 6 kg en 4 meses con apoyo de actividad física moderada.',
    clinicalIndications: 'Hipertensión leve controlada. Limitar sodio y embutidos.',
    usedBytes: 4_200_000,
    conditions: [{ id: 'c1', name: 'Hipertensión arterial', details: 'Controlada con medicamento desde 2023.', status: 'active' }],
    allergies: [{ id: 'a1', allergen: 'Mariscos', aliases: ['camarón', 'langosta', 'cangrejo'], reaction: 'Urticaria', severity: 'severe', status: 'active' }],
    medications: [{ id: 'md1', name: 'Losartán', dose: '50 mg', frequency: 'Cada 24 h', startDate: '2023-03-01', status: 'active' }],
    preferences: [
      { id: 'pf1', foodName: 'Aguacate', type: 'favorite', notes: '' },
      { id: 'pf2', foodName: 'Hígado', type: 'avoid', notes: 'No le gusta la textura.' },
    ],
    notes: [
      { id: 'n1', body: 'Muy constante con el registro. Revisar sodio en comidas fuera de casa.', createdAt: ago(9), authorName: NUTRI },
      { id: 'n2', body: 'Prefiere desayunos rápidos entre semana. Ofrecer más opciones portátiles.', createdAt: ago(40), authorName: NUTRI },
    ],
    documents: [
      { id: 'doc1', name: 'Química sanguínea — octubre 2026', category: 'laboratorio', documentDate: addDays(todayIso(), -25), description: 'Glucosa, colesterol y triglicéridos.', sizeBytes: 842_000, visibleToPatient: true, uploadedBy: NUTRI, uploadedAt: ago(24), scanStatus: 'clean' },
      { id: 'doc2', name: 'Receta médica — cardiología', category: 'receta', documentDate: addDays(todayIso(), -90), description: 'Ajuste de losartán.', sizeBytes: 310_000, visibleToPatient: false, uploadedBy: NUTRI, uploadedAt: ago(88), scanStatus: 'clean' },
    ],
    measurements: measurements(78.4, 164, 6, -1.1, 92, 108, 36),
  });

  const carlos = blankPatient('p-carlos', 'u-carlos', 'Carlos', 'Mendoza Ibarra', '1985-09-03', 'M', 'carlos@demo.mx', '55 8765 4321');
  Object.assign(carlos, {
    goal: 'muscle_gain', goalNotes: 'Ganar masa magra, entrena 4 veces por semana.',
    clinicalIndications: 'Diabetes tipo 2 en control. Evitar azúcares simples y bebidas azucaradas.',
    usedBytes: 2_100_000,
    conditions: [{ id: 'c2', name: 'Diabetes mellitus tipo 2', details: 'HbA1c 6.4 % en el último control.', status: 'active' }],
    medications: [{ id: 'md2', name: 'Metformina', dose: '850 mg', frequency: 'Cada 12 h', startDate: '2022-06-01', status: 'active' }],
    preferences: [{ id: 'pf3', foodName: 'Pollo', type: 'favorite', notes: '' }],
    notes: [{ id: 'n3', body: 'Coordinar con su entrenador el aporte de proteína post entrenamiento.', createdAt: ago(5), authorName: NUTRI }],
    measurements: measurements(72.5, 178, 5, 0.8, 80, 95, 17),
  });

  const mariana = blankPatient('p-mariana', 'u-mariana', 'Mariana', 'Torres Vega', '1998-01-22', 'F', 'mariana@demo.mx', '55 2468 1357');
  Object.assign(mariana, {
    goal: 'maintenance', goalNotes: 'Mantener peso y mejorar energía durante el día.',
    clinicalIndications: 'Sin indicaciones clínicas relevantes.',
    usedBytes: 900_000,
    allergies: [{ id: 'a2', allergen: 'Frutos secos', aliases: ['almendra', 'nuez', 'cacahuate', 'pistache'], reaction: 'Edema en labios', severity: 'moderate', status: 'active' }],
    preferences: [{ id: 'pf4', foodName: 'Atún', type: 'avoid', notes: 'No lo consume.' }],
    measurements: measurements(58.2, 165, 3, 0.1, 71, 94, 24),
  });

  const roberto = blankPatient('p-roberto', 'u-roberto', 'Roberto', 'Cruz Aguilar', '1973-11-30', 'M', 'roberto@demo.mx', '55 1357 2468');
  Object.assign(roberto, {
    goal: 'health', goalNotes: 'Reducir colesterol y mejorar hábitos.', clinicalIndications: 'Dislipidemia mixta.',
    usedBytes: 1_300_000,
    conditions: [{ id: 'c3', name: 'Dislipidemia', details: 'Colesterol LDL 148 mg/dL.', status: 'active' }],
    measurements: measurements(91.6, 175, 4, -0.9, 101, 106, 28),
  });

  const sofia = blankPatient('p-sofia', undefined, 'Sofía', 'Herrera Luna', '2000-06-18', 'F', 'sofia@demo.mx', '55 9753 1864');
  sofia.goal = 'weight_loss';
  sofia.goalNotes = 'Capturada en consulta; pendiente de aceptar invitación.';

  const javier = blankPatient('p-javier', 'u-javier', 'Javier', 'Núñez Prado', '1980-02-14', 'M', 'javier@demo.mx', '55 4682 9731');
  Object.assign(javier, { status: 'inactive', goal: 'maintenance', deletedAt: ago(20), measurements: measurements(84, 172, 2, 0.4, 94, 100, 25) });

  const daniela = blankPatient('p-daniela', 'u-daniela', 'Daniela', 'Ortiz Ramos', '1994-08-09', 'F', 'daniela@demo.mx', '55 3141 5926');
  daniela.goal = 'muscle_gain';
  daniela.goalNotes = 'Cuenta creada. Falta aceptar aviso de privacidad y consentimiento.';

  return [ana, carlos, mariana, roberto, sofia, javier, daniela];
}

// ---------- Planes ----------
type Menu = Record<string, string[]>;

const MENU_A: Menu = {
  Desayuno: ['d-huevo-mex', 'd-tostada', 'd-avena', 'd-huevo-mex', 'd-tostada', 'd-avena', 'd-huevo-mex'],
  'Colación matutina': ['d-fruta', 'd-yogurt', 'd-fruta', 'd-yogurt', 'd-fruta', 'd-yogurt', 'd-fruta'],
  Comida: ['d-pollo-bowl', 'd-atun-garb', 'd-pescado', 'd-lentejas', 'd-pasta', 'd-pollo-bowl', 'd-pollo-libre'],
  'Colación vespertina': ['d-fruta', '', 'd-fruta', '', 'd-fruta', '', ''],
  Cena: ['d-nopales', 'd-frijoles', 'd-salmon', 'd-nopales', 'd-frijoles', 'd-salmon', 'd-ensalada'],
};

function buildDays(start: string, count: number, menu: Menu, servingsFor?: (slot: string) => string): PlanDay[] {
  return Array.from({ length: count }, (_, i) => ({
    date: addDays(start, i),
    notes: i === 0 ? 'Toma al menos 2 litros de agua simple durante el día.' : '',
    slots: DEFAULT_SLOTS.map((name) => {
      const dishId = menu[name]?.[i % 7];
      return {
        id: uid('s'),
        name,
        items: dishId ? [{ id: uid('it'), dishId, dishVersion: 1, servings: servingsFor?.(name) ?? '1' }] : [],
      };
    }),
  }));
}

function makeTargets(days: PlanDay[], dishes: Dish[], eqCodes: string[]): PlanTargets {
  const lookup = (id: string, v: number) => dishes.find((d) => d.id === id)?.versions.find((x) => x.versionNumber === v);
  return sumNutrientsToTargets(days.map((d) => dayTotals(d, lookup)), eqCodes);
}

/**
 * Calibra las porciones de cada día para que cuadren con los objetivos del plan
 * (derivados del promedio). Así los datos de ejemplo no generan alertas falsas;
 * las desviaciones demostrativas se inyectan después de forma deliberada.
 */
function calibrate(days: PlanDay[], targets: PlanTargets, dishes: Dish[]): void {
  const lookup = (id: string, v: number) => dishes.find((d) => d.id === id)?.versions.find((x) => x.versionNumber === v);
  const target = Number(targets.energy);
  for (const day of days) {
    const kcal = Number(dayTotals(day, lookup).nutrients.energy);
    if (!kcal) continue;
    const factor = target / kcal;
    for (const slot of day.slots) {
      for (const it of slot.items) it.servings = String(Math.max(0.5, Math.min(2, Math.round(Number(it.servings) * factor * 4) / 4)));
    }
  }
}

/** Escala todas las porciones de un día (para crear una desviación demostrativa). */
function skew(day: PlanDay, factor: number): void {
  for (const slot of day.slots) for (const it of slot.items) it.servings = String(Math.round(Number(it.servings) * factor * 4) / 4);
}

function plan(opts: {
  id: string; patientId: string; name: string; status: MealPlan['status']; start: string; days: number; menu: Menu;
  dishes: Dish[]; eqCodes: string[]; scale?: (slot: string) => string;
}): MealPlan {
  const days = buildDays(opts.start, opts.days, opts.menu, opts.scale);
  const targets = makeTargets(days, opts.dishes, opts.eqCodes);
  calibrate(days, targets, opts.dishes);
  const published = opts.status === 'published' || opts.status === 'finished' || opts.status === 'archived';
  return {
    id: opts.id, patientId: opts.patientId, name: opts.name, status: opts.status,
    startDate: opts.start, endDate: addDays(opts.start, opts.days - 1), revision: published ? 4 : 2,
    updatedAt: ago(1), updatedBy: NUTRI, createdAt: ago(30), createdBy: NUTRI, targets, days,
    publications: published
      ? [{ versionNumber: 1, publishedAt: ago(14), by: NUTRI, summary: 'Publicación inicial', days: structuredClone(days), targets }]
      : [],
    history: [
      { id: uid('e'), at: ago(30), by: NUTRI, type: 'created', summary: 'Plan creado desde plantilla "Semana base"' },
      ...(published ? [{ id: uid('e'), at: ago(14), by: NUTRI, type: 'published' as const, summary: 'Publicado como versión 1' }] : []),
    ],
  };
}

function buildTracking(plans: MealPlan[], dishes: Dish[]): TrackingEntry[] {
  const out: TrackingEntry[] = [];
  const today = todayIso();
  const rnd = mulberry32(42);
  const comments = [
    'Me quedé con hambre en la tarde.',
    'Cambié la fruta por una manzana porque no tenía papaya.',
    'Muy rico, repetiré esta receta.',
    'Comí fuera de casa, pedí algo parecido.',
  ];
  for (const p of plans.filter((x) => x.status === 'published' || x.status === 'finished')) {
    for (const day of p.days) {
      if (day.date > today) continue;
      for (const slot of day.slots) {
        for (const item of slot.items) {
          const r = rnd();
          if (r > 0.93 && day.date === today) continue;
          const status = r < 0.82 ? 'done' : r < 0.93 ? 'skipped' : null;
          if (!status) continue;
          const dish = dishes.find((d) => d.id === item.dishId)!;
          const hasComment = rnd() < 0.18;
          const recent = (new Date(today).getTime() - new Date(day.date).getTime()) / 86_400_000 < 2;
          out.push({
            id: uid('t'), patientId: p.patientId, planId: p.id, date: day.date, slotId: slot.id, slotName: slot.name,
            itemId: item.id, dishId: item.dishId, dishVersion: item.dishVersion, dishName: dish.name, status,
            recordedAt: new Date(`${day.date}T${{ Desayuno: '08:10', 'Colación matutina': '11:00', Comida: '14:20', 'Colación vespertina': '17:30', Cena: '20:15' }[slot.name] ?? '12:00'}:00`).toISOString(),
            patientComment: hasComment ? comments[Math.floor(rnd() * comments.length)] : '',
            photos: [], thread: [], needsReview: recent && (hasComment || status === 'skipped'),
          });
        }
      }
    }
  }
  const withComment = out.find((e) => e.patientComment && e.needsReview);
  if (withComment) {
    withComment.thread.push({ id: uid('c'), authorRole: 'patient', authorName: 'Paciente', body: withComment.patientComment, at: withComment.recordedAt });
  }
  return out;
}

function buildTemplates(dishes: Dish[]): PlanTemplate[] {
  const week = buildDays('2000-01-03', 7, MENU_A);
  void dishes;
  const toStruct = (days: PlanDay[]) =>
    days.map((d, i) => ({
      offset: i,
      slots: d.slots.map((s) => ({ name: s.name, items: s.items.map(({ dishId, dishVersion, servings }) => ({ dishId, dishVersion, servings })) })),
    }));
  return [
    { id: 'tpl-base', name: 'Semana base de equilibrio', description: 'Siete días con 5 tiempos de comida, para pérdida de peso moderada.', scope: 'global', days: toStruct(week), createdAt: ago(100), createdBy: NUTRI },
    { id: 'tpl-ligera', name: 'Día ligero de recuperación', description: 'Un solo día para repetir después de comidas copiosas.', scope: 'global', days: toStruct(week.slice(0, 1)), createdAt: ago(80), createdBy: NUTRI },
    { id: 'tpl-carlos', name: 'Semana alta en proteína (Carlos)', description: 'Plantilla específica para Carlos Mendoza.', scope: 'patient', patientId: 'p-carlos', days: toStruct(week.slice(0, 4)), createdAt: ago(20), createdBy: NUTRI },
  ];
}

// ---------- Consentimientos ----------
const PRIVACY_TEXT = `Aviso de privacidad (texto de ejemplo).\n\nResponsable: la nutrióloga titular de esta plataforma. Finalidades: gestionar tu expediente, elaborar planes alimentarios y dar seguimiento a tu evolución. Tratamos datos personales y datos sensibles de salud. Puedes ejercer tus derechos de acceso, rectificación, cancelación y oposición (ARCO) escribiendo a la dirección indicada en la configuración.\n\nEste texto es un marcador y debe ser sustituido por la versión validada por asesoría jurídica antes de producción.`;
const INFORMED_TEXT = `Consentimiento informado para la atención nutricional (texto de ejemplo).\n\nEntiendo que la atención nutricional es un apoyo profesional que no sustituye la atención médica, que debo informar alergias, enfermedades y medicamentos, y que puedo revocar este consentimiento en cualquier momento.\n\nEste texto es un marcador y debe ser sustituido por la versión validada por asesoría jurídica antes de producción.`;

function buildConsents(): { docs: ConsentDocument[]; acceptances: ConsentAcceptance[] } {
  const docs: ConsentDocument[] = [
    { id: 'cd-priv-1', type: 'privacy', version: 1, title: 'Aviso de privacidad', content: PRIVACY_TEXT.replace('(texto de ejemplo)', '(v1)'), publishedAt: ago(300), isActive: false },
    { id: 'cd-priv-2', type: 'privacy', version: 2, title: 'Aviso de privacidad', content: PRIVACY_TEXT, publishedAt: ago(100), isActive: true },
    { id: 'cd-inf-1', type: 'informed', version: 1, title: 'Consentimiento informado', content: INFORMED_TEXT, publishedAt: ago(300), isActive: true },
  ];
  const acceptances: ConsentAcceptance[] = [];
  for (const pid of ['p-ana', 'p-carlos', 'p-mariana', 'p-roberto', 'p-javier']) {
    for (const doc of ['cd-priv-2', 'cd-inf-1']) {
      acceptances.push({ id: uid('ac'), patientId: pid, consentDocumentId: doc, acceptedAt: ago(90), method: 'web_checkbox', evidence: { userAgent: 'Mozilla/5.0 (demo)', recordedBy: 'paciente' } });
    }
  }
  return { docs, acceptances };
}

function buildSettings(): Settings {
  return {
    brand: {
      businessName: 'Nutrición Integral', tagline: 'Alimentación consciente, resultados sostenibles',
      primary: '#514653', secondary: '#DDD6F2', phone: '55 5555 0100', email: 'contacto@nutricion-integral.example',
      address: 'Av. Ejemplo 123, Col. Centro, CDMX', credentials: 'Licenciada en Nutrición · Esp. en Nutrición Clínica', licenseNumber: 'Cédula 1234567 (ejemplo)',
    },
    region: { timezone: 'America/Mexico_City', weekStart: 'mon' },
    storage: { defaultQuotaBytes: 50 * 1024 * 1024, maxImageBytes: 10 * 1024 * 1024, maxPdfBytes: 15 * 1024 * 1024, warnThresholdPct: 80 },
    alerts: {
      energyTolerancePct: 10, macroTolerancePct: 15, equivalentTolerance: 1,
      clinicalRules: [
        { id: 'r1', keyword: 'hipertensión', triggers: ['embutido', 'jamón', 'sal añadida', 'queso panela'], level: 'warning', message: 'Alimento alto en sodio con hipertensión', enabled: true },
        { id: 'r2', keyword: 'diabetes', triggers: ['miel', 'azúcar', 'jugo'], level: 'warning', message: 'Azúcar simple con diabetes', enabled: true },
        { id: 'r3', keyword: 'dislipidemia', triggers: ['frito', 'chicharrón', 'manteca'], level: 'warning', message: 'Grasa saturada con dislipidemia', enabled: true },
      ],
    },
  };
}

const USERS: User[] = [
  { id: 'u-nutri', email: 'nutri@demo.mx', password: 'demo1234', role: 'nutritionist', name: NUTRI, status: 'active' },
  { id: 'u-ana', email: 'ana@demo.mx', password: 'demo1234', role: 'patient', name: 'Ana Lucía Ramírez', status: 'active', patientId: 'p-ana' },
  { id: 'u-carlos', email: 'carlos@demo.mx', password: 'demo1234', role: 'patient', name: 'Carlos Mendoza', status: 'active', patientId: 'p-carlos' },
  { id: 'u-mariana', email: 'mariana@demo.mx', password: 'demo1234', role: 'patient', name: 'Mariana Torres', status: 'active', patientId: 'p-mariana' },
  { id: 'u-roberto', email: 'roberto@demo.mx', password: 'demo1234', role: 'patient', name: 'Roberto Cruz', status: 'active', patientId: 'p-roberto' },
  { id: 'u-javier', email: 'javier@demo.mx', password: 'demo1234', role: 'patient', name: 'Javier Núñez', status: 'disabled', patientId: 'p-javier' },
  { id: 'u-daniela', email: 'daniela@demo.mx', password: 'demo1234', role: 'patient', name: 'Daniela Ortiz', status: 'active', patientId: 'p-daniela' },
];

export function buildSeed(): Db {
  const editions = buildEditions();
  const t1 = buildTaxonomy(ED1);
  const t2 = buildTaxonomy('ed-4b');
  const foods = [...buildFoods(ED1), ...buildFoods('ed-4b')];
  const catalogViews = foods.filter((f) => f.editionId === ED1).map(fromSmae);
  const dishes = buildDishes([...catalogViews, ...CUSTOM_FOODS.map(fromCustom)], ED1);
  const eqCodes = t1.subgroups.map((s) => s.code);
  const week = startOfWeek(todayIso());
  const plans = [
    plan({ id: 'pl-ana', patientId: 'p-ana', name: 'Plan quincenal — Pérdida de peso', status: 'published', start: addDays(week, -7), days: 14, menu: MENU_A, dishes, eqCodes }),
    plan({ id: 'pl-carlos', patientId: 'p-carlos', name: 'Plan semanal — Ganancia muscular', status: 'published', start: week, days: 7, menu: { ...MENU_A, 'Colación matutina': ['d-yogurt', 'd-yogurt', 'd-yogurt', 'd-yogurt', 'd-yogurt', 'd-yogurt', 'd-yogurt'] }, dishes, eqCodes, scale: (s) => (s === 'Comida' ? '1.5' : '1') }),
    plan({ id: 'pl-mariana', patientId: 'p-mariana', name: 'Plan semanal — Mantenimiento (borrador)', status: 'draft', start: addDays(week, 7), days: 7, menu: { ...MENU_A, 'Comida': ['d-pollo-bowl', 'd-atun-garb', 'd-lentejas', 'd-pescado', 'd-pasta', 'd-pollo-bowl', 'd-lentejas'] }, dishes, eqCodes }),
    plan({ id: 'pl-roberto', patientId: 'p-roberto', name: 'Plan semanal — Control de lípidos', status: 'finished', start: addDays(week, -14), days: 7, menu: { ...MENU_A, Cena: ['d-ensalada', 'd-frijoles', 'd-salmon', 'd-frijoles', 'd-ensalada', 'd-salmon', 'd-frijoles'] }, dishes, eqCodes }),
  ];
  // Desviaciones demostrativas respecto de los objetivos (una por plan vigente).
  skew(plans[0].days[11], 0.6);
  skew(plans[1].days[3], 1.5);
  plans[0].publications[0].days = structuredClone(plans[0].days);
  plans[1].publications[0].days = structuredClone(plans[1].days);
  // Alimentos de ejemplo para demostrar alertas: Mariana (alergia a frutos secos) tiene d-avena en el martes del borrador.
  const mar = plans[2].days[1].slots[0];
  mar.items = [{ id: uid('it'), dishId: 'd-avena', dishVersion: 1, servings: '1' }];
  const { docs, acceptances } = buildConsents();
  const tracking = buildTracking(plans, dishes);
  void slotTotals;
  void div;
  return {
    schema: DB_SCHEMA,
    users: USERS,
    sessions: [
      { id: 's1', userId: 'u-nutri', device: 'Windows', browser: 'Chrome 130', createdAt: ago(0, 8), lastSeenAt: new Date().toISOString() },
      { id: 's2', userId: 'u-nutri', device: 'iPhone', browser: 'Safari 18', createdAt: ago(3, 19), lastSeenAt: ago(1, 22) },
      { id: 's3', userId: 'u-nutri', device: 'MacBook', browser: 'Firefox 132', createdAt: ago(12, 10), lastSeenAt: ago(8, 12) },
    ],
    patients: buildPatients(),
    consentDocuments: docs,
    consentAcceptances: acceptances,
    editions,
    groups: [...t1.groups, ...t2.groups],
    subgroups: [...t1.subgroups, ...t2.subgroups],
    foods,
    customFoods: CUSTOM_FOODS,
    dishes,
    plans,
    templates: buildTemplates(dishes),
    tracking,
    recalcBatches: [],
    settings: buildSettings(),
    audit: [
      { id: 'au1', at: ago(0, 8), actor: NUTRI, action: 'auth.login', resourceType: 'session', resourceId: 's1', summary: 'Inicio de sesión', requestId: 'req-8d21' },
      { id: 'au2', at: ago(1, 18), actor: NUTRI, action: 'plan.publish', resourceType: 'meal_plan', resourceId: 'pl-carlos', summary: 'Publicó "Plan semanal — Ganancia muscular"', requestId: 'req-77ab' },
      { id: 'au3', at: ago(5, 11), actor: NUTRI, action: 'patient.update', resourceType: 'patient', resourceId: 'p-carlos', summary: 'Actualizó indicaciones clínicas', requestId: 'req-31cc' },
      { id: 'au4', at: ago(9, 10), actor: NUTRI, action: 'export.csv', resourceType: 'patient', resourceId: 'p-ana', summary: 'Exportó mediciones de Ana Lucía a CSV', requestId: 'req-90de' },
    ],
  };
}
