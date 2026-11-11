import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, of, tap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { LabReport, LabResult } from '../../shared/models/domain';
import { uid } from '../../shared/utils/format';

interface ApiLabResult { name: string; value: string; unit: string; ref_min: string | null; ref_max: string | null }
interface ApiLabReport { id: string; taken_at: string; lab_name: string; notes: string; results: ApiLabResult[] }

/** Lo que captura el formulario de un estudio nuevo (texto tal como se escribió). */
export interface LabInput {
  takenAt: string;
  labName: string;
  notes: string;
  results: { name: string; value: string; unit: string; refMin: string; refMax: string }[];
}

const toReport = (r: ApiLabReport): LabReport => ({
  id: r.id, takenAt: r.taken_at, labName: r.lab_name, notes: r.notes,
  results: r.results.map((x): LabResult => ({ name: x.name, value: x.value, unit: x.unit, refMin: x.ref_min ?? undefined, refMax: x.ref_max ?? undefined })),
});

/** Estudios de laboratorio por paciente. En modo API viven en el servidor; en modo simulado, en memoria (demostración). */
@Injectable({ providedIn: 'root' })
export class LabsService {
  private readonly api = inject(ApiClient);
  readonly apiMode = this.api.enabled;
  private readonly store = signal<Record<string, LabReport[]>>({});

  /** Estudios del paciente, del más reciente al más antiguo. Se lee como señal: la vista se actualiza sola. */
  reports(patientId: string): LabReport[] {
    return this.store()[patientId] ?? [];
  }

  private set(patientId: string, list: LabReport[]): void {
    this.store.update((s) => ({ ...s, [patientId]: [...list].sort((a, b) => b.takenAt.localeCompare(a.takenAt)) }));
  }

  load(patientId: string): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.api.get<{ items: ApiLabReport[] }>(`/patients/${patientId}/labs`).pipe(
      tap((r) => this.set(patientId, r.items.map(toReport))),
      map(() => void 0),
    );
  }

  add(patientId: string, input: LabInput): Observable<void> {
    if (!this.apiMode) {
      const rep: LabReport = {
        id: uid('lab'), takenAt: input.takenAt, labName: input.labName.trim(), notes: input.notes.trim(),
        results: input.results.map((r) => ({ name: r.name.trim(), value: r.value, unit: r.unit.trim(), refMin: r.refMin || undefined, refMax: r.refMax || undefined })),
      };
      this.set(patientId, [...this.reports(patientId), rep]);
      return of(void 0);
    }
    return this.api
      .post<ApiLabReport>(`/patients/${patientId}/labs`, {
        taken_at: input.takenAt, lab_name: input.labName, notes: input.notes,
        results: input.results.map((r) => ({ name: r.name, value: r.value, unit: r.unit, ref_min: r.refMin || undefined, ref_max: r.refMax || undefined })),
      })
      .pipe(
        tap((r) => this.set(patientId, [...this.reports(patientId), toReport(r)])),
        map(() => void 0),
      );
  }

  remove(patientId: string, reportId: string): Observable<void> {
    const drop = () => this.set(patientId, this.reports(patientId).filter((r) => r.id !== reportId));
    if (!this.apiMode) {
      drop();
      return of(void 0);
    }
    return this.api.delete(`/patients/${patientId}/labs/${reportId}`).pipe(tap(drop), map(() => void 0));
  }
}
