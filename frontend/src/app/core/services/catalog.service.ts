import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, of, switchMap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { CatalogApi, CustomFoodBody, toNutrients } from '../api/catalog-api';
import { DbService } from '../data/db.service';
import { CustomFood, CustomFoodSource, Dish, DishVersion, Ingredient, NutritionSnapshot, SmaeEdition } from '../../shared/models/domain';
import { FoodView, calcDish, calcIngredient, diffNutrients, fromSmae } from '../nutrition/engine';
import { Nutrients } from '../../shared/models/domain';
import { normalizeText, uid } from '../../shared/utils/format';

export interface FoodQuery {
  search: string;
  groupId: string;
  source: 'all' | 'smae' | 'custom';
  limit: number;
}

export interface RecalcRow {
  dish: Dish;
  fromVersion: DishVersion;
  newIngredients: Omit<Ingredient, 'id'>[];
  after: NutritionSnapshot;
  diff: Nutrients;
  changedFoods: string[];
  /** Modo API: motivo por el que no se puede autorizar (p. ej. el alimento ya no existe en la edición nueva). */
  blocked?: string;
}

export interface CustomFoodInput {
  id?: string;
  name: string;
  brand?: string;
  description: string;
  baseQuantity: string;
  energy: string;
  protein: string;
  carbs: string;
  lipids: string;
  fiber: string;
  sourceType: CustomFoodSource;
  sourceReference: string;
  pieceName?: string;
  pieceGrams?: string;
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly data = inject(DbService);
  private readonly remote = inject(CatalogApi);
  readonly apiMode = inject(ApiClient).enabled;
  private readonly impactRows = signal<RecalcRow[]>([]);
  private readonly batches = signal<Record<string, { decisions: { decision: string }[]; decidedBy?: string; decidedAt?: string }>>({});

  /** Modo API: carga el catálogo (taxonomía, alimentos SMAE y personalizados) desde el servidor. */
  hydrate(): Observable<void> {
    return this.apiMode ? this.remote.hydrate() : of(void 0);
  }

  /** Carga progresiva (§20.2): el cliente pide más aumentando `limit`. */
  foods(q: FoodQuery): Observable<{ items: FoodView[]; total: number }> {
    return this.data.respond(() => {
      const term = normalizeText(q.search);
      const gid = q.groupId;
      const subCodes = gid ? new Set(this.data.activeSubgroups().filter((s) => this.data.activeGroups().find((g) => g.id === gid)?.id === s.groupId).map((s) => s.code)) : null;
      const matches = this.data.activeFoods().filter((f) => {
        if (q.source === 'smae' && !f.official) return false;
        if (q.source === 'custom' && f.official) return false;
        if (subCodes && !(f.equivalence && subCodes.has(f.equivalence.subgroupCode))) return false;
        return !term || normalizeText(`${f.name} ${f.tags.join(' ')}`).includes(term);
      });
      return { items: matches.slice(0, q.limit), total: matches.length };
    }, 180);
  }

  // ---------- Alimentos personalizados (§30.3) ----------
  saveCustomFood(input: CustomFoodInput): Observable<string> {
    if (!this.apiMode) return of(this.saveCustomLocal(input));
    const existing = input.id ? this.data.db().customFoods.find((f) => f.id === input.id) : undefined;
    const body: CustomFoodBody = {
      name: input.name.trim(), brand: input.brand?.trim() || undefined, description: input.description, basis_quantity: input.baseQuantity, basis_unit: 'g',
      energy_kcal: input.energy, protein_g: input.protein, carbohydrates_g: input.carbs, lipids_g: input.lipids, fiber_g: input.fiber || '0',
      source_type: input.sourceType, source_reference: input.sourceReference, tags: existing?.tags ?? [],
      portions: input.pieceName && input.pieceGrams ? [{ name: input.pieceName, unit: 'pieza', quantity: '1', grams_equivalent: input.pieceGrams }] : (existing?.portions ?? []).map((p) => ({ name: p.name, unit: p.unit, quantity: p.quantity, grams_equivalent: p.gramsEquivalent })),
    };
    return this.remote.saveCustom(input.id, body).pipe(switchMap((id) => this.remote.refreshCustom().pipe(map(() => id))));
  }

  private saveCustomLocal(input: CustomFoodInput): string {
    const id = input.id ?? uid('cf-');
    this.data.mutate((d) => {
      const existing = d.customFoods.find((f) => f.id === id);
      const portions = input.pieceName && input.pieceGrams
        ? [{ id: uid('cfp'), name: input.pieceName, quantity: '1', unit: 'pieza', gramsEquivalent: input.pieceGrams, isReference: true }]
        : existing?.portions ?? [];
      const food: CustomFood = {
        id, name: input.name.trim(), brand: input.brand?.trim() || undefined, description: input.description,
        portions,
        profile: { basisQuantity: input.baseQuantity, basisUnit: 'g', energy: input.energy, protein: input.protein, carbs: input.carbs, lipids: input.lipids, fiber: input.fiber || '0' },
        sourceType: input.sourceType, sourceReference: input.sourceReference,
        createdBy: existing?.createdBy ?? this.data.actor(), status: existing?.status ?? 'active', tags: existing?.tags ?? [],
        // Editar los valores invalida la validación previa.
        validatedBy: undefined, validatedAt: undefined, equivalence: existing?.equivalence, createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      if (existing) Object.assign(existing, food);
      else d.customFoods.push(food);
      this.data.audit(d, existing ? 'custom_food.update' : 'custom_food.create', 'custom_food', id, `${existing ? 'Actualizó' : 'Creó'} el alimento personalizado "${food.name}"`);
    });
    return id;
  }

  validateCustomFood(id: string): Observable<void> {
    if (this.apiMode) return this.remote.validateCustom(id).pipe(switchMap(() => this.remote.refreshCustom()));
    this.validateLocal(id);
    return of(void 0);
  }

  private validateLocal(id: string): void {
    this.data.mutate((d) => {
      const f = d.customFoods.find((x) => x.id === id);
      if (!f) return;
      f.validatedBy = this.data.actor();
      f.validatedAt = new Date().toISOString();
      this.data.audit(d, 'custom_food.validate', 'custom_food', id, `Validó "${f.name}"`);
    });
  }

  assignEquivalence(id: string, subgroupCode: string, referenceGrams: string, criterion: string): Observable<void> {
    if (this.apiMode) return this.remote.assignEquivalence(id, subgroupCode, referenceGrams, criterion).pipe(switchMap(() => this.remote.refreshCustom()));
    this.assignLocal(id, subgroupCode, referenceGrams, criterion);
    return of(void 0);
  }

  private assignLocal(id: string, subgroupCode: string, referenceGrams: string, criterion: string): void {
    this.data.mutate((d) => {
      const f = d.customFoods.find((x) => x.id === id);
      if (!f) return;
      f.equivalence = { subgroupCode, referenceGrams, equivalentValue: '1', assignedBy: this.data.actor(), assignedAt: new Date().toISOString(), criterion };
      this.data.audit(d, 'custom_food.equivalence', 'custom_food', id, `Asignó equivalencia ${subgroupCode} a "${f.name}"`);
    });
  }

  setCustomActive(id: string, active: boolean): Observable<void> {
    if (this.apiMode) return this.remote.setCustomActive(id, active).pipe(switchMap(() => this.remote.refreshCustom()));
    this.setActiveLocal(id, active);
    return of(void 0);
  }

  private setActiveLocal(id: string, active: boolean): void {
    this.data.mutate((d) => {
      const f = d.customFoods.find((x) => x.id === id);
      if (f) f.status = active ? 'active' : 'inactive';
    });
  }

  // ---------- Ediciones y recálculo (§7.4, §30.9) ----------
  editions = (): SmaeEdition[] => this.data.db().editions;

  /** Modo API: pide al servidor el impacto de activar una edición y lo deja disponible para `affectedDishes`. */
  loadImpact(editionId: string): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.remote.impact(editionId).pipe(
      map((rows) => {
        this.impactRows.set(
          rows.map((r): RecalcRow => {
            const stub = (n: ReturnType<typeof toNutrients>) => ({ perServing: n, totals: n, equivalents: {}, hasCustomFoods: false, smaeEditionId: '', engineVersion: '', calculatedAt: '' });
            return {
              dish: { id: r.dish_id, name: r.name, category: '', tags: [], status: 'active', currentVersion: r.from_version, versions: [], createdAt: '' },
              fromVersion: { versionNumber: r.from_version, nutrition: stub(toNutrients(r.before)) } as DishVersion, newIngredients: [], after: stub(toNutrients(r.after)),
              diff: toNutrients(r.diff), changedFoods: r.changed_foods ?? [], blocked: r.blocked,
            };
          }),
        );
      }),
    );
  }

  /** Detecta platillos afectados por una edición nueva y calcula las diferencias. */
  affectedDishes(toEditionId: string): RecalcRow[] {
    if (this.apiMode) return this.impactRows();
    const d = this.data.db();
    const target = d.foods.filter((f) => f.editionId === toEditionId);
    const byCode = new Map(target.map((f) => [f.code, f]));
    const rows: RecalcRow[] = [];
    for (const dish of d.dishes) {
      if (dish.deletedAt) continue;
      const cur = dish.versions.find((v) => v.versionNumber === dish.currentVersion);
      if (!cur || cur.nutrition.smaeEditionId === toEditionId) continue;
      const changedFoods: string[] = [];
      const fresh = cur.ingredients.map((ing): Omit<Ingredient, 'id'> => {
        if (ing.food.kind !== 'smae') return { ...ing };
        const old = d.foods.find((f) => f.id === ing.food.id);
        const next = old ? byCode.get(old.code) : undefined;
        if (!next || !old) return { ...ing };
        const view: FoodView = fromSmae(next);
        const recalculated = calcIngredient(view, ing.quantity, ing.unit);
        if (JSON.stringify(old.profile) !== JSON.stringify(next.profile)) changedFoods.push(old.name);
        return recalculated;
      });
      if (!changedFoods.length) continue;
      const after = calcDish(fresh, cur.servings, toEditionId);
      rows.push({ dish, fromVersion: cur, newIngredients: fresh, after, diff: diffNutrients(after.perServing, cur.nutrition.perServing), changedFoods });
    }
    return rows;
  }

  /** Aplica las decisiones: cada autorización crea una versión NUEVA e inmutable (§7.4). */
  applyRecalc(toEditionId: string, decisions: { dishId: string; authorize: boolean }[]): Observable<void> {
    if (this.apiMode) {
      return this.remote.recalc(toEditionId, decisions).pipe(
        map(() => this.batches.update((b) => ({ ...b, [toEditionId]: { decisions: decisions.map((x) => ({ decision: x.authorize ? 'authorized' : 'rejected' })), decidedBy: 'Tú', decidedAt: new Date().toISOString() } }))),
        map(() => void 0),
      );
    }
    this.applyLocal(toEditionId, decisions);
    return of(void 0);
  }

  private applyLocal(toEditionId: string, decisions: { dishId: string; authorize: boolean }[]): void {
    const rows = this.affectedDishes(toEditionId);
    const fromEdition = this.data.activeEdition().id;
    this.data.mutate((d) => {
      const batch = {
        id: uid('rb'), fromEditionId: fromEdition, toEditionId, createdAt: new Date().toISOString(), status: 'completed' as const,
        decisions: [] as { dishId: string; fromVersion: number; toVersion?: number; decision: 'authorized' | 'rejected' }[],
        decidedBy: this.data.actor(), decidedAt: new Date().toISOString(),
      };
      for (const dec of decisions) {
        const row = rows.find((r) => r.dish.id === dec.dishId);
        const dish = d.dishes.find((x) => x.id === dec.dishId);
        if (!row || !dish) continue;
        if (!dec.authorize) {
          batch.decisions.push({ dishId: dish.id, fromVersion: row.fromVersion.versionNumber, decision: 'rejected' });
          continue;
        }
        const next = dish.versions.length + 1;
        const nv: DishVersion = {
          ...structuredClone(row.fromVersion),
          id: `${dish.id}-v${next}`, versionNumber: next,
          ingredients: row.newIngredients.map((i, idx) => ({ ...i, id: `${dish.id}-v${next}-i${idx}` })),
          nutrition: row.after, substitutions: structuredClone(row.fromVersion.substitutions),
          changeReason: `Recalculado con ${d.editions.find((e) => e.id === toEditionId)?.name ?? 'nueva edición SMAE'}`,
          createdBy: this.data.actor(), createdAt: new Date().toISOString(),
        };
        dish.versions.push(nv);
        dish.currentVersion = next;
        batch.decisions.push({ dishId: dish.id, fromVersion: row.fromVersion.versionNumber, toVersion: next, decision: 'authorized' });
      }
      d.recalcBatches.push(batch);
      this.data.audit(d, 'smae.recalc', 'smae_edition', toEditionId, `Autorizó ${batch.decisions.filter((x) => x.decision === 'authorized').length} y rechazó ${batch.decisions.filter((x) => x.decision === 'rejected').length} recálculos`);
    });
  }

  batchFor = (toEditionId: string) => (this.apiMode ? this.batches()[toEditionId] : this.data.db().recalcBatches.find((b) => b.toEditionId === toEditionId));

  /** La edición anterior se conserva archivada para reproducir planes históricos. */
  activateEdition(id: string): Observable<void> {
    if (this.apiMode) return this.remote.activate(id).pipe(switchMap(() => this.remote.hydrate(true)));
    this.activateLocal(id);
    return of(void 0);
  }

  private activateLocal(id: string): void {
    this.data.mutate((d) => {
      for (const e of d.editions) {
        if (e.status === 'active') e.status = 'archived';
      }
      const next = d.editions.find((e) => e.id === id);
      if (next) next.status = 'active';
      this.data.audit(d, 'smae.activate', 'smae_edition', id, `Activó la edición "${next?.name}"`);
    });
  }
}
