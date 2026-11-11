import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { DishBody, DishesApi, fileIdOf } from '../api/dishes-api';
import { DbService } from '../data/db.service';
import { Dish, DishVersion, Ingredient, Nutrients, Patient, RecipeMode, Substitution } from '../../shared/models/domain';
import { calcDish, diffNutrients } from '../nutrition/engine';
import { dec, div } from '../../shared/utils/decimal';
import { normalizeText, uid } from '../../shared/utils/format';

export interface DishQuery {
  search: string;
  category: string;
  subgroupCode: string;
  status: 'active' | 'inactive' | '';
  limit: number;
}

export interface DishRow {
  dish: Dish;
  current: DishVersion;
}

export interface DishInput {
  id?: string;
  name: string;
  category: string;
  tags: string[];
  description: string;
  recipeMode: RecipeMode;
  instructionsText: string;
  steps: string[];
  servings: string;
  prepTimeMinutes: number;
  ingredients: Ingredient[];
  recommendations: string;
  imageDataUrl?: string;
  imageAlt?: string;
  changeReason: string;
}

export interface SubstituteCandidate {
  dish: Dish;
  version: DishVersion;
  diff: Nutrients;
  sameEquivalents: boolean;
  conflicts: string[];
  reason: string;
}

export const DISH_CATEGORIES = ['Desayuno', 'Colación', 'Comida', 'Cena', 'Guarnición', 'Bebida', 'Postre'] as const;

@Injectable({ providedIn: 'root' })
export class DishesService {
  private readonly data = inject(DbService);
  private readonly remote = inject(DishesApi);
  readonly apiMode = inject(ApiClient).enabled;

  /** Modo API: carga la versión completa (y el resumen de versiones) de un platillo. */
  load(id: string, version?: number): Observable<void> {
    return this.apiMode ? this.remote.load(id, version) : of(void 0);
  }

  /** Modo API: trae todos los platillos (resumen) para selectores. */
  loadAll(): Observable<void> {
    return this.apiMode ? this.remote.all() : of(void 0);
  }

  get = (id: string): Dish | undefined => this.data.db().dishes.find((d) => d.id === id && !d.deletedAt);
  current = (d: Dish): DishVersion => d.versions.find((v) => v.versionNumber === d.currentVersion) ?? d.versions[d.versions.length - 1];

  categories(): string[] {
    return [...new Set([...DISH_CATEGORIES, ...this.data.db().dishes.map((d) => d.category)])];
  }

  /** Carga progresiva con filtros en "backend" (§16, §20.2). */
  list(q: DishQuery): Observable<{ items: DishRow[]; total: number }> {
    if (this.apiMode) {
      return this.remote.list(q).pipe(
        map((r) => ({
          items: r.items.map((i) => ({ dish: this.data.dish(i.id)!, current: this.current(this.data.dish(i.id)!) })),
          total: r.total,
        })),
      );
    }
    return this.data.respond(() => {
      const term = normalizeText(q.search);
      const rows = this.data.db().dishes
        .filter((d) => !d.deletedAt)
        .filter((d) => (q.status ? d.status === q.status : true))
        .filter((d) => (q.category ? d.category === q.category : true))
        .map((dish) => ({ dish, current: this.current(dish) }))
        .filter(({ dish, current }) => {
          if (q.subgroupCode && !(Number(current.nutrition.equivalents[q.subgroupCode] ?? 0) > 0)) return false;
          if (!term) return true;
          const hay = `${dish.name} ${dish.tags.join(' ')} ${current.ingredients.map((i) => i.nameSnapshot).join(' ')}`;
          return normalizeText(hay).includes(term);
        })
        .sort((a, b) => a.dish.name.localeCompare(b.dish.name, 'es'));
      return { items: rows.slice(0, q.limit), total: rows.length };
    }, 200);
  }

  /** Guardar crea una versión nueva e inmutable (§7.4); la nueva versión se vuelve vigente. */
  save(input: DishInput): Observable<string> {
    if (this.apiMode) return this.saveRemote(input);
    return of(this.saveLocal(input));
  }

  private saveRemote(input: DishInput): Observable<string> {
    const image$ = input.imageDataUrl?.startsWith('data:') ? this.remote.uploadImage(input.imageDataUrl) : of(fileIdOf(input.imageDataUrl));
    return image$.pipe(
      switchMap((imageId) => {
        const body: DishBody = {
          name: input.name.trim(), category: input.category, description: input.description, recipe_mode: input.recipeMode, instructions_text: input.instructionsText,
          recommendations: input.recommendations, change_reason: input.changeReason, tags: input.tags, steps: input.steps, servings: input.servings,
          prep_time_minutes: input.prepTimeMinutes, image_file_id: imageId,
          ingredients: input.ingredients.map((i) => ({ food_kind: i.food.kind, food_id: i.food.id, quantity: i.quantity, unit: i.unit })),
        };
        return input.id ? this.remote.newVersion(input.id, body) : this.remote.create(body);
      }),
      switchMap((id) => this.remote.load(id).pipe(map(() => id))),
    );
  }

  private saveLocal(input: DishInput): string {
    const id = input.id ?? uid('d-');
    const editionId = this.data.activeEdition().id;
    this.data.mutate((d) => {
      let dish = d.dishes.find((x) => x.id === id);
      const isNew = !dish;
      if (!dish) {
        dish = { id, name: '', category: '', tags: [], status: 'active', currentVersion: 0, versions: [], createdAt: new Date().toISOString() };
        d.dishes.push(dish);
      }
      dish.name = input.name.trim();
      dish.category = input.category;
      dish.tags = input.tags;
      const n = dish.versions.length + 1;
      const prev = dish.versions.find((v) => v.versionNumber === dish!.currentVersion);
      dish.versions.push({
        id: `${id}-v${n}`, versionNumber: n, description: input.description, recipeMode: input.recipeMode,
        instructionsText: input.instructionsText, steps: input.steps, servings: input.servings, prepTimeMinutes: input.prepTimeMinutes,
        ingredients: input.ingredients, recommendations: input.recommendations,
        image: input.imageDataUrl ? { dataUrl: input.imageDataUrl, alt: input.imageAlt || input.name } : prev?.image,
        nutrition: calcDish(input.ingredients, input.servings, editionId),
        substitutions: prev?.substitutions ? structuredClone(prev.substitutions) : [],
        changeReason: isNew ? 'Versión inicial' : input.changeReason, createdBy: this.data.actor(), createdAt: new Date().toISOString(),
      });
      dish.currentVersion = n;
      this.data.audit(d, isNew ? 'dish.create' : 'dish.version', 'dish', id, `${isNew ? 'Creó' : 'Nueva versión v' + n + ' de'} "${dish.name}"`);
    });
    return id;
  }

  duplicate(id: string): Observable<string> {
    if (this.apiMode) return this.remote.duplicate(id).pipe(switchMap((copy) => this.remote.load(copy).pipe(map(() => copy))));
    return of(this.duplicateLocal(id));
  }

  private duplicateLocal(id: string): string {
    const src = this.get(id);
    if (!src) return id;
    const copy = uid('d-');
    this.data.mutate((d) => {
      const cur = this.current(src);
      d.dishes.push({
        id: copy, name: `Copia de ${src.name}`, category: src.category, tags: [...src.tags], status: 'active', currentVersion: 1, createdAt: new Date().toISOString(),
        versions: [{ ...structuredClone(cur), id: `${copy}-v1`, versionNumber: 1, substitutions: [], changeReason: `Duplicado de "${src.name}"`, createdBy: this.data.actor(), createdAt: new Date().toISOString() }],
      });
      this.data.audit(d, 'dish.duplicate', 'dish', copy, `Duplicó "${src.name}"`);
    });
    return copy;
  }

  setActive(id: string, active: boolean): Observable<void> {
    if (this.apiMode) return this.remote.setActive(id, active).pipe(switchMap(() => this.remote.load(id)));
    this.setActiveLocal(id, active);
    return of(void 0);
  }

  private setActiveLocal(id: string, active: boolean): void {
    this.data.mutate((d) => {
      const dish = d.dishes.find((x) => x.id === id);
      if (!dish) return;
      dish.status = active ? 'active' : 'inactive';
      this.data.audit(d, active ? 'dish.activate' : 'dish.deactivate', 'dish', id, `${active ? 'Activó' : 'Desactivó'} "${dish.name}"`);
    });
  }

  /** Modo API: planes no archivados que usan el platillo. */
  usage(dishId: string): Observable<number> {
    return this.apiMode ? this.remote.usage(dishId) : of(this.usedInPlans(dishId));
  }

  /** ¿Se usa en planes que no estén archivados? Sirve para advertir antes de desactivar. */
  usedInPlans(dishId: string): number {
    return this.data.db().plans.filter((p) => !p.deletedAt && p.status !== 'archived' && p.days.some((day) => day.slots.some((s) => s.items.some((i) => i.dishId === dishId)))).length;
  }

  // ---------- Sustituciones (§8, §30.8) ----------
  /** Sugerencias automáticas por energía y categoría; la nutrióloga revisa y autoriza. */
  candidatesFor(dishId: string, patient?: Patient): Observable<SubstituteCandidate[]> {
    if (!this.apiMode) return of(this.candidates(dishId, patient));
    return this.remote.candidates(dishId, patient?.id).pipe(
      map((l) =>
        l.map((c): SubstituteCandidate => {
          const dish = this.data.dish(c.dish_id) ?? ({ id: c.dish_id, name: c.name, category: '', tags: [], status: 'active', currentVersion: c.version, versions: [], createdAt: '' } as Dish);
          return {
            dish, version: { versionNumber: c.version } as DishVersion, diff: { energy: c.diff.energy_kcal, protein: c.diff.protein_g, carbs: c.diff.carbohydrates_g, lipids: c.diff.lipids_g, fiber: c.diff.fiber_g },
            sameEquivalents: c.same_equivalents, conflicts: c.conflicts ?? [], reason: c.reason,
          };
        }),
      ),
    );
  }

  candidates(dishId: string, patient?: Patient): SubstituteCandidate[] {
    const src = this.get(dishId);
    if (!src) return [];
    const base = this.current(src);
    const e0 = dec(base.nutrition.perServing.energy);
    return this.data.db().dishes
      .filter((d) => d.id !== dishId && d.status === 'active' && !d.deletedAt)
      .map((dish) => {
        const v = this.current(dish);
        const conflicts: string[] = [];
        if (patient) {
          const words = [dish.name, ...dish.tags, ...v.ingredients.map((i) => i.nameSnapshot)].map(normalizeText);
          for (const a of patient.allergies.filter((x) => x.status === 'active')) {
            const hit = [a.allergen, ...a.aliases].map(normalizeText).find((t) => t.length > 2 && words.some((w) => w.includes(t)));
            if (hit) conflicts.push(`Alergia: ${a.allergen}`);
          }
          for (const p of patient.preferences.filter((x) => x.type === 'avoid' || x.type === 'restriction')) {
            const t = normalizeText(p.foodName);
            if (t.length > 2 && words.some((w) => w.includes(t))) conflicts.push(`${p.type === 'avoid' ? 'No consume' : 'Restricción'}: ${p.foodName}`);
          }
        }
        const sameCat = dish.category === src.category;
        const diff = diffNutrients(v.nutrition.perServing, base.nutrition.perServing);
        const ratio = e0.isZero() ? 1 : Number(div(dec(diff.energy).abs(), e0).toFixed(3));
        const codes = new Set([...Object.keys(base.nutrition.equivalents), ...Object.keys(v.nutrition.equivalents)]);
        const sameEq = [...codes].every((c) => dec(base.nutrition.equivalents[c] ?? 0).minus(v.nutrition.equivalents[c] ?? 0).abs().lte(0.5));
        return { dish, version: v, diff, conflicts, sameEquivalents: sameEq, ratio, sameCat };
      })
      .filter((c) => c.sameCat && c.ratio <= 0.2)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 8)
      .map(({ ratio, sameCat, ...c }) => ({
        ...c,
        reason: `Misma categoría (${src.category}) y energía dentro de ±${Math.max(5, Math.round(ratio * 100))} %${c.sameEquivalents ? '; mismos equivalentes SMAE' : '; equivalentes distintos, revisa la diferencia'}.`,
        sameCat,
      }) as SubstituteCandidate);
  }

  addSubstitution(dishId: string, version: number, sub: Omit<Substitution, 'id' | 'approvedBy' | 'approvedAt'>): Observable<void> {
    if (this.apiMode) {
      return this.remote.addSubstitution(dishId, version, sub.dishId ?? '', sub.note).pipe(switchMap(() => this.remote.load(dishId, version)));
    }
    this.addSubstitutionLocal(dishId, version, sub);
    return of(void 0);
  }

  private addSubstitutionLocal(dishId: string, version: number, sub: Omit<Substitution, 'id' | 'approvedBy' | 'approvedAt'>): void {
    this.data.mutate((d) => {
      const v = d.dishes.find((x) => x.id === dishId)?.versions.find((x) => x.versionNumber === version);
      if (!v) return;
      v.substitutions.push({ ...sub, id: uid('sub'), approvedBy: this.data.actor(), approvedAt: new Date().toISOString() });
      this.data.audit(d, 'dish.substitution', 'dish', dishId, `Autorizó el sustituto "${sub.label}"`);
    });
  }

  removeSubstitution(dishId: string, version: number, subId: string): Observable<void> {
    if (this.apiMode) return this.remote.removeSubstitution(dishId, subId).pipe(switchMap(() => this.remote.load(dishId, version)));
    this.removeSubstitutionLocal(dishId, version, subId);
    return of(void 0);
  }

  private removeSubstitutionLocal(dishId: string, version: number, subId: string): void {
    this.data.mutate((d) => {
      const v = d.dishes.find((x) => x.id === dishId)?.versions.find((x) => x.versionNumber === version);
      if (v) v.substitutions = v.substitutions.filter((s) => s.id !== subId);
    });
  }
}
