import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap, tap } from 'rxjs';
import { MealComment, TrackingEntry, TrackingPhoto } from '../../shared/models/domain';
import { Page } from '../../shared/utils/loadable';
import { DbService } from '../data/db.service';
import { ApiClient } from './api-client';

// ---------- Formas de la API (backend/internal/tracking) ----------
export interface ApiEntry {
  id: string; patient_id: string; patient_name?: string; plan_id: string; item_id: string; date: string; slot_name: string; dish_id: string; dish_version: number; dish_name: string;
  status: 'done' | 'skipped'; recorded_at: string; patient_comment: string; needs_review: boolean;
  photos: { id: string; url: string; thumb_url: string; alt: string; uploaded_at: string }[] | null;
  thread: { id: string; author_role: 'patient' | 'nutritionist'; author_name: string; body: string; at: string }[] | null;
}
interface ApiPage { items: ApiEntry[] | null; total: number; page: number; page_size: number; pending_review: number }
export interface ApiCompliance {
  from: string; to: string; planned: number; done: number; skipped: number; pending: number; pct: number | null;
  days: { date: string; planned: number; done: number; skipped: number; pct: number | null }[] | null;
}

export function mapEntry(e: ApiEntry): TrackingEntry {
  return {
    id: e.id, patientId: e.patient_id, planId: e.plan_id, date: e.date.slice(0, 10), slotId: '', slotName: e.slot_name, itemId: e.item_id, dishId: e.dish_id, dishVersion: e.dish_version,
    dishName: e.dish_name, status: e.status, recordedAt: e.recorded_at, patientComment: e.patient_comment, needsReview: e.needs_review,
    photos: (e.photos ?? []).map((p): TrackingPhoto => ({ id: p.id, dataUrl: p.thumb_url || p.url, alt: p.alt, uploadedAt: p.uploaded_at })),
    thread: (e.thread ?? []).map((c): MealComment => ({ id: c.id, authorRole: c.author_role, authorName: c.author_name, body: c.body, at: c.at })),
  };
}

/** Seguimiento desde la API; las entradas se reflejan en DbService para que las pantallas no cambien. */
@Injectable({ providedIn: 'root' })
export class TrackingApi {
  private readonly api = inject(ApiClient);
  private readonly data = inject(DbService);

  /** Reemplaza/agrega entradas en el almacén local. */
  mirror(entries: ApiEntry[]): TrackingEntry[] {
    const mapped = entries.map(mapEntry);
    const names: Record<string, string> = {};
    for (const e of entries) if (e.patient_name) names[e.patient_id] = e.patient_name;
    this.data.mutate((d) => {
      for (const t of mapped) {
        const at = d.tracking.findIndex((x) => x.id === t.id);
        if (at >= 0) d.tracking[at] = t;
        else d.tracking.push(t);
      }
    });
    this.data.rememberNames(names);
    return mapped;
  }

  feed(q: { patientId?: string; kind: string; search: string; page: number; pageSize: number }, from?: string, to?: string): Observable<Page<TrackingEntry>> {
    return this.api
      .get<ApiPage>('/tracking', { patient_id: q.patientId, kind: q.kind, search: q.search, page: q.page, page_size: q.pageSize, from, to })
      .pipe(map((r) => ({ items: this.mirror(r.items ?? []), total: r.total, page: r.page, pageSize: r.page_size })));
  }

  /** Pendientes de revisión (para el tablero). */
  pending(): Observable<number> {
    return this.api.get<ApiPage>('/tracking', { kind: 'review', page: 1, page_size: 1 }).pipe(map((r) => r.pending_review));
  }

  mine(): Observable<void> {
    return this.api.get<ApiPage>('/me/tracking').pipe(tap((r) => this.mirror(r.items ?? [])), map(() => void 0));
  }

  record(itemId: string, status: 'done' | 'skipped', comment?: string): Observable<void> {
    return this.api.put<ApiEntry>(`/me/tracking/items/${itemId}`, { status, comment }).pipe(tap((e) => this.mirror([e])), map(() => void 0));
  }
  clear(entryId: string): Observable<void> {
    return this.api.delete(`/me/tracking/${entryId}`).pipe(
      tap(() => this.data.mutate((d) => { d.tracking = d.tracking.filter((t) => t.id !== entryId); })),
      map(() => void 0),
    );
  }
  comment(entryId: string, role: 'patient' | 'nutritionist', body: string): Observable<void> {
    const path = role === 'patient' ? `/me/tracking/${entryId}/comments` : `/tracking/${entryId}/comments`;
    return this.api.post<ApiEntry>(path, { body }).pipe(tap((e) => this.mirror([e])), map(() => void 0));
  }
  photo(entryId: string, dataUrl: string, alt: string): Observable<void> {
    return of(dataUrl).pipe(
      switchMap(async (u) => (await fetch(u)).blob()),
      switchMap((blob) => {
        const f = new FormData();
        f.append('file', blob, 'comida.jpg');
        f.append('alt', alt);
        return this.api.post<ApiEntry>(`/me/tracking/${entryId}/photos`, f);
      }),
      tap((e) => this.mirror([e])),
      map(() => void 0),
    );
  }
  review(entryId: string): Observable<void> {
    return this.api.post(`/tracking/${entryId}/review`).pipe(
      tap(() => this.data.mutate((d) => { const e = d.tracking.find((t) => t.id === entryId); if (e) e.needsReview = false; })),
      map(() => void 0),
    );
  }

  compliance(patientId: string | undefined, from: string, to: string): Observable<ApiCompliance> {
    const path = patientId ? `/patients/${patientId}/compliance` : '/me/compliance';
    return this.api.get<ApiCompliance>(path, { from, to });
  }
}
