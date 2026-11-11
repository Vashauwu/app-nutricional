import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, expand, forkJoin, map, of, reduce, tap } from 'rxjs';
import {
  CustomFood, CustomFoodSource, EquivalenceRule, NutrientProfile, SmaeEdition, SmaeFood, SmaeGroup, SmaePortion, SmaeSubgroup,
} from '../../shared/models/domain';
import { DbService } from '../data/db.service';
import { ApiClient } from './api-client';

// ---------- Formas de la API (backend/internal/smae) ----------
interface ApiPortion { name: string; unit: string; quantity: string; grams_equivalent: string }
interface ApiEquivalence { subgroup_code: string; reference_grams: string; equivalent_value: string; assigned_at?: string; criterion?: string }
export interface ApiFood {
  kind: 'smae' | 'custom'; id: string; edition_id?: string; code?: string; name: string; brand?: string; description?: string; official: boolean;
  tags: string[] | null; portions: ApiPortion[] | null; basis_quantity: string; basis_unit: 'g' | 'ml';
  energy_kcal: string; protein_g: string; carbohydrates_g: string; lipids_g: string; fiber_g: string; density_g_per_ml?: string;
  equivalence?: ApiEquivalence; source_type?: string; source_reference?: string; validated_at?: string; status: 'active' | 'inactive';
}
interface FoodsPage { items: ApiFood[]; total: number; limit: number; offset: number }
interface ApiEdition {
  id: string; name: string; edition_number: number; publisher: string; source_reference: string; license_reference: string; effective_date: string;
  status: SmaeEdition['status']; notes: string; imported_at: string;
}
interface ApiTaxonomy {
  groups: { id: string; edition_id: string; code: string; name: string; sort_order: number; tone: SmaeGroup['tone'] }[];
  subgroups: { id: string; group_id: string; code: string; name: string }[];
}

const dateOnly = (s: string): string => (s ?? '').slice(0, 10);

const portions = (l: ApiPortion[] | null): SmaePortion[] =>
  (l ?? []).map((p, i) => ({ id: `p${i}`, name: p.name, quantity: p.quantity, unit: p.unit, gramsEquivalent: p.grams_equivalent, isReference: i === 0 }));

const profile = (f: ApiFood): NutrientProfile => ({
  basisQuantity: f.basis_quantity, basisUnit: f.basis_unit, energy: f.energy_kcal, protein: f.protein_g, carbs: f.carbohydrates_g, lipids: f.lipids_g, fiber: f.fiber_g,
});

const rule = (e: ApiEquivalence): EquivalenceRule => ({ subgroupCode: e.subgroup_code, referenceGrams: e.reference_grams, equivalentValue: e.equivalent_value });

export const mapSmaeFood = (f: ApiFood): SmaeFood => ({
  id: f.id, editionId: f.edition_id ?? '', code: f.code ?? '', name: f.name, foodState: '', ediblePct: '100', portions: portions(f.portions), profile: profile(f),
  equivalence: f.equivalence ? rule(f.equivalence) : { subgroupCode: '', referenceGrams: f.basis_quantity, equivalentValue: '1' },
  densityGPerMl: f.density_g_per_ml, tags: f.tags ?? [], sourceReference: f.source_reference ?? '',
});

export const mapCustomFood = (f: ApiFood): CustomFood => ({
  id: f.id, name: f.name, brand: f.brand || undefined, description: f.description ?? '', portions: portions(f.portions), profile: profile(f),
  sourceType: (f.source_type ?? 'manual') as CustomFoodSource, sourceReference: f.source_reference ?? '', createdBy: '',
  validatedBy: f.validated_at ? 'Nutrióloga' : undefined, validatedAt: f.validated_at, status: f.status, tags: f.tags ?? [],
  equivalence: f.equivalence ? { ...rule(f.equivalence), assignedBy: '', assignedAt: f.equivalence.assigned_at ?? '', criterion: f.equivalence.criterion ?? '' } : undefined,
  createdAt: new Date().toISOString(),
});

export interface ApiImpactRow {
  dish_id: string; name: string; from_version: number; changed_foods: string[]; blocked?: string;
  before: ApiNutrients; after: ApiNutrients; diff: ApiNutrients;
}
export interface ApiNutrients { energy_kcal: string; protein_g: string; carbohydrates_g: string; lipids_g: string; fiber_g: string }

export const toNutrients = (n: ApiNutrients) => ({ energy: n.energy_kcal, protein: n.protein_g, carbs: n.carbohydrates_g, lipids: n.lipids_g, fiber: n.fiber_g });

export interface CustomFoodBody {
  name: string; brand?: string; description: string; basis_quantity: string; basis_unit: 'g' | 'ml'; energy_kcal: string; protein_g: string;
  carbohydrates_g: string; lipids_g: string; fiber_g: string; source_type: string; source_reference: string; tags: string[];
  portions: { name: string; unit: string; quantity: string; grams_equivalent: string }[];
}

/** Catálogo SMAE y alimentos personalizados desde la API; se guardan en DbService (memoria) para que las pantallas no cambien. */
@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly api = inject(ApiClient);
  private readonly data = inject(DbService);
  private loaded = false;

  private pages(path: string, extra: Record<string, string | boolean>): Observable<ApiFood[]> {
    const fetch = (offset: number): Observable<FoodsPage> => this.api.get<FoodsPage>(path, { ...extra, limit: 100, offset });
    return fetch(0).pipe(
      expand((p) => (p.items.length && p.offset + p.items.length < p.total ? fetch(p.offset + p.items.length) : EMPTY)),
      reduce((acc, p) => [...acc, ...p.items], [] as ApiFood[]),
    );
  }

  /** Carga taxonomía, ediciones, alimentos SMAE de la edición activa y alimentos personalizados. */
  hydrate(force = false): Observable<void> {
    if (this.loaded && !force) return of(void 0);
    return forkJoin({
      editions: this.api.get<{ items: ApiEdition[] }>('/smae/editions'),
      tax: this.api.get<ApiTaxonomy>('/smae/taxonomy'),
      smae: this.pages('/smae/foods', { source: 'smae' }),
      custom: this.pages('/custom-foods', { include_inactive: true }),
    }).pipe(
      tap((r) => {
        this.data.mutate((d) => {
          d.editions = r.editions.items.map(
            (e): SmaeEdition => ({
              id: e.id, name: e.name, editionNumber: e.edition_number, publisher: e.publisher, sourceReference: e.source_reference, licenseReference: e.license_reference,
              effectiveDate: dateOnly(e.effective_date), importedAt: e.imported_at, status: e.status, notes: e.notes,
            }),
          );
          d.groups = (r.tax.groups ?? []).map((g): SmaeGroup => ({ id: g.id, editionId: g.edition_id, code: g.code, name: g.name, sortOrder: g.sort_order, tone: g.tone }));
          d.subgroups = (r.tax.subgroups ?? []).map((s): SmaeSubgroup => ({ id: s.id, groupId: s.group_id, code: s.code, name: s.name }));
          d.foods = r.smae.filter((f) => f.kind === 'smae').map(mapSmaeFood);
          d.customFoods = r.custom.map(mapCustomFood);
        });
        this.loaded = true;
      }),
      map(() => void 0),
    );
  }

  /** Refresca solo los alimentos personalizados (tras crear/editar). */
  refreshCustom(): Observable<void> {
    return this.pages('/custom-foods', { include_inactive: true }).pipe(
      tap((l) => this.data.mutate((d) => { d.customFoods = l.map(mapCustomFood); })),
      map(() => void 0),
    );
  }

  saveCustom(id: string | undefined, body: CustomFoodBody): Observable<string> {
    return (id ? this.api.put<ApiFood>(`/custom-foods/${id}`, body) : this.api.post<ApiFood>('/custom-foods', body)).pipe(map((f) => f.id));
  }
  validateCustom(id: string): Observable<unknown> { return this.api.post(`/custom-foods/${id}/validate`); }
  setCustomActive(id: string, active: boolean): Observable<unknown> { return this.api.post(`/custom-foods/${id}/active`, { active }); }
  assignEquivalence(id: string, subgroupCode: string, referenceGrams: string, criterion: string): Observable<unknown> {
    return this.api.post(`/custom-foods/${id}/equivalence`, { subgroup_code: subgroupCode, reference_grams: referenceGrams, criterion });
  }

  impact(editionId: string): Observable<ApiImpactRow[]> {
    return this.api.get<{ items?: ApiImpactRow[] } | ApiImpactRow[]>(`/smae/editions/${editionId}/impact`).pipe(map((r) => (Array.isArray(r) ? r : (r.items ?? []))));
  }
  recalc(editionId: string, decisions: { dishId: string; authorize: boolean }[]): Observable<unknown> {
    return this.api.post(`/smae/editions/${editionId}/recalc`, { decisions: decisions.map((d) => ({ dish_id: d.dishId, authorize: d.authorize })) });
  }
  activate(editionId: string): Observable<unknown> { return this.api.post(`/smae/editions/${editionId}/activate`); }
}
