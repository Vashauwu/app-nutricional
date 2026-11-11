import { Injectable, inject, signal } from '@angular/core';
import { Observable, of, throwError, tap, map, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { TrackingApi } from '../api/tracking-api';
import { DbService } from '../data/db.service';
import { IsoDate, MealComment, MealPlan, PlanItem, PlanSlot, TrackingEntry } from '../../shared/models/domain';
import { Page, paginate } from '../../shared/utils/loadable';
import { normalizeText, todayIso, uid } from '../../shared/utils/format';

export interface ComplianceResult {
  planned: number;
  done: number;
  skipped: number;
  pending: number;
  pct: number | null;
}

export interface FeedQuery {
  search: string;
  patientId: string;
  kind: '' | 'photos' | 'comments' | 'review' | 'skipped';
  page: number;
  pageSize: number;
}

/**
 * Criterio de cumplimiento (propuesto; el spec lo deja pendiente en §25.2):
 * comidas realizadas ÷ comidas programadas hasta hoy en planes publicados o
 * finalizados. Las omitidas y las sin registro no suman.
 */
export function computeCompliance(plans: MealPlan[], tracking: TrackingEntry[], from?: IsoDate, to?: IsoDate): ComplianceResult {
  const today = todayIso();
  const end = to && to < today ? to : today;
  let planned = 0;
  let done = 0;
  let skipped = 0;
  const byItem = new Map(tracking.map((t) => [`${t.planId}:${t.itemId}`, t]));
  for (const p of plans) {
    if (p.status === 'draft' || p.deletedAt) continue;
    for (const day of p.days) {
      if (day.date > end || (from && day.date < from)) continue;
      for (const slot of day.slots) {
        for (const item of slot.items) {
          planned++;
          const e = byItem.get(`${p.id}:${item.id}`);
          if (e?.status === 'done') done++;
          else if (e?.status === 'skipped') skipped++;
        }
      }
    }
  }
  return { planned, done, skipped, pending: planned - done - skipped, pct: planned ? Math.round((done / planned) * 100) : null };
}

@Injectable({ providedIn: 'root' })
export class TrackingService {
  private readonly data = inject(DbService);
  private readonly remote = inject(TrackingApi);
  readonly apiMode = inject(ApiClient).enabled;
  /** Modo API: cumplimiento calculado por el servidor, por paciente y periodo. */
  private readonly complianceCache = signal<Record<string, ComplianceResult>>({});
  private readonly requested = new Set<string>();

  private guard<T>(fn: () => T): Observable<T> {
    try {
      return of(fn());
    } catch (e) {
      return throwError(() => e);
    }
  }

  /** Modo API: trae los registros recientes de un paciente (para su expediente). */
  loadPatient(patientId: string): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.remote.feed({ patientId, kind: '', search: '', page: 1, pageSize: 30 }).pipe(map(() => void 0));
  }

  /** Modo API: trae los registros de un paciente en un periodo (para reportes). Pagina hasta 500 registros. */
  loadRange(patientId: string, from: string, to: string): Observable<void> {
    if (!this.apiMode) return of(void 0);
    const page = (n: number): Observable<void> =>
      this.remote.feed({ patientId, kind: '', search: '', page: n, pageSize: 100 }, from, to).pipe(
        switchMap((p) => (p.page * p.pageSize < p.total && n < 5 ? page(n + 1) : of(void 0))),
      );
    return page(1);
  }

  /** Modo API: cumplimiento del paciente en el servidor; se refresca al cambiar el periodo. */
  refreshCompliance(patientId: string | undefined, from: string, to: string): void {
    const key = `${patientId ?? 'me'}:${from}:${to}`;
    this.requested.add(key);
    this.remote.compliance(patientId, from, to).subscribe({
      next: (c) => this.complianceCache.update((m) => ({ ...m, [key]: { planned: c.planned, done: c.done, skipped: c.skipped, pending: c.pending, pct: c.pct } })),
      error: () => undefined,
    });
  }

  entriesOf = (patientId: string): TrackingEntry[] => this.data.db().tracking.filter((t) => t.patientId === patientId);

  compliance(patientId: string, from?: IsoDate, to?: IsoDate): ComplianceResult {
    if (this.apiMode) {
      const key = `${patientId}:${from ?? ''}:${to ?? ''}`;
      if (!this.requested.has(key)) queueMicrotask(() => this.refreshCompliance(patientId, from ?? '', to ?? ''));
      return this.complianceCache()[key] ?? { planned: 0, done: 0, skipped: 0, pending: 0, pct: null };
    }
    const d = this.data.db();
    return computeCompliance(d.plans.filter((p) => p.patientId === patientId), d.tracking.filter((t) => t.patientId === patientId), from, to);
  }

  feed(q: FeedQuery): Observable<Page<TrackingEntry>> {
    if (this.apiMode) return this.remote.feed({ patientId: q.patientId || undefined, kind: q.kind, search: q.search, page: q.page, pageSize: q.pageSize });
    return this.data.respond(() => {
      const term = normalizeText(q.search);
      let list = this.data.db().tracking.filter((t) => {
        if (q.patientId && t.patientId !== q.patientId) return false;
        if (q.kind === 'photos' && !t.photos.length) return false;
        if (q.kind === 'comments' && !t.patientComment && !t.thread.length) return false;
        if (q.kind === 'review' && !t.needsReview) return false;
        if (q.kind === 'skipped' && t.status !== 'skipped') return false;
        if (term && !normalizeText(`${t.dishName} ${t.patientComment} ${this.data.patientName(t.patientId)}`).includes(term)) return false;
        return true;
      });
      list = list.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
      return paginate(list, q.page, q.pageSize);
    });
  }

  entryFor(planId: string, itemId: string): TrackingEntry | undefined {
    return this.data.db().tracking.find((t) => t.planId === planId && t.itemId === itemId);
  }

  /** El registro del paciente exige conexión (§12.5). */
  record(opts: { patientId: string; plan: MealPlan; date: IsoDate; slot: PlanSlot; item: PlanItem; status: 'done' | 'skipped'; comment?: string }): Observable<void> {
    if (this.apiMode) {
      if (!this.data.isOnline()) return throwError(() => new Error('Necesitas conexión para registrar tu seguimiento.'));
      return this.remote.record(opts.item.id, opts.status, opts.comment);
    }
    return this.guard(() => this.recordLocal(opts));
  }

  private recordLocal(opts: { patientId: string; plan: MealPlan; date: IsoDate; slot: PlanSlot; item: PlanItem; status: 'done' | 'skipped'; comment?: string }): void {
    if (!this.data.isOnline()) throw new Error('Necesitas conexión para registrar tu seguimiento.');
    this.data.mutate((d) => {
      const dish = d.dishes.find((x) => x.id === opts.item.dishId);
      const existing = d.tracking.find((t) => t.planId === opts.plan.id && t.itemId === opts.item.id);
      if (existing) {
        existing.status = opts.status;
        existing.recordedAt = new Date().toISOString();
        existing.needsReview = true;
        if (opts.comment !== undefined) existing.patientComment = opts.comment;
        return;
      }
      d.tracking.push({
        id: uid('t'), patientId: opts.patientId, planId: opts.plan.id, date: opts.date, slotId: opts.slot.id, slotName: opts.slot.name,
        itemId: opts.item.id,
        // Vinculado a la versión exacta del platillo asignada en ese momento (§12.3).
        dishId: opts.item.dishId, dishVersion: opts.item.dishVersion, dishName: dish?.name ?? 'Platillo',
        status: opts.status, recordedAt: new Date().toISOString(), patientComment: opts.comment ?? '', photos: [], thread: [], needsReview: true,
      });
    });
  }

  clearRecord(planId: string, itemId: string): Observable<void> {
    if (this.apiMode) {
      if (!this.data.isOnline()) return throwError(() => new Error('Necesitas conexión para registrar tu seguimiento.'));
      const entry = this.entryFor(planId, itemId);
      return entry ? this.remote.clear(entry.id) : of(void 0);
    }
    return this.guard(() => this.clearLocal(planId, itemId));
  }

  private clearLocal(planId: string, itemId: string): void {
    if (!this.data.isOnline()) throw new Error('Necesitas conexión para registrar tu seguimiento.');
    this.data.mutate((d) => {
      d.tracking = d.tracking.filter((t) => !(t.planId === planId && t.itemId === itemId));
    });
  }

  addComment(entryId: string, role: 'patient' | 'nutritionist', authorName: string, body: string): Observable<void> {
    if (this.apiMode) {
      if (!this.data.isOnline()) return throwError(() => new Error('Necesitas conexión para comentar.'));
      return this.remote.comment(entryId, role, body);
    }
    return this.guard(() => this.commentLocal(entryId, role, authorName, body));
  }

  private commentLocal(entryId: string, role: 'patient' | 'nutritionist', authorName: string, body: string): void {
    if (!this.data.isOnline()) throw new Error('Necesitas conexión para comentar.');
    const text = body.trim();
    if (!text) return;
    this.data.mutate((d) => {
      const e = d.tracking.find((t) => t.id === entryId);
      if (!e) return;
      const c: MealComment = { id: uid('c'), authorRole: role, authorName, body: text.slice(0, 1000), at: new Date().toISOString() };
      e.thread.push(c);
      e.needsReview = role === 'patient';
    });
  }

  addPhoto(entryId: string, dataUrl: string, alt: string): Observable<void> {
    if (this.apiMode) {
      if (!this.data.isOnline()) return throwError(() => new Error('Necesitas conexión para subir fotografías.'));
      return this.remote.photo(entryId, dataUrl, alt);
    }
    return this.guard(() => this.photoLocal(entryId, dataUrl, alt));
  }

  private photoLocal(entryId: string, dataUrl: string, alt: string): void {
    if (!this.data.isOnline()) throw new Error('Necesitas conexión para subir fotografías.');
    this.data.mutate((d) => {
      const e = d.tracking.find((t) => t.id === entryId);
      if (!e) return;
      e.photos.push({ id: uid('ph'), dataUrl, alt, uploadedAt: new Date().toISOString() });
      e.needsReview = true;
      const p = d.patients.find((x) => x.id === e.patientId);
      if (p) p.usedBytes += Math.round(dataUrl.length * 0.75);
    });
  }

  markReviewed(entryId: string): Observable<void> {
    if (this.apiMode) return this.remote.review(entryId);
    return this.guard(() => this.reviewLocal(entryId));
  }

  private reviewLocal(entryId: string): void {
    this.data.mutate((d) => {
      const e = d.tracking.find((t) => t.id === entryId);
      if (e) e.needsReview = false;
    });
  }

  /** Registra la foto en un seguimiento nuevo cuando todavía no hay registro de la comida. */
  ensureEntry(patientId: string, plan: MealPlan, date: IsoDate, slot: PlanSlot, item: PlanItem): TrackingEntry {
    const found = this.entryFor(plan.id, item.id);
    if (found) return found;
    this.recordLocal({ patientId, plan, date, slot, item, status: 'done' });
    return this.entryFor(plan.id, item.id)!;
  }
}
