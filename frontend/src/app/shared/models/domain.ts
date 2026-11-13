// Modelo de dominio del cliente (alineado con el ERD de §29 y §30).
// Todas las cantidades nutricionales son strings decimales (§7.3): nunca `number`.

export type Id = string;
export type DecimalStr = string;
/** Fecha calendario `YYYY-MM-DD`. */
export type IsoDate = string;
/** Instante UTC ISO 8601. */
export type IsoDateTime = string;

export type Role = 'nutritionist' | 'patient';

// ---------- Identidad ----------
export interface User {
  id: Id;
  email: string;
  /** Solo para la simulación local; el backend real guarda Argon2id (§5.1). */
  password: string;
  role: Role;
  name: string;
  status: 'active' | 'disabled';
  patientId?: Id;
}

export interface SessionRecord {
  id: Id;
  userId: Id;
  device: string;
  browser: string;
  createdAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  revokedAt?: IsoDateTime;
}

// ---------- Pacientes ----------
export type Sex = 'F' | 'M' | 'O';
export type PatientStatus = 'active' | 'invited' | 'inactive';
export type Goal = 'weight_loss' | 'muscle_gain' | 'maintenance' | 'health' | 'other';

export interface Measurement {
  id: Id;
  measuredAt: IsoDate;
  weightKg: DecimalStr;
  heightCm: DecimalStr;
  bmi: DecimalStr;
  waistCm?: DecimalStr;
  hipCm?: DecimalStr;
  bodyFatPct?: DecimalStr;
  /** Composición corporal (báscula de bioimpedancia). */
  fatMassKg?: DecimalStr;
  musclePct?: DecimalStr;
  muscleMassKg?: DecimalStr;
  visceralFat?: DecimalStr;
  boneKg?: DecimalStr;
  obesityPct?: DecimalStr;
  /** Perímetros en cm por clave (ver GIRTH_GROUPS). */
  girths?: Record<string, DecimalStr>;
  notes?: string;
  createdBy: string;
}

export type CompositionKey = 'bodyFatPct' | 'fatMassKg' | 'musclePct' | 'muscleMassKg' | 'visceralFat' | 'boneKg' | 'obesityPct';

/** Campos de composición corporal: `api` es el nombre en el servidor; `max` y `min` acotan el valor que se considera razonable. */
export const COMPOSITION_FIELDS: readonly { key: CompositionKey; api: string; label: string; unit: string; min: number; max: number }[] = [
  { key: 'bodyFatPct', api: 'body_fat_pct', label: 'Grasa corporal', unit: '%', min: 2, max: 70 },
  { key: 'fatMassKg', api: 'fat_mass_kg', label: 'Peso de la grasa', unit: 'kg', min: 1, max: 250 },
  { key: 'musclePct', api: 'muscle_pct', label: 'Músculo', unit: '%', min: 10, max: 90 },
  { key: 'muscleMassKg', api: 'muscle_mass_kg', label: 'Peso de la masa muscular', unit: 'kg', min: 10, max: 200 },
  { key: 'visceralFat', api: 'visceral_fat', label: 'Grasa visceral', unit: '', min: 0, max: 60 },
  { key: 'boneKg', api: 'bone_kg', label: 'Huesos', unit: 'kg', min: 0.5, max: 10 },
  { key: 'obesityPct', api: 'obesity_pct', label: 'Grado de obesidad', unit: '%', min: 0, max: 300 },
];

export interface GirthField { key: string; label: string }
export interface GirthGroup { title: string; fields: GirthField[] }

const pair = (key: string, label: string): GirthField[] => [
  { key: `${key}_l`, label: `${label} izquierdo` },
  { key: `${key}_r`, label: `${label} derecho` },
];

/** Perímetros o circunferencias (cm). Cintura y cadera viajan aparte (waistCm, hipCm). */
export const GIRTH_GROUPS: readonly GirthGroup[] = [
  { title: 'Tronco', fields: [{ key: 'shoulders', label: 'Hombros' }, { key: 'chest', label: 'Pecho' }, { key: 'abdomen', label: 'Abdomen' }] },
  { title: 'Brazo', fields: [...pair('bicep_relaxed', 'Bíceps relajado'), ...pair('bicep_flexed', 'Bíceps contraído')] },
  { title: 'Antebrazo y muñeca', fields: [...pair('forearm_relaxed', 'Antebrazo relajado'), ...pair('forearm_flexed', 'Antebrazo contraído'), ...pair('wrist', 'Muñeca')] },
  { title: 'Pierna', fields: [...pair('thigh_relaxed', 'Muslo relajado'), ...pair('thigh_flexed', 'Muslo contraído'), ...pair('calf_relaxed', 'Gemelo relajado'), ...pair('calf_flexed', 'Gemelo contraído')] },
];
export const GIRTH_FIELDS: readonly GirthField[] = GIRTH_GROUPS.flatMap((g) => g.fields);

export interface Condition {
  id: Id;
  name: string;
  details: string;
  status: 'active' | 'resolved';
}

export interface Allergy {
  id: Id;
  allergen: string;
  /** Sinónimos o palabras clave que se buscarán en ingredientes. */
  aliases: string[];
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe';
  status: 'active' | 'resolved';
}

export interface Medication {
  id: Id;
  name: string;
  dose: string;
  frequency: string;
  /** Tipo de medicamento (p. ej. antihipertensivo, antidiabético). Texto libre. */
  kind?: string;
  startDate?: IsoDate;
  endDate?: IsoDate;
  status: 'active' | 'ended';
}

export type PreferenceType = 'favorite' | 'avoid' | 'restriction' | 'other';

export interface FoodPreference {
  id: Id;
  foodName: string;
  type: PreferenceType;
  notes: string;
}

export interface PatientNote {
  id: Id;
  body: string;
  createdAt: IsoDateTime;
  authorName: string;
  deletedAt?: IsoDateTime;
}

export type DocumentCategory = 'laboratorio' | 'estudio' | 'receta' | 'consentimiento' | 'otro';

export interface PatientDocument {
  id: Id;
  name: string;
  category: DocumentCategory;
  documentDate: IsoDate;
  description: string;
  sizeBytes: number;
  visibleToPatient: boolean;
  uploadedBy: string;
  uploadedAt: IsoDateTime;
  /** Análisis de seguridad antes de habilitar descarga (§18.4). */
  scanStatus: 'scanning' | 'clean';
  deletedAt?: IsoDateTime;
  /** Modo API: ruta autorizada de descarga (`/api/v1/files/<id>`). */
  url?: string;
}

export interface PatientProfile {
  firstName: string;
  lastName: string;
  birthDate: IsoDate;
  sex: Sex;
  email: string;
  phone: string;
}

export interface Patient {
  id: Id;
  userId?: Id;
  status: PatientStatus;
  profile: PatientProfile;
  goal: Goal;
  goalNotes: string;
  clinicalIndications: string;
  measurementsVisibleToPatient: boolean;
  quotaOverrideBytes?: number;
  usedBytes: number;
  conditions: Condition[];
  allergies: Allergy[];
  medications: Medication[];
  preferences: FoodPreference[];
  notes: PatientNote[];
  documents: PatientDocument[];
  measurements: Measurement[];
  createdAt: IsoDateTime;
  createdBy: string;
  deletedAt?: IsoDateTime;
  /** Modo API: lo calcula el servidor (el cliente no ve todos los documentos). */
  consentComplete?: boolean;
}

// ---------- Consentimientos ----------
export type ConsentType = 'privacy' | 'informed';

export interface ConsentDocument {
  id: Id;
  type: ConsentType;
  version: number;
  title: string;
  content: string;
  publishedAt: IsoDateTime;
  isActive: boolean;
}

export interface ConsentAcceptance {
  id: Id;
  patientId: Id;
  consentDocumentId: Id;
  acceptedAt: IsoDateTime;
  method: 'web_checkbox' | 'in_person';
  evidence: { userAgent: string; recordedBy: string };
  revokedAt?: IsoDateTime;
}

// ---------- Catálogo SMAE ----------
export interface SmaeEdition {
  id: Id;
  name: string;
  editionNumber: number;
  publisher: string;
  sourceReference: string;
  licenseReference: string;
  effectiveDate: IsoDate;
  importedAt: IsoDateTime;
  status: 'active' | 'draft' | 'archived';
  notes: string;
}

export interface SmaeGroup {
  id: Id;
  editionId: Id;
  code: string;
  name: string;
  sortOrder: number;
  tone: 'rosa' | 'salvia' | 'lavanda' | 'mantequilla' | 'cielo';
}

export interface SmaeSubgroup {
  id: Id;
  groupId: Id;
  code: string;
  name: string;
}

export interface SmaePortion {
  id: Id;
  name: string;
  quantity: DecimalStr;
  /** Unidad doméstica (taza, pieza, cda…). */
  unit: string;
  gramsEquivalent: DecimalStr;
  isReference?: boolean;
}

export interface NutrientProfile {
  basisQuantity: DecimalStr;
  basisUnit: 'g' | 'ml';
  energy: DecimalStr;
  protein: DecimalStr;
  carbs: DecimalStr;
  lipids: DecimalStr;
  fiber: DecimalStr;
}

export interface EquivalenceRule {
  /** Código del subgrupo (estable entre ediciones). */
  subgroupCode: string;
  /** Gramos que equivalen a `equivalentValue` equivalentes. */
  referenceGrams: DecimalStr;
  equivalentValue: DecimalStr;
}

export interface SmaeFood {
  id: Id;
  editionId: Id;
  code: string;
  name: string;
  foodState: string;
  ediblePct: DecimalStr;
  portions: SmaePortion[];
  profile: NutrientProfile;
  equivalence: EquivalenceRule;
  densityGPerMl?: DecimalStr;
  tags: string[];
  sourceReference: string;
}

export type CustomFoodSource = 'label' | 'manufacturer' | 'analysis' | 'manual' | 'other';

export interface CustomFood {
  id: Id;
  name: string;
  brand?: string;
  description: string;
  portions: SmaePortion[];
  profile: NutrientProfile;
  sourceType: CustomFoodSource;
  sourceReference: string;
  createdBy: string;
  validatedBy?: string;
  validatedAt?: IsoDateTime;
  status: 'active' | 'inactive';
  tags: string[];
  /** Solo existe si una nutrióloga la asigna de forma expresa (§30.3). */
  equivalence?: EquivalenceRule & { assignedBy: string; assignedAt: IsoDateTime; criterion: string };
  createdAt: IsoDateTime;
}

export interface FoodRef {
  kind: 'smae' | 'custom';
  id: Id;
}

// ---------- Nutrición ----------
export interface Nutrients {
  energy: DecimalStr;
  protein: DecimalStr;
  carbs: DecimalStr;
  lipids: DecimalStr;
  fiber: DecimalStr;
}

/** Equivalentes por código de subgrupo. */
export type EquivalentsMap = Record<string, DecimalStr>;

export interface NutritionSnapshot {
  totals: Nutrients;
  perServing: Nutrients;
  /** Equivalentes por porción, por subgrupo. */
  equivalents: EquivalentsMap;
  /** Gramos de alimentos personalizados sin equivalencia oficial. */
  hasCustomFoods: boolean;
  smaeEditionId: Id;
  engineVersion: string;
  calculatedAt: IsoDateTime;
}

// ---------- Platillos ----------
export type RecipeMode = 'structured' | 'free';

export interface Ingredient {
  id: Id;
  food: FoodRef;
  nameSnapshot: string;
  quantity: DecimalStr;
  unit: string;
  /** Cantidad normalizada usada en el cálculo (§30.4). */
  grams: DecimalStr;
  nutrients: Nutrients;
  equivalent?: { subgroupCode: string; value: DecimalStr };
  official: boolean;
}

export interface Substitution {
  id: Id;
  type: 'dish' | 'food';
  label: string;
  dishId?: Id;
  dishVersion?: number;
  note: string;
  rule: string;
  diff: Nutrients;
  approvedBy: string;
  approvedAt: IsoDateTime;
}

export interface DishVersion {
  id: Id;
  versionNumber: number;
  description: string;
  recipeMode: RecipeMode;
  instructionsText: string;
  steps: string[];
  servings: DecimalStr;
  prepTimeMinutes: number;
  ingredients: Ingredient[];
  recommendations: string;
  image?: { dataUrl?: string; alt: string };
  nutrition: NutritionSnapshot;
  substitutions: Substitution[];
  changeReason: string;
  createdBy: string;
  createdAt: IsoDateTime;
}

export interface Dish {
  id: Id;
  name: string;
  category: string;
  tags: string[];
  status: 'active' | 'inactive';
  currentVersion: number;
  versions: DishVersion[];
  createdAt: IsoDateTime;
  deletedAt?: IsoDateTime;
}

// ---------- Planes ----------
export type PlanStatus = 'draft' | 'published' | 'finished' | 'archived';

export interface PlanItem {
  id: Id;
  dishId: Id;
  dishVersion: number;
  servings: DecimalStr;
  instructions?: string;
}

export interface PlanSlot {
  id: Id;
  name: string;
  items: PlanItem[];
}

export interface PlanDay {
  date: IsoDate;
  notes: string;
  slots: PlanSlot[];
}

export interface PlanTargets {
  energy: DecimalStr;
  protein: DecimalStr;
  carbs: DecimalStr;
  lipids: DecimalStr;
  equivalents: EquivalentsMap;
  version: number;
}

export interface PlanEvent {
  id: Id;
  at: IsoDateTime;
  by: string;
  type: 'created' | 'edited' | 'published' | 'substitution' | 'finished' | 'archived' | 'restored' | 'duplicated';
  summary: string;
}

export interface PlanPublication {
  versionNumber: number;
  publishedAt: IsoDateTime;
  by: string;
  summary: string;
  /** Copia exacta de lo que vio la paciente (§11). */
  days: PlanDay[];
  targets: PlanTargets;
}

export interface MealPlan {
  id: Id;
  patientId: Id;
  name: string;
  status: PlanStatus;
  startDate: IsoDate;
  endDate: IsoDate;
  revision: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
  createdAt: IsoDateTime;
  createdBy: string;
  targets: PlanTargets;
  days: PlanDay[];
  publications: PlanPublication[];
  history: PlanEvent[];
  deletedAt?: IsoDate;
  /** Modo API: número de comidas en listados, donde no se envían los días. */
  itemCount?: number;
}

export interface PlanTemplate {
  id: Id;
  name: string;
  description: string;
  scope: 'global' | 'patient';
  patientId?: Id;
  /** Estructura semanal u horizontal en días relativos (offset desde el inicio). */
  days: { offset: number; slots: { name: string; items: Omit<PlanItem, 'id'>[] }[] }[];
  createdAt: IsoDateTime;
  createdBy: string;
}

// ---------- Seguimiento ----------
export interface MealComment {
  id: Id;
  authorRole: Role;
  authorName: string;
  body: string;
  at: IsoDateTime;
}

export interface TrackingPhoto {
  id: Id;
  dataUrl: string;
  alt: string;
  uploadedAt: IsoDateTime;
}

export interface TrackingEntry {
  id: Id;
  patientId: Id;
  planId: Id;
  date: IsoDate;
  slotId: Id;
  slotName: string;
  itemId: Id;
  dishId: Id;
  dishVersion: number;
  dishName: string;
  status: 'done' | 'skipped';
  recordedAt: IsoDateTime;
  patientComment: string;
  photos: TrackingPhoto[];
  thread: MealComment[];
  /** La nutrióloga todavía no ha revisado este registro. */
  needsReview: boolean;
}

// ---------- Configuración ----------
export interface BrandSettings {
  businessName: string;
  tagline: string;
  primary: string;
  secondary: string;
  logoDataUrl?: string;
  photoDataUrl?: string;
  phone: string;
  email: string;
  address: string;
  credentials: string;
  licenseNumber: string;
}

export interface ClinicalRule {
  id: Id;
  /** Indicación o condición clínica que activa la regla (p. ej. "hipertensión"). */
  keyword: string;
  /** Palabras en platillos/ingredientes que entran en conflicto con la indicación. */
  triggers: string[];
  level: 'info' | 'warning' | 'critical';
  message: string;
  enabled: boolean;
}

export interface Settings {
  brand: BrandSettings;
  region: { timezone: string; weekStart: 'mon' | 'sun' };
  storage: {
    defaultQuotaBytes: number;
    maxImageBytes: number;
    maxPdfBytes: number;
    warnThresholdPct: number;
  };
  alerts: {
    energyTolerancePct: number;
    macroTolerancePct: number;
    equivalentTolerance: number;
    clinicalRules: ClinicalRule[];
  };
}

export interface AuditLog {
  id: Id;
  at: IsoDateTime;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  summary: string;
  requestId: string;
}

// ---------- Recalculo por nueva edición (§7.4, §30.9) ----------
export interface RecalcDecision {
  dishId: Id;
  fromVersion: number;
  toVersion?: number;
  decision: 'authorized' | 'rejected';
}

export interface RecalcBatch {
  id: Id;
  fromEditionId: Id;
  toEditionId: Id;
  createdAt: IsoDateTime;
  status: 'pending' | 'completed';
  decisions: RecalcDecision[];
  decidedBy?: string;
  decidedAt?: IsoDateTime;
}

// ---------- Alertas ----------
export type AlertLevel = 'info' | 'warning' | 'critical';

export interface NutriAlert {
  id: string;
  level: AlertLevel;
  kind: 'allergy' | 'restriction' | 'clinical' | 'energy' | 'macro' | 'equivalent';
  title: string;
  reason: string;
  source: string;
  patientId: Id;
  planId?: Id;
  date?: IsoDate;
  slotName?: string;
}

// ---------- Base de datos completa ----------
export interface Db {
  schema: number;
  users: User[];
  sessions: SessionRecord[];
  patients: Patient[];
  consentDocuments: ConsentDocument[];
  consentAcceptances: ConsentAcceptance[];
  editions: SmaeEdition[];
  groups: SmaeGroup[];
  subgroups: SmaeSubgroup[];
  foods: SmaeFood[];
  customFoods: CustomFood[];
  dishes: Dish[];
  plans: MealPlan[];
  templates: PlanTemplate[];
  tracking: TrackingEntry[];
  recalcBatches: RecalcBatch[];
  settings: Settings;
  audit: AuditLog[];
}

export const GOAL_LABEL: Record<Goal, string> = {
  weight_loss: 'Pérdida de peso',
  muscle_gain: 'Ganancia muscular',
  maintenance: 'Mantenimiento',
  health: 'Salud y hábitos',
  other: 'Otro',
};

export const SEX_LABEL: Record<Sex, string> = { F: 'Femenino', M: 'Masculino', O: 'Otro' };

export const PATIENT_STATUS_LABEL: Record<PatientStatus, string> = {
  active: 'Activo',
  invited: 'Invitación pendiente',
  inactive: 'Inactivo',
};

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  finished: 'Finalizado',
  archived: 'Archivado',
};

export const DOC_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  laboratorio: 'Laboratorio',
  estudio: 'Estudio',
  receta: 'Receta médica',
  consentimiento: 'Consentimiento',
  otro: 'Otro',
};

export const PREFERENCE_LABEL: Record<PreferenceType, string> = {
  favorite: 'Favorito',
  avoid: 'No consume',
  restriction: 'Restricción',
  other: 'Otra preferencia',
};

export const DEFAULT_SLOTS = ['Desayuno', 'Colación matutina', 'Comida', 'Colación vespertina', 'Cena'] as const;

// ---------- Laboratorios (química sanguínea) ----------
export interface LabResult {
  name: string;
  value: DecimalStr;
  unit: string;
  refMin?: DecimalStr;
  refMax?: DecimalStr;
}

export interface LabReport {
  id: Id;
  takenAt: IsoDate;
  labName: string;
  notes: string;
  results: LabResult[];
}

/** Análisis frecuentes con su unidad y rango de referencia típico de un adulto. Son orientativos: cada resultado
 *  guarda su propio rango, que la nutrióloga ajusta según el laboratorio y el sexo del paciente. */
export const LAB_CATALOG: readonly { name: string; unit: string; refMin?: string; refMax?: string }[] = [
  { name: 'Glucosa en ayuno', unit: 'mg/dL', refMin: '70', refMax: '99' },
  { name: 'Hemoglobina glucosilada (HbA1c)', unit: '%', refMin: '4', refMax: '5.6' },
  { name: 'Insulina en ayuno', unit: 'µUI/mL', refMin: '2', refMax: '25' },
  { name: 'Colesterol total', unit: 'mg/dL', refMax: '200' },
  { name: 'Colesterol LDL', unit: 'mg/dL', refMax: '100' },
  { name: 'Colesterol HDL', unit: 'mg/dL', refMin: '40' },
  { name: 'Triglicéridos', unit: 'mg/dL', refMax: '150' },
  { name: 'Urea', unit: 'mg/dL', refMin: '15', refMax: '45' },
  { name: 'Nitrógeno ureico (BUN)', unit: 'mg/dL', refMin: '7', refMax: '20' },
  { name: 'Creatinina', unit: 'mg/dL', refMin: '0.6', refMax: '1.3' },
  { name: 'Ácido úrico', unit: 'mg/dL', refMin: '3.5', refMax: '7.2' },
  { name: 'TGO (AST)', unit: 'U/L', refMin: '5', refMax: '40' },
  { name: 'TGP (ALT)', unit: 'U/L', refMin: '7', refMax: '56' },
  { name: 'Bilirrubina total', unit: 'mg/dL', refMin: '0.1', refMax: '1.2' },
  { name: 'Hemoglobina', unit: 'g/dL', refMin: '12', refMax: '17.5' },
  { name: 'Hematocrito', unit: '%', refMin: '36', refMax: '50' },
  { name: 'Leucocitos', unit: '×10³/µL', refMin: '4.5', refMax: '11' },
  { name: 'Plaquetas', unit: '×10³/µL', refMin: '150', refMax: '450' },
  { name: 'Sodio', unit: 'mmol/L', refMin: '135', refMax: '145' },
  { name: 'Potasio', unit: 'mmol/L', refMin: '3.5', refMax: '5.1' },
  { name: 'Calcio', unit: 'mg/dL', refMin: '8.6', refMax: '10.2' },
  { name: 'Magnesio', unit: 'mg/dL', refMin: '1.7', refMax: '2.2' },
  { name: 'Fósforo', unit: 'mg/dL', refMin: '2.5', refMax: '4.5' },
  { name: 'Hierro sérico', unit: 'µg/dL', refMin: '60', refMax: '170' },
  { name: 'Ferritina', unit: 'ng/mL', refMin: '15', refMax: '300' },
  { name: 'Vitamina D (25-OH)', unit: 'ng/mL', refMin: '30', refMax: '100' },
  { name: 'Vitamina B12', unit: 'pg/mL', refMin: '200', refMax: '900' },
  { name: 'TSH', unit: 'µUI/mL', refMin: '0.4', refMax: '4' },
  { name: 'T4 libre', unit: 'ng/dL', refMin: '0.8', refMax: '1.8' },
  { name: 'PCR ultrasensible', unit: 'mg/L', refMax: '3' },
];

export type LabLevel = 'normal' | 'low' | 'high' | 'unknown';
export interface LabStatus { level: LabLevel; tone: 'ok' | 'warn' | 'crit' | 'neutral'; label: string }

/** Semáforo: verde dentro del rango; amarillo si se pasa hasta 10 % del límite; rojo si se pasa más. Sin rango, sin juicio. */
export function labStatus(r: Pick<LabResult, 'value' | 'refMin' | 'refMax'>): LabStatus {
  const v = Number(r.value);
  const min = r.refMin !== undefined && r.refMin !== '' ? Number(r.refMin) : undefined;
  const max = r.refMax !== undefined && r.refMax !== '' ? Number(r.refMax) : undefined;
  if (Number.isNaN(v) || (min === undefined && max === undefined)) return { level: 'unknown', tone: 'neutral', label: 'Sin rango' };
  if (max !== undefined && v > max) return { level: 'high', tone: (v - max) / Math.abs(max || 1) <= 0.1 ? 'warn' : 'crit', label: 'Alto' };
  if (min !== undefined && v < min) return { level: 'low', tone: (min - v) / Math.abs(min || 1) <= 0.1 ? 'warn' : 'crit', label: 'Bajo' };
  return { level: 'normal', tone: 'ok', label: 'Normal' };
}

// ---------- Consultas (citas) ----------
export type AppointmentKind = 'first' | 'follow_up' | 'other';
export type AppointmentMode = 'in_person' | 'online';
export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';

export interface Appointment {
  id: Id;
  patientId: Id;
  patientName: string;
  /** Instantes en ISO 8601 (UTC); la interfaz los muestra en la zona horaria del navegador. */
  startsAt: string;
  endsAt: string;
  kind: AppointmentKind;
  mode: AppointmentMode;
  place: string;
  /** Notas internas: nunca se muestran al paciente. */
  notes: string;
  status: AppointmentStatus;
}

export const APPOINTMENT_KIND_LABEL: Record<AppointmentKind, string> = { first: 'Primera consulta', follow_up: 'Seguimiento', other: 'Otra' };
export const APPOINTMENT_MODE_LABEL: Record<AppointmentMode, string> = { in_person: 'Presencial', online: 'En línea' };
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = { scheduled: 'Programada', completed: 'Realizada', cancelled: 'Cancelada', no_show: 'No asistió' };

// ---------- Salud reproductiva (solo la nutrióloga; la paciente no la ve) ----------
export interface MenstrualRecord { id: string; date: IsoDate; recordedAt: IsoDateTime }
export interface Pregnancy {
  id: string;
  weeksAtStart: number;
  recordedOn: IsoDate;
  dueDate: IsoDate;
  /** Semanas de gestación hoy (o a la fecha en que terminó), calculadas a partir de las del registro. */
  currentWeeks: number;
  notes: string;
  endedOn?: IsoDate;
  active: boolean;
}
export interface Reproductive {
  menarcheAge?: number;
  menarcheUnknown: boolean;
  /** Más reciente primero. */
  periods: MenstrualRecord[];
  pregnancy?: Pregnancy;
  pregnancies: Pregnancy[];
}
/** Lo que se puede capturar, de forma opcional, al registrar a la paciente. */
export interface ReproductiveInitial { menarcheAge?: number; menarcheUnknown?: boolean; lastPeriod?: IsoDate; pregnancyWeeks?: number }
