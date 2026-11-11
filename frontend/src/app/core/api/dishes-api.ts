import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap, tap } from 'rxjs';
import { Dish, DishVersion, Ingredient, NutritionSnapshot, Substitution } from '../../shared/models/domain';
import { DbService } from '../data/db.service';
import { API, ApiClient } from './api-client';
import { ApiNutrients, toNutrients } from './catalog-api';

// ---------- Formas de la API (backend/internal/dishes) ----------
interface ApiIngredient {
  position: number; food_kind: 'smae' | 'custom'; food_id: string; name: string; quantity: string; unit: string; grams: string; nutrients: ApiNutrients;
  equivalent_code: string | null; equivalent_value: string | null; official: boolean;
}
interface ApiSubstitution { id: string; dish_id: string; dish_version: number; label: string; note: string; rule: string; diff: ApiNutrients | null; approved_at: string }
interface ApiVersion {
  version_number: number; description: string; recipe_mode: 'structured' | 'free'; instructions_text: string; steps: string[] | null; servings: string;
  prep_time_minutes: number; recommendations: string; image_file_id: string | null; smae_edition_id: string; change_reason: string; created_at: string;
  ingredients: ApiIngredient[] | null; substitutions: ApiSubstitution[] | null;
  nutrition: { totals: ApiNutrients; per_serving: ApiNutrients; equivalents: Record<string, string> | null; has_custom_foods: boolean; engine_version: string; calculated_at: string };
}
interface ApiDish {
  id: string; name: string; category: string; tags: string[] | null; status: 'active' | 'inactive'; current_version: number; created_at: string;
  version: ApiVersion; versions: { version_number: number; created_at: string; change_reason: string; serving_energy_kcal: string }[] | null;
}
export interface ApiDishListItem {
  id: string; name: string; category: string; tags: string[] | null; status: 'active' | 'inactive'; current_version: number; description: string; servings: string;
  prep_time_minutes: number; per_serving: ApiNutrients; equivalents: Record<string, string> | null; has_custom_foods: boolean;
}
export interface ApiCandidate { dish_id: string; name: string; version: number; diff: ApiNutrients; same_equivalents: boolean; conflicts: string[] | null; reason: string }

const ZERO = { energy: '0', protein: '0', carbs: '0', lipids: '0', fiber: '0' };
const emptyNutrition = (edition = ''): NutritionSnapshot => ({ totals: { ...ZERO }, perServing: { ...ZERO }, equivalents: {}, hasCustomFoods: false, smaeEditionId: edition, engineVersion: '', calculatedAt: '' });

export const fileUrl = (id: string | null): string | undefined => (id ? `${API}/files/${id}` : undefined);
/** Extrae el id de archivo de una URL /api/v1/files/<id> (para conservar la imagen al guardar una versión nueva). */
export const fileIdOf = (url: string | undefined): string | undefined => url?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];

function mapIngredient(i: ApiIngredient): Ingredient {
  return {
    id: `i${i.position}`, food: { kind: i.food_kind, id: i.food_id }, nameSnapshot: i.name, quantity: i.quantity, unit: i.unit, grams: i.grams, nutrients: toNutrients(i.nutrients),
    equivalent: i.equivalent_code && i.equivalent_value ? { subgroupCode: i.equivalent_code, value: i.equivalent_value } : undefined, official: i.official,
  };
}

function mapSubstitution(s: ApiSubstitution): Substitution {
  return { id: s.id, type: 'dish', label: s.label, dishId: s.dish_id, dishVersion: s.dish_version, note: s.note, rule: s.rule, diff: s.diff ? toNutrients(s.diff) : { ...ZERO }, approvedBy: '', approvedAt: s.approved_at };
}

export function mapVersion(dishId: string, v: ApiVersion, name: string): DishVersion {
  return {
    id: `${dishId}-v${v.version_number}`, versionNumber: v.version_number, description: v.description, recipeMode: v.recipe_mode, instructionsText: v.instructions_text,
    steps: v.steps ?? [], servings: v.servings, prepTimeMinutes: v.prep_time_minutes, ingredients: (v.ingredients ?? []).map(mapIngredient), recommendations: v.recommendations,
    image: v.image_file_id ? { dataUrl: fileUrl(v.image_file_id), alt: name } : undefined,
    nutrition: {
      totals: toNutrients(v.nutrition.totals), perServing: toNutrients(v.nutrition.per_serving), equivalents: v.nutrition.equivalents ?? {}, hasCustomFoods: v.nutrition.has_custom_foods,
      smaeEditionId: v.smae_edition_id, engineVersion: v.nutrition.engine_version, calculatedAt: v.nutrition.calculated_at,
    },
    substitutions: (v.substitutions ?? []).map(mapSubstitution), changeReason: v.change_reason, createdBy: '', createdAt: v.created_at,
  };
}

/** Versión "resumen" (sin ingredientes) construida a partir del listado. */
function shellVersion(l: ApiDishListItem): DishVersion {
  return {
    id: `${l.id}-v${l.current_version}`, versionNumber: l.current_version, description: l.description, recipeMode: 'structured', instructionsText: '', steps: [], servings: l.servings,
    prepTimeMinutes: l.prep_time_minutes, ingredients: [], recommendations: '',
    nutrition: { ...emptyNutrition(), perServing: toNutrients(l.per_serving), equivalents: l.equivalents ?? {}, hasCustomFoods: l.has_custom_foods },
    substitutions: [], changeReason: '', createdBy: '', createdAt: '',
  };
}

export interface DishBody {
  name: string; category: string; description: string; recipe_mode: string; instructions_text: string; recommendations: string; change_reason: string;
  tags: string[]; steps: string[]; servings: string; prep_time_minutes: number; image_file_id?: string;
  ingredients: { food_kind: string; food_id: string; quantity: string; unit: string }[];
}

@Injectable({ providedIn: 'root' })
export class DishesApi {
  private readonly api = inject(ApiClient);
  private readonly data = inject(DbService);

  /** Inserta/actualiza platillos "resumen" sin pisar versiones ya cargadas con detalle. */
  private upsertShells(items: ApiDishListItem[]): void {
    this.data.mutate((d) => {
      for (const l of items) {
        const shell = shellVersion(l);
        const cur = d.dishes.find((x) => x.id === l.id);
        if (!cur) {
          d.dishes.push({ id: l.id, name: l.name, category: l.category, tags: l.tags ?? [], status: l.status, currentVersion: l.current_version, versions: [shell], createdAt: '' });
          continue;
        }
        cur.name = l.name; cur.category = l.category; cur.tags = l.tags ?? []; cur.status = l.status; cur.currentVersion = l.current_version;
        const at = cur.versions.findIndex((v) => v.versionNumber === l.current_version);
        if (at < 0) cur.versions.push(shell);
        else if (!cur.versions[at].ingredients.length && !cur.versions[at].steps.length) cur.versions[at] = shell;
      }
    });
  }

  list(q: { search: string; category: string; subgroupCode: string; status: string; limit: number }): Observable<{ items: ApiDishListItem[]; total: number }> {
    return this.api
      .get<{ items: ApiDishListItem[] | null; total: number }>('/dishes', { search: q.search, category: q.category, subgroup_code: q.subgroupCode, status: q.status, limit: q.limit, offset: 0 })
      .pipe(
        map((r) => ({ items: r.items ?? [], total: r.total })),
        tap((r) => this.upsertShells(r.items)),
      );
  }

  /** Todos los platillos activos (resumen) para selectores de planes y sustitutos. */
  all(): Observable<void> {
    return this.api.get<{ items: ApiDishListItem[] | null }>('/dishes', { limit: 100, offset: 0 }).pipe(tap((r) => this.upsertShells(r.items ?? [])), map(() => void 0));
  }

  /** Carga una versión completa (la vigente si no se indica) y el resumen de versiones. */
  load(id: string, version?: number): Observable<void> {
    return this.api.get<ApiDish>(`/dishes/${id}`, { version }).pipe(
      tap((r) => {
        this.data.mutate((d) => {
          const full = mapVersion(r.id, r.version, r.name);
          const prev = d.dishes.find((x) => x.id === r.id);
          const known = new Map((prev?.versions ?? []).map((v) => [v.versionNumber, v]));
          for (const s of r.versions ?? []) {
            if (known.has(s.version_number)) continue;
            known.set(s.version_number, {
              id: `${r.id}-v${s.version_number}`, versionNumber: s.version_number, description: '', recipeMode: 'structured', instructionsText: '', steps: [], servings: '1', prepTimeMinutes: 0,
              ingredients: [], recommendations: '', nutrition: { ...emptyNutrition(), perServing: { ...ZERO, energy: s.serving_energy_kcal } }, substitutions: [],
              changeReason: s.change_reason, createdBy: '', createdAt: s.created_at,
            });
          }
          known.set(full.versionNumber, full);
          const dish: Dish = {
            id: r.id, name: r.name, category: r.category, tags: r.tags ?? [], status: r.status, currentVersion: r.current_version,
            versions: [...known.values()].sort((a, b) => a.versionNumber - b.versionNumber), createdAt: r.created_at,
          };
          const at = d.dishes.findIndex((x) => x.id === r.id);
          if (at >= 0) d.dishes[at] = dish;
          else d.dishes.push(dish);
        });
      }),
      map(() => void 0),
    );
  }

  /** Sube una imagen de platillo (si es nueva) y devuelve su id de archivo. */
  uploadImage(dataUrl: string): Observable<string> {
    return of(dataUrl).pipe(
      switchMap(async (u) => (await fetch(u)).blob()),
      switchMap((blob) => {
        const f = new FormData();
        f.append('kind', 'dish_image');
        f.append('file', blob, 'platillo.jpg');
        return this.api.post<{ id: string }>('/uploads/images', f);
      }),
      map((r) => r.id),
    );
  }

  create(body: DishBody): Observable<string> { return this.api.post<ApiDish>('/dishes', body).pipe(map((r) => r.id)); }
  newVersion(id: string, body: DishBody): Observable<string> { return this.api.post<ApiDish>(`/dishes/${id}/versions`, body).pipe(map((r) => r.id)); }
  duplicate(id: string): Observable<string> { return this.api.post<ApiDish>(`/dishes/${id}/duplicate`).pipe(map((r) => r.id)); }
  setActive(id: string, active: boolean): Observable<unknown> { return this.api.post(`/dishes/${id}/active`, { active }); }
  usage(id: string): Observable<number> { return this.api.get<{ plans: number }>(`/dishes/${id}/usage`).pipe(map((r) => r.plans)); }
  candidates(id: string, patientId?: string): Observable<ApiCandidate[]> {
    return this.api.get<{ items: ApiCandidate[] | null }>(`/dishes/${id}/substitute-candidates`, { patient_id: patientId }).pipe(map((r) => r.items ?? []));
  }
  /** `version` es la del platillo base al que se agrega el sustituto; el sustituto entra con su versión vigente. */
  addSubstitution(id: string, version: number, substituteId: string, note: string): Observable<unknown> {
    return this.api.post(`/dishes/${id}/substitutions`, { substitute_dish_id: substituteId, version, note });
  }
  removeSubstitution(id: string, subId: string): Observable<unknown> { return this.api.delete(`/dishes/${id}/substitutions/${subId}`); }
}
