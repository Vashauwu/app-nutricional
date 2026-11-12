import { COMPOSITION_FIELDS, CompositionKey, Measurement } from '../../shared/models/domain';

/** Medición tal como la entrega el servidor (los decimales viajan como texto). */
export interface ApiMeasurement {
  id: string; measured_at: string; weight_kg: string; height_cm: string; bmi: string;
  waist_cm: string | null; hip_cm: string | null; notes: string;
  girths?: Record<string, string> | null;
  [field: string]: unknown;
}

const opt = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export function toMeasurement(m: ApiMeasurement): Measurement {
  const out: Measurement = {
    id: m.id, measuredAt: m.measured_at.slice(0, 10), weightKg: m.weight_kg, heightCm: m.height_cm, bmi: m.bmi,
    waistCm: opt(m.waist_cm), hipCm: opt(m.hip_cm), notes: opt(m.notes), createdBy: '',
  };
  for (const f of COMPOSITION_FIELDS) out[f.key] = opt(m[f.api]);
  const g = Object.fromEntries(Object.entries(m.girths ?? {}).filter(([, v]) => v));
  if (Object.keys(g).length) out.girths = g;
  return out;
}

/** Lo que captura el formulario de una medición nueva (texto tal como se escribió; vacío = no medido). */
export type MeasurementInput = {
  measuredAt: string; weightKg: string; heightCm: string; waistCm?: string; hipCm?: string; notes?: string; girths?: Record<string, string>;
} & Partial<Record<CompositionKey, string>>;

/** Cuerpo de la petición para guardar una medición; los campos vacíos no se envían. */
export function measurementBody(m: MeasurementInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    measured_at: m.measuredAt, weight_kg: m.weightKg, height_cm: m.heightCm,
    waist_cm: m.waistCm || undefined, hip_cm: m.hipCm || undefined, notes: m.notes ?? '',
  };
  for (const f of COMPOSITION_FIELDS) body[f.api] = m[f.key] || undefined;
  const g = Object.fromEntries(Object.entries(m.girths ?? {}).filter(([, v]) => v));
  if (Object.keys(g).length) body['girths'] = g;
  return body;
}
