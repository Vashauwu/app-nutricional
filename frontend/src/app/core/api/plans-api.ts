import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { MealPlan, NutriAlert, PlanDay, PlanEvent, PlanPublication, PlanStatus, PlanTargets, PlanTemplate } from '../../shared/models/domain';
import { Page } from '../../shared/utils/loadable';
import { dec, div } from '../../shared/utils/decimal';
import { DbService } from '../data/db.service';
import { ApiClient } from './api-client';
import { ApiNutrients, toNutrients } from './catalog-api';
import { PatientsApi } from './patients-api';

// ---------- Formas de la API (backend/internal/mealplans) ----------
interface ApiTotals { nutrients: ApiNutrients; equivalents: Record<string, string> | null }
interface ApiItem {
  id: string; dish_id: string; dish_name: string; dish_category: string; dish_version: number; servings: string; instructions: string;
  per_serving: ApiNutrients; totals: ApiTotals;
}
interface ApiPlan {
  id: string; patient_id: string; patient_name?: string; name: string; status: PlanStatus; start_date: string; end_date: string; revision: number;
  targets: { energy_kcal: string; protein_g: string; carbohydrates_g: string; lipids_g: string; equivalents: Record<string, string> | null };
  targets_version: number; updated_at: string; created_at: string;
  days: { date: string; notes: string; slots: { id: string; name: string; items: ApiItem[] | null }[] | null }[] | null;
}
interface ApiListItem {
  id: string; patient_id: string; patient_name: string; name: string; status: PlanStatus; start_date: string; end_date: string; revision: number; item_count: number; updated_at: string;
}
interface ApiHistory {
  events: { id: string; at: string; actor: string | null; type: PlanEvent['type'] | 'unpublished' | 'deleted'; summary: string }[] | null;
  publications: { version_number: number; revision: number; published_at: string; summary: string }[] | null;
}
interface ApiTemplate { id: string; name: string; description: string; scope: 'global' | 'patient'; patient_id: string | null; days: number; created_at: string }
export interface ApiAlert {
  id: string; level: NutriAlert['level']; kind: NutriAlert['kind']; title: string; reason: string; source: string; patient_id: string; plan_id: string; date?: string; slot_name?: string;
}

const dateOnly = (s: string): string => (s ?? '').slice(0, 10);

const mapTargets = (t: ApiPlan['targets'], version: number): PlanTargets => ({
  energy: t.energy_kcal, protein: t.protein_g, carbs: t.carbohydrates_g, lipids: t.lipids_g, equivalents: t.equivalents ?? {}, version,
});

export const mapAlert = (a: ApiAlert): NutriAlert => ({
  id: a.id, level: a.level, kind: a.kind, title: a.title, reason: a.reason, source: a.source, patientId: a.patient_id, planId: a.plan_id, date: a.date, slotName: a.slot_name,
});

export function mapPlan(d: ApiPlan, prev?: MealPlan): MealPlan {
  const days: PlanDay[] = (d.days ?? []).map((day) => ({
    date: dateOnly(day.date), notes: day.notes,
    slots: (day.slots ?? []).map((s) => ({
      id: s.id, name: s.name,
      items: (s.items ?? []).map((i) => ({ id: i.id, dishId: i.dish_id, dishVersion: i.dish_version, servings: i.servings, instructions: i.instructions })),
    })),
  }));
  return {
    id: d.id, patientId: d.patient_id, name: d.name, status: d.status, startDate: dateOnly(d.start_date), endDate: dateOnly(d.end_date), revision: d.revision,
    updatedAt: d.updated_at, updatedBy: '', createdAt: d.created_at, createdBy: '', targets: mapTargets(d.targets, d.targets_version), days,
    publications: prev?.publications ?? [], history: prev?.history ?? [],
  };
}

export interface PlanBody {
  name: string;
  targets: { energy_kcal: string; protein_g: string; carbohydrates_g: string; lipids_g: string; equivalents: Record<string, string> };
  days: { date: string; notes: string; slots: { id: string; name: string; items: { id: string; dish_id: string; dish_version: number; servings: string; instructions: string }[] }[] }[];
}

export function toBody(name: string, targets: PlanTargets, days: PlanDay[]): PlanBody {
  return {
    name,
    targets: { energy_kcal: targets.energy, protein_g: targets.protein, carbohydrates_g: targets.carbs, lipids_g: targets.lipids, equivalents: targets.equivalents },
    days: days.map((d) => ({
      date: d.date, notes: d.notes,
      slots: d.slots.map((s) => ({
        id: s.id, name: s.name,
        items: s.items.map((i) => ({ id: i.id, dish_id: i.dishId, dish_version: i.dishVersion, servings: i.servings, instructions: i.instructions ?? '' })),
      })),
    })),
  };
}

@Injectable({ providedIn: 'root' })
export class PlansApi {
  private readonly api = inject(ApiClient);
  private readonly data = inject(DbService);
  private readonly patients = inject(PatientsApi);

  /** Guarda en DbService el plan y las versiones de platillo que usa (con su nutrición por porción) para que el cliente calcule totales. */
  private mirror(raw: ApiPlan, history?: ApiHistory): MealPlan {
    const names = { [raw.patient_id]: raw.patient_name ?? '' };
    let result!: MealPlan;
    this.data.mutate((d) => {
      const prev = d.plans.find((p) => p.id === raw.id);
      const plan = mapPlan(raw, prev);
      if (history) {
        plan.history = (history.events ?? []).map(
          (e): PlanEvent => ({ id: e.id, at: e.at, by: e.actor ? 'Nutrióloga' : 'Sistema', type: (e.type === 'unpublished' || e.type === 'deleted' ? 'edited' : e.type) as PlanEvent['type'], summary: e.summary }),
        );
        plan.publications = (history.publications ?? []).map(
          (p): PlanPublication => ({ versionNumber: p.version_number, publishedAt: p.published_at, by: 'Nutrióloga', summary: p.summary, days: [], targets: plan.targets }),
        );
      }
      const at = d.plans.findIndex((p) => p.id === raw.id);
      if (at >= 0) d.plans[at] = plan;
      else d.plans.push(plan);
      result = plan;

      // Versiones de platillo referenciadas: se crean "resumen" si faltan (sin pisar las cargadas con detalle).
      for (const day of raw.days ?? []) {
        for (const s of day.slots ?? []) {
          for (const i of s.items ?? []) {
            let dish = d.dishes.find((x) => x.id === i.dish_id);
            if (!dish) {
              dish = { id: i.dish_id, name: i.dish_name, category: i.dish_category, tags: [], status: 'active', currentVersion: i.dish_version, versions: [], createdAt: '' };
              d.dishes.push(dish);
            }
            if (dish.versions.some((v) => v.versionNumber === i.dish_version)) continue;
            const n = dec(i.servings);
            const eq: Record<string, string> = {};
            for (const [k, v] of Object.entries(i.totals.equivalents ?? {})) eq[k] = n.isZero() ? '0' : div(dec(v), n).toString();
            dish.versions.push({
              id: `${i.dish_id}-v${i.dish_version}`, versionNumber: i.dish_version, description: '', recipeMode: 'structured', instructionsText: '', steps: [], servings: '1', prepTimeMinutes: 0,
              ingredients: [], recommendations: '',
              nutrition: { totals: toNutrients(i.per_serving), perServing: toNutrients(i.per_serving), equivalents: eq, hasCustomFoods: false, smaeEditionId: '', engineVersion: '', calculatedAt: '' },
              substitutions: [], changeReason: '', createdBy: '', createdAt: '',
            });
            dish.versions.sort((a, b) => a.versionNumber - b.versionNumber);
          }
        }
      }
    });
    this.data.rememberNames(names);
    return result;
  }

  /** El plan vigente de la paciente (`/me/plan`) se refleja con el mismo modelo que los planes de la nutrióloga. */
  mirrorForPatient(raw: ApiPlan): MealPlan {
    return this.mirror(raw);
  }

  /** Carga el plan, su historial y al paciente (para encabezado y propuestas). */
  load(id: string): Observable<MealPlan> {
    return forkJoin({ plan: this.api.get<ApiPlan>(`/plans/${id}`), history: this.api.get<ApiHistory>(`/plans/${id}/history`) }).pipe(
      map(({ plan, history }) => this.mirror(plan, history)),
      switchMap((plan) => this.patients.load(plan.patientId).pipe(map(() => plan), catchError(() => of(plan)))),
    );
  }

  list(q: { search: string; status: string; patientId: string; from: string; to: string; page: number; pageSize: number }): Observable<Page<MealPlan>> {
    return this.api
      .get<{ items: ApiListItem[] | null; total: number; page: number; page_size: number }>('/plans', {
        search: q.search, status: q.status, patient_id: q.patientId, from: q.from, to: q.to, page: q.page, page_size: q.pageSize,
      })
      .pipe(
        map((r) => {
          const names: Record<string, string> = {};
          const items = (r.items ?? []).map((i): MealPlan => {
            names[i.patient_id] = i.patient_name;
            return {
              id: i.id, patientId: i.patient_id, name: i.name, status: i.status, startDate: dateOnly(i.start_date), endDate: dateOnly(i.end_date), revision: i.revision, updatedAt: i.updated_at,
              updatedBy: '', createdAt: i.updated_at, createdBy: '', targets: { energy: '0', protein: '0', carbs: '0', lipids: '0', equivalents: {}, version: 1 }, days: [], publications: [], history: [],
              itemCount: i.item_count,
            };
          });
          this.data.rememberNames(names);
          return { items, total: r.total, page: r.page, pageSize: r.page_size };
        }),
      );
  }

  create(body: { patient_id: string; name: string; start_date: string; end_date: string; targets?: PlanBody['targets']; template_id?: string; copy_from_plan_id?: string }): Observable<string> {
    return this.api.post<ApiPlan>('/plans', body).pipe(map((p) => this.mirror(p).id));
  }

  save(id: string, expectedRevision: number, body: PlanBody): Observable<MealPlan> {
    return this.api.put<ApiPlan>(`/plans/${id}`, { expected_revision: expectedRevision, ...body }).pipe(map((p) => this.mirror(p)));
  }

  transition(id: string, action: 'publish' | 'unpublish' | 'finalize' | 'archive' | 'restore', summary = ''): Observable<MealPlan> {
    return this.api.post<ApiPlan>(`/plans/${id}/${action}`, { summary }).pipe(
      map((p) => this.mirror(p)),
      switchMap((p) => this.load(p.id)),
    );
  }

  remove(id: string): Observable<unknown> {
    return this.api.delete(`/plans/${id}`).pipe(tap(() => this.data.mutate((d) => { d.plans = d.plans.filter((p) => p.id !== id); })));
  }

  substitute(id: string, itemId: string, dishId: string, dishVersion: number, reason: string): Observable<MealPlan> {
    return this.api.post<ApiPlan>(`/plans/${id}/substitute`, { item_id: itemId, dish_id: dishId, dish_version: dishVersion, reason }).pipe(
      map((p) => this.mirror(p)),
      switchMap((p) => this.load(p.id)),
    );
  }

  // ---------- Plantillas ----------
  loadTemplates(patientId?: string): Observable<void> {
    return this.api.get<{ items: ApiTemplate[] | null }>('/plan-templates', { patient_id: patientId }).pipe(
      tap((r) =>
        this.data.mutate((d) => {
          d.templates = (r.items ?? []).map(
            (t): PlanTemplate => ({
              id: t.id, name: t.name, description: t.description, scope: t.scope, patientId: t.patient_id ?? undefined,
              days: Array.from({ length: t.days }, (_, i) => ({ offset: i, slots: [] })), createdAt: t.created_at, createdBy: '',
            }),
          );
        }),
      ),
      map(() => void 0),
    );
  }
  saveTemplate(planId: string, body: { name: string; description: string; scope: string; from_date: string; to_date: string }): Observable<string> {
    return this.api.post<ApiTemplate>(`/plans/${planId}/template`, body).pipe(map((t) => t.id));
  }
  duplicateTemplate(id: string): Observable<unknown> { return this.api.post(`/plan-templates/${id}/duplicate`); }
  deleteTemplate(id: string): Observable<unknown> { return this.api.delete(`/plan-templates/${id}`); }

  // ---------- Alertas (servidor) ----------
  alerts(planId: string): Observable<NutriAlert[]> {
    return this.api.get<{ items: ApiAlert[] | null }>(`/plans/${planId}/alerts`).pipe(map((r) => (r.items ?? []).map(mapAlert)));
  }
  allAlerts(): Observable<NutriAlert[]> {
    return this.api.get<{ items: ApiAlert[] | null }>('/alerts').pipe(map((r) => (r.items ?? []).map(mapAlert)));
  }
}
