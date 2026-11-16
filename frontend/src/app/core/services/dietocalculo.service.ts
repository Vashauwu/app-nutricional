import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, of, throwError } from 'rxjs';
import { ApiClient, ApiError } from '../api/api-client';
import { Patient, Reproductive } from '../../shared/models/domain';
import { ageFrom, uid } from '../../shared/utils/format';
import { DietInputs, DietResult, compute, defaultInputs, normalize } from '../../features/dietocalculo/engine';

export interface DietCalcSummary {
  id: string;
  name: string;
  patientId: string | null;
  patientName: string;
  kcal: number;
  updatedAt: string;
}
export interface DietCalc extends DietCalcSummary {
  inputs: DietInputs;
  result: DietResult;
}
export interface DietCalcFilter { patientId?: string; unlinked?: boolean; q?: string }

interface ApiSummary { id: string; name: string; patient_id: string | null; patient_name: string; kcal: number; updated_at: string }
interface ApiDetail extends ApiSummary { inputs: DietInputs; result: DietResult }

const toSummary = (a: ApiSummary): DietCalcSummary => ({ id: a.id, name: a.name, patientId: a.patient_id, patientName: a.patient_name, kcal: a.kcal, updatedAt: a.updated_at });
const toDetail = (a: ApiDetail): DietCalc => ({ ...toSummary(a), inputs: a.inputs, result: a.result });

const num = (v: string | undefined): number | undefined => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Datos del paciente que alimentan un cálculo: lo último capturado en su expediente. */
export function prefillFromPatient(p: Patient, repro: Reproductive | undefined, base: DietInputs = defaultInputs(), now = new Date()): DietInputs {
  const last = [...p.measurements].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
  const wristKey = last?.girths ? Object.keys(last.girths).find((k) => k.startsWith('wrist')) : undefined;
  const out: DietInputs = { ...base, age: ageFrom(p.profile.birthDate, now) };
  if (p.profile.sex === 'F' || p.profile.sex === 'M') out.sex = p.profile.sex;
  if (last) {
    out.weight_kg = num(last.weightKg) ?? out.weight_kg;
    out.height_cm = num(last.heightCm) ?? out.height_cm;
    out.waist_cm = num(last.waistCm);
    out.hip_cm = num(last.hipCm);
    out.body_fat_pct = num(last.bodyFatPct);
    out.wrist_cm = wristKey ? num(last.girths?.[wristKey]) : undefined;
  }
  const preg = repro?.pregnancy;
  out.pregnancy = preg?.active && out.sex === 'F' ? { weeks: Math.min(42, Math.max(1, preg.currentWeeks)) } : undefined;
  return out;
}

/**
 * Cálculos dietéticos guardados. En modo API los guarda el servidor (que recalcula con el mismo motor);
 * en modo simulado viven en memoria (demostración).
 */
@Injectable({ providedIn: 'root' })
export class DietocalculoService {
  private readonly api = inject(ApiClient);
  readonly apiMode = this.api.enabled;
  private readonly demo = signal<DietCalc[]>([]);
  private seeded = false;
  private static readonly STORE = 'nutri-demo-dietocalculo';

  /** El modo simulado conserva lo guardado al recargar la página (solo en este navegador). */
  private persist(): void {
    try { localStorage.setItem(DietocalculoService.STORE, JSON.stringify(this.demo())); } catch { /* sin almacenamiento: queda en memoria */ }
  }

  private seed(): void {
    if (this.seeded || this.apiMode) return;
    this.seeded = true;
    try {
      const raw = localStorage.getItem(DietocalculoService.STORE);
      if (raw) { this.demo.set(JSON.parse(raw) as DietCalc[]); return; }
    } catch { /* se ignora y se crea el ejemplo */ }
    const inputs: DietInputs = { ...defaultInputs(), age: 34, weight_kg: 72, height_cm: 168, activity: 'moderate', kcal_target: 2000 };
    normalize(inputs);
    this.demo.set([{ id: uid('dc'), name: 'Ejemplo: plan de 2000 kcal', patientId: null, patientName: '', kcal: 2000, updatedAt: new Date().toISOString(), inputs, result: compute(inputs) }]);
    this.persist();
  }

  list(f: DietCalcFilter = {}): Observable<DietCalcSummary[]> {
    if (!this.apiMode) {
      this.seed();
      const q = (f.q ?? '').trim().toLowerCase();
      return of(this.demo()
        .filter((d) => (!f.patientId || d.patientId === f.patientId) && (!f.unlinked || !d.patientId) && (!q || d.name.toLowerCase().includes(q)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    }
    return this.api.get<{ items: ApiSummary[] }>('/diet-calculations', { patient_id: f.patientId, unlinked: f.unlinked ? true : undefined, q: f.q || undefined }).pipe(map((r) => r.items.map(toSummary)));
  }

  get(id: string): Observable<DietCalc> {
    if (!this.apiMode) {
      this.seed();
      const d = this.demo().find((x) => x.id === id);
      return d ? of(d) : throwError(() => new ApiError('No encontrado.', 404, 'not_found'));
    }
    return this.api.get<ApiDetail>(`/diet-calculations/${id}`).pipe(map(toDetail));
  }

  /** Guarda (crea si `id` es null). El servidor es la fuente de verdad del resultado. */
  save(id: string | null, v: { name: string; patientId: string | null; patientName: string; inputs: DietInputs }): Observable<DietCalc> {
    if (!this.apiMode) {
      this.seed();
      const inputs = structuredClone(v.inputs);
      const errs = normalize(inputs);
      if (errs) return throwError(() => new ApiError('Revisa los datos marcados.', 422, 'validation_failed', errs));
      const result = compute(inputs);
      const item: DietCalc = { id: id ?? uid('dc'), name: v.name.trim(), patientId: v.patientId, patientName: v.patientName, kcal: result.energy.prescription_kcal, updatedAt: new Date().toISOString(), inputs, result };
      this.demo.update((l) => (id ? l.map((x) => (x.id === id ? item : x)) : [item, ...l]));
      this.persist();
      return of(item);
    }
    const body = { name: v.name, patient_id: v.patientId ?? '', inputs: v.inputs };
    return (id ? this.api.put<ApiDetail>(`/diet-calculations/${id}`, body) : this.api.post<ApiDetail>('/diet-calculations', body)).pipe(map(toDetail));
  }

  remove(id: string): Observable<void> {
    if (!this.apiMode) {
      this.seed();
      this.demo.update((l) => l.filter((x) => x.id !== id));
      this.persist();
      return of(void 0);
    }
    return this.api.delete(`/diet-calculations/${id}`);
  }
}
