import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, of, tap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { MenstrualRecord, Pregnancy, Reproductive, ReproductiveInitial } from '../../shared/models/domain';
import { todayIso, uid } from '../../shared/utils/format';

interface ApiPregnancy { id: string; weeks_at_start: number; recorded_on: string; due_date: string; current_weeks: number; notes: string; ended_on: string | null; active: boolean }
interface ApiReproductive {
  menarche_age: number | null; menarche_unknown: boolean;
  periods: { id: string; last_period_date: string; recorded_at: string }[];
  pregnancy: ApiPregnancy | null; pregnancies: ApiPregnancy[];
}

const EMPTY: Reproductive = { menarcheUnknown: false, periods: [], pregnancies: [] };
const DAY = 86_400_000;
const day = (iso: string): number => Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
const addDays = (iso: string, n: number): string => new Date(day(iso) + n * DAY).toISOString().slice(0, 10);

const toPregnancy = (p: ApiPregnancy): Pregnancy => ({
  id: p.id, weeksAtStart: p.weeks_at_start, recordedOn: p.recorded_on, dueDate: p.due_date, currentWeeks: p.current_weeks, notes: p.notes, endedOn: p.ended_on ?? undefined, active: p.active,
});
const toRepro = (r: ApiReproductive): Reproductive => {
  const pregnancies = r.pregnancies.map(toPregnancy);
  return {
    menarcheAge: r.menarche_age ?? undefined, menarcheUnknown: r.menarche_unknown,
    periods: r.periods.map((x): MenstrualRecord => ({ id: x.id, date: x.last_period_date, recordedAt: x.recorded_at })),
    pregnancy: pregnancies.find((p) => p.active), pregnancies,
  };
};

/** Mismas reglas del servidor, para el modo simulado: semanas actuales y fecha probable de parto (semana 40). */
const buildPregnancy = (weeks: number, notes: string): Pregnancy => {
  const today = todayIso();
  return { id: uid('emb'), weeksAtStart: weeks, recordedOn: today, dueDate: addDays(today, Math.max(0, 40 - weeks) * 7), currentWeeks: weeks, notes: notes.trim(), active: true };
};

/**
 * Salud reproductiva por paciente: menarca, historial de última menstruación y embarazo.
 * En modo API vive en el servidor (rutas clínicas, tras el consentimiento); en modo simulado, en memoria.
 */
@Injectable({ providedIn: 'root' })
export class ReproductiveService {
  private readonly api = inject(ApiClient);
  readonly apiMode = this.api.enabled;
  private readonly store = signal<Record<string, Reproductive>>({});

  /** Se lee como señal: la vista se actualiza sola. */
  of(patientId: string): Reproductive {
    return this.store()[patientId] ?? EMPTY;
  }

  private set(patientId: string, r: Reproductive): void {
    this.store.update((s) => ({ ...s, [patientId]: r }));
  }

  load(patientId: string): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.api.get<ApiReproductive>(`/patients/${patientId}/reproductive`).pipe(tap((r) => this.set(patientId, toRepro(r))), map(() => void 0));
  }

  /** Modo simulado: lo capturado al registrar a la paciente. En modo API lo guarda el servidor al crearla. */
  seed(patientId: string, i: ReproductiveInitial): void {
    if (this.apiMode || (i.menarcheAge === undefined && !i.menarcheUnknown && !i.lastPeriod && !i.pregnancyWeeks)) return;
    const preg = i.pregnancyWeeks ? buildPregnancy(i.pregnancyWeeks, '') : undefined;
    this.set(patientId, {
      menarcheAge: i.menarcheAge, menarcheUnknown: !!i.menarcheUnknown,
      periods: i.lastPeriod ? [{ id: uid('fum'), date: i.lastPeriod, recordedAt: new Date().toISOString() }] : [],
      pregnancy: preg, pregnancies: preg ? [preg] : [],
    });
  }

  setMenarche(patientId: string, age: number | undefined, unknown: boolean): Observable<void> {
    const apply = () => this.set(patientId, { ...this.of(patientId), menarcheAge: unknown ? undefined : age, menarcheUnknown: unknown });
    if (!this.apiMode) { apply(); return of(void 0); }
    return this.api.put(`/patients/${patientId}/reproductive/menarche`, { age: unknown ? null : age, unknown }).pipe(tap(apply), map(() => void 0));
  }

  addPeriod(patientId: string, date: string): Observable<void> {
    const add = (rec: MenstrualRecord) => {
      const cur = this.of(patientId);
      this.set(patientId, { ...cur, periods: [...cur.periods, rec].sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt)) });
    };
    if (!this.apiMode) { add({ id: uid('fum'), date, recordedAt: new Date().toISOString() }); return of(void 0); }
    return this.api.post<{ id: string; last_period_date: string; recorded_at: string }>(`/patients/${patientId}/reproductive/periods`, { last_period_date: date }).pipe(
      tap((r) => add({ id: r.id, date: r.last_period_date, recordedAt: r.recorded_at })),
      map(() => void 0),
    );
  }

  addPregnancy(patientId: string, weeks: number, notes: string): Observable<void> {
    const add = (p: Pregnancy) => { const cur = this.of(patientId); this.set(patientId, { ...cur, pregnancy: p, pregnancies: [p, ...cur.pregnancies] }); };
    if (!this.apiMode) { add(buildPregnancy(weeks, notes)); return of(void 0); }
    return this.api.post<ApiPregnancy>(`/patients/${patientId}/reproductive/pregnancies`, { weeks, notes }).pipe(tap((r) => add(toPregnancy(r))), map(() => void 0));
  }

  endPregnancy(patientId: string, pregnancyId: string): Observable<void> {
    const end = () => {
      const cur = this.of(patientId);
      const today = todayIso();
      this.set(patientId, { ...cur, pregnancy: undefined, pregnancies: cur.pregnancies.map((p) => (p.id === pregnancyId ? { ...p, active: false, endedOn: today } : p)) });
    };
    if (!this.apiMode) { end(); return of(void 0); }
    return this.api.post(`/patients/${patientId}/reproductive/pregnancies/${pregnancyId}/end`, {}).pipe(tap(end), map(() => void 0));
  }
}
