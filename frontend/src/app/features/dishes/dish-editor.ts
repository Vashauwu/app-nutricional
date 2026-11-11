import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { DISH_CATEGORIES, DishesService } from '../../core/services/dishes.service';
import { ToastService } from '../../core/services/ui.services';
import { HasUnsavedChanges } from '../../core/guards/unsaved.guard';
import { EngineError, FoodView, availableUnits, calcDish, calcIngredient } from '../../core/nutrition/engine';
import { Ingredient, NutritionSnapshot, RecipeMode } from '../../shared/models/domain';
import { FieldError, positiveDecimalValidator } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { Badge } from '../../shared/components/ui';
import { EqChips, Macros } from '../../shared/components/nutrition-bits';
import { processImage } from '../../shared/utils/image';
import { fmt, fmtCompact, uid } from '../../shared/utils/format';
import { FoodPicker } from './food-picker';

@Component({
  selector: 'app-dish-editor',
  imports: [ReactiveFormsModule, RouterLink, TuiButton, Icon, Badge, FieldError, FoodPicker, Macros, EqChips],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .layout { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr) 21rem; align-items: start; }
    @media (max-width: 70rem) { .layout { grid-template-columns: minmax(0, 1fr); } }
    aside { position: sticky; inset-block-start: 4.75rem; display: grid; gap: var(--space-3); }
    @media (max-width: 70rem) { aside { position: static; } }
    .seg { display: inline-flex; border: 1px solid var(--line); border-radius: var(--radius-s); overflow: hidden; }
    .seg button { min-block-size: var(--tap); padding: 0 var(--space-4); border: 0; background: var(--surface); font: inherit; cursor: pointer; }
    .seg button[aria-pressed='true'] { background: var(--brand-primary); color: var(--nutri-marfil); }
    .add { display: grid; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-m); background: var(--nutri-marfil); border: 1px dashed var(--line); }
    .qty { display: grid; grid-template-columns: 7rem minmax(8rem, 1fr) auto; gap: var(--space-2); align-items: end; }
    .ing-row { display: grid; grid-template-columns: minmax(0, 1fr) 6rem 9rem auto; gap: var(--space-2); align-items: center; padding: var(--space-3) 0; border-block-end: 1px solid var(--line); }
    @media (max-width: 40rem) { .ing-row { grid-template-columns: 1fr 1fr; } .ing-row .nm { grid-column: 1 / -1; } }
    .step { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; gap: var(--space-2); align-items: start; }
    .step .n { display: grid; place-items: center; inline-size: 2rem; block-size: 2rem; margin-block-start: .35rem; border-radius: 50%; background: var(--nutri-lavanda); font-weight: 600; }
    .photo { display: grid; place-items: center; min-block-size: 8rem; border: 1px dashed var(--line); border-radius: var(--radius-m); overflow: hidden; background: var(--nutri-marfil); }
    .photo img { inline-size: 100%; max-block-size: 14rem; object-fit: cover; }
    dl.tot { display: grid; grid-template-columns: 1fr auto; gap: .25rem var(--space-3); margin: 0; font-variant-numeric: tabular-nums; } dl.tot dd { margin: 0; text-align: end; font-weight: 600; }
  `,
  template: `
    <div class="page">
      <nav class="breadcrumb" aria-label="Migas de pan"><a routerLink="/platillos">Platillos</a><app-icon name="chevron-right" [size]="14" /><span aria-current="page">{{ isEdit() ? 'Editar' : 'Nuevo platillo' }}</span></nav>
      <header class="page-header">
        <div><h1>{{ isEdit() ? 'Editar platillo' : 'Nuevo platillo' }}</h1>
          @if (isEdit()) { <p class="sub">Estás editando la <strong>versión {{ baseVersion() }}</strong>. Al guardar se crea la versión {{ baseVersion() + 1 }}; las anteriores no cambian y los planes ya publicados conservan la suya.</p> }
          @else { <p class="sub">Define ingredientes y cantidades; la energía, macros y equivalentes SMAE se calculan automáticamente.</p> }
        </div>
      </header>

      <form [formGroup]="form" (ngSubmit)="save()" novalidate class="layout">
        <div class="stack">
          <section class="panel" aria-labelledby="h-gen">
            <h2 id="h-gen" class="panel-head">Información general</h2>
            <div class="form-grid">
              <div class="field" style="grid-column: 1 / -1"><label for="dn">Nombre del platillo</label><input id="dn" class="input" formControlName="name" maxlength="120" aria-describedby="dn-e" /><app-field-error id="dn-e" [control]="form.controls.name" /></div>
              <div class="field"><label for="dc">Categoría</label><select id="dc" class="select" formControlName="category">@for (c of categories; track c) { <option [value]="c">{{ c }}</option> }</select></div>
              <div class="field"><label for="dsv">Porciones que rinde</label><input id="dsv" class="input" inputmode="decimal" formControlName="servings" aria-describedby="dsv-e" /><app-field-error id="dsv-e" [control]="form.controls.servings" /></div>
              <div class="field"><label for="dpt">Tiempo de preparación (min)</label><input id="dpt" class="input" type="number" min="0" formControlName="prepTimeMinutes" /></div>
              <div class="field"><label for="dtg">Etiquetas</label><input id="dtg" class="input" formControlName="tags" aria-describedby="dtg-h" /><span class="hint" id="dtg-h">Separadas por comas. Ayudan a detectar alérgenos en las alertas.</span></div>
            </div>
            <div class="field"><label for="dd">Descripción</label><textarea id="dd" class="textarea" formControlName="description"></textarea></div>
            <div class="field">
              <span class="label">Fotografía (opcional)</span>
              <div class="photo">@if (image()) { <img [src]="image()" [alt]="form.controls.imageAlt.value || form.controls.name.value" /> } @else { <span class="muted small">JPG, PNG o WebP. Se optimiza a 1920×1080 y WebP.</span> }</div>
              <div class="row"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" class="input" style="max-inline-size: 22rem" aria-label="Elegir fotografía" (change)="onImage($event)" />@if (image()) { <button tuiButton type="button" size="s" appearance="secondary" (click)="image.set(undefined)">Quitar</button> }</div>
              @if (imageError()) { <p class="error" role="alert">{{ imageError() }}</p> }
              @if (image()) { <div class="field"><label for="dia">Texto alternativo de la foto</label><input id="dia" class="input" formControlName="imageAlt" /></div> }
            </div>
          </section>

          <section class="panel" aria-labelledby="h-ing">
            <h2 id="h-ing" class="panel-head">Ingredientes y cantidades</h2>
            <p class="small muted">Los cálculos se derivan de estos datos. Elige un alimento del catálogo SMAE o uno personalizado.</p>
            <app-food-picker label="Agregar ingrediente" (picked)="startAdd($event)" />
            @if (draft(); as d) {
              <div class="add" role="group" [attr.aria-label]="'Cantidad de ' + d.food.name">
                <div><strong>{{ d.food.name }}</strong> @if (!d.food.official) { <app-badge tone="warn" icon="alert">Personalizado</app-badge> }</div>
                <div class="qty">
                  <div class="field"><label for="aq">Cantidad</label><input id="aq" class="input" inputmode="decimal" [value]="d.qty" (input)="updateDraft({ qty: $any($event.target).value })" /></div>
                  <div class="field"><label for="au">Unidad</label><select id="au" class="select" [value]="d.unit" (change)="updateDraft({ unit: $any($event.target).value })">@for (u of unitsOf(d.food); track u.unit) { <option [value]="u.unit" [selected]="u.unit === d.unit">{{ u.label }}</option> }</select></div>
                  <div class="row"><button tuiButton type="button" size="m" [disabled]="!!draftPreview().error" (click)="commitDraft()">Agregar</button><button tuiButton type="button" size="m" appearance="flat" (click)="draft.set(null)">Cancelar</button></div>
                </div>
                @if (draftPreview().error) { <p class="error" role="alert">{{ draftPreview().error }}</p> }
                @else if (draftPreview().ing; as pv) { <p class="small" aria-live="polite">= {{ fmtC(pv.grams, 1) }} g · <app-macros [n]="pv.nutrients" /></p> }
              </div>
            }
            <div role="list" aria-label="Ingredientes del platillo">
              @for (ing of ingredients(); track ing.id; let i = $index) {
                <div class="ing-row" role="listitem">
                  <div class="nm"><strong>{{ ing.nameSnapshot }}</strong> @if (!ing.official) { <app-badge tone="warn">Personalizado</app-badge> }<div class="small muted">{{ fmtC(ing.grams, 1) }} g · {{ fmtC(ing.nutrients.energy) }} kcal@if (ing.equivalent) { · {{ fmtC(ing.equivalent.value, 2) }} eq. {{ ing.equivalent.subgroupCode }} }</div></div>
                  <div class="field"><label class="visually-hidden" [for]="'iq' + i">Cantidad de {{ ing.nameSnapshot }}</label><input [id]="'iq' + i" class="input" inputmode="decimal" [value]="ing.quantity" (change)="editIng(i, { qty: $any($event.target).value })" /></div>
                  <div class="field"><label class="visually-hidden" [for]="'iu' + i">Unidad de {{ ing.nameSnapshot }}</label><select [id]="'iu' + i" class="select" (change)="editIng(i, { unit: $any($event.target).value })">@for (u of unitsFor(ing); track u.unit) { <option [value]="u.unit" [selected]="u.unit === ing.unit">{{ u.label }}</option> }</select></div>
                  <button type="button" class="icon-btn" [attr.aria-label]="'Quitar ' + ing.nameSnapshot" (click)="removeIng(i)"><app-icon name="trash" /></button>
                </div>
              } @empty { <p class="muted" style="padding-block: var(--space-4)">Aún no hay ingredientes. Sin ellos no se calcula el valor nutricional.</p> }
            </div>
            @if (ingError()) { <p class="error" role="alert">{{ ingError() }}</p> }
          </section>

          <section class="panel" aria-labelledby="h-rec">
            <div class="panel-head"><h2 id="h-rec">Preparación</h2>
              <div class="seg" role="group" aria-label="Modalidad de receta"><button type="button" [attr.aria-pressed]="mode() === 'structured'" (click)="setMode('structured')">Receta estructurada</button><button type="button" [attr.aria-pressed]="mode() === 'free'" (click)="setMode('free')">Texto libre</button></div></div>
            @if (mode() === 'structured') {
              <ol class="list-plain" style="gap: var(--space-2)">
                @for (s of steps(); track $index; let i = $index) {
                  <li class="step"><span class="n" aria-hidden="true">{{ i + 1 }}</span>
                    <div class="field"><label [for]="'st' + i" class="visually-hidden">Paso {{ i + 1 }}</label><textarea [id]="'st' + i" class="textarea" style="min-block-size: 3rem" [value]="s" (input)="setStep(i, $any($event.target).value)"></textarea></div>
                    <div class="row" style="gap: 0"><button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Subir paso ' + (i + 1)" [disabled]="i === 0" (click)="moveStep(i, -1)"><app-icon name="chevron-up" [size]="18" /></button><button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Bajar paso ' + (i + 1)" [disabled]="i === steps().length - 1" (click)="moveStep(i, 1)"><app-icon name="chevron-down" [size]="18" /></button><button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Quitar paso ' + (i + 1)" (click)="removeStep(i)"><app-icon name="x" [size]="18" /></button></div></li>
                }
              </ol>
              <div><button tuiButton type="button" size="s" appearance="secondary" (click)="addStep()"><app-icon name="plus" [size]="16" /> Agregar paso</button></div>
            } @else {
              <div class="field"><label for="dtx">Instrucciones</label><textarea id="dtx" class="textarea" style="min-block-size: 10rem" formControlName="instructionsText"></textarea></div>
            }
            <div class="field"><label for="drc">Recomendaciones y observaciones</label><textarea id="drc" class="textarea" formControlName="recommendations"></textarea></div>
          </section>

          @if (isEdit()) {
            <section class="panel" aria-labelledby="h-why">
              <h2 id="h-why" class="panel-head">Motivo del cambio</h2>
              <div class="field"><label for="dwhy">¿Qué cambió y por qué?</label><input id="dwhy" class="input" formControlName="changeReason" aria-describedby="dwhy-e" /><app-field-error id="dwhy-e" [control]="form.controls.changeReason" /></div>
            </section>
          }
        </div>

        <aside aria-label="Resumen nutricional">
          <section class="panel" aria-live="polite">
            <h2 class="panel-head" style="font-size: 1.0625rem">Por porción</h2>
            @if (nutrition(); as n) {
              <dl class="tot"><dt>Energía</dt><dd>{{ f(n.perServing.energy) }} kcal</dd><dt>Proteínas</dt><dd>{{ f(n.perServing.protein) }} g</dd><dt>Carbohidratos</dt><dd>{{ f(n.perServing.carbs) }} g</dd><dt>Lípidos</dt><dd>{{ f(n.perServing.lipids) }} g</dd><dt>Fibra</dt><dd>{{ f(n.perServing.fiber) }} g</dd></dl>
              <div class="eyebrow">Equivalentes SMAE por porción</div>
              <app-eq-chips [eq]="n.equivalents" />
              <hr style="border: 0; border-block-start: 1px solid var(--line); inline-size: 100%" />
              <p class="small muted">Total de la receta: {{ f(n.totals.energy) }} kcal · P {{ f(n.totals.protein, 1) }} · C {{ f(n.totals.carbs, 1) }} · L {{ f(n.totals.lipids, 1) }}</p>
              <p class="small muted">Edición SMAE: {{ editionName() }} · motor {{ n.engineVersion }}. Los valores se muestran con 2 decimales; el dato almacenado no se redondea.</p>
              @if (n.hasCustomFoods) { <div class="callout callout--warn"><app-icon name="alert" /><div class="callout-body">Incluye alimentos personalizados (no oficiales). Revisa su fuente en el catálogo.</div></div> }
            } @else { <p class="muted">Agrega ingredientes y un número de porciones válido para ver el cálculo.</p> }
          </section>
          <div class="form-actions" style="justify-content: stretch">
            <a tuiButton appearance="secondary" size="m" [routerLink]="isEdit() ? ['/platillos', id()] : ['/platillos']">Cancelar</a>
            <button tuiButton type="submit" size="m">{{ isEdit() ? 'Guardar como versión ' + (baseVersion() + 1) : 'Crear platillo' }}</button>
          </div>
        </aside>
      </form>
    </div>
  `,
})
export class DishEditor implements OnInit, HasUnsavedChanges {
  private readonly dishes = inject(DishesService);
  private readonly data = inject(DbService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly id = input<string>();
  protected readonly isEdit = computed(() => !!this.id());
  protected readonly baseVersion = signal(0);
  protected readonly categories = [...new Set([...DISH_CATEGORIES, ...this.dishes.categories()])];
  protected readonly mode = signal<RecipeMode>('structured');
  protected readonly ingredients = signal<Ingredient[]>([]);
  protected readonly steps = signal<string[]>(['']);
  protected readonly image = signal<string | undefined>(undefined);
  protected readonly imageError = signal('');
  protected readonly ingError = signal('');
  protected readonly draft = signal<{ food: FoodView; qty: string; unit: string } | null>(null);
  private readonly dirty = signal(false);
  private saved = false;

  protected readonly fmtC = fmtCompact;
  protected readonly f = (v: string, p = 2): string => fmt(v, p);
  protected readonly editionName = computed(() => this.data.activeEdition().name);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    category: ['Comida'],
    servings: ['1', [Validators.required, positiveDecimalValidator]],
    prepTimeMinutes: [15],
    tags: [''],
    description: [''],
    instructionsText: [''],
    recommendations: [''],
    imageAlt: [''],
    changeReason: [''],
  });
  private readonly servings = signal('1');

  protected readonly nutrition = computed<NutritionSnapshot | null>(() => {
    const ing = this.ingredients();
    if (!ing.length || !/^\d+(\.\d+)?$/.test(this.servings()) || Number(this.servings()) <= 0) return null;
    try { return calcDish(ing, this.servings(), this.data.activeEdition().id); } catch { return null; }
  });

  protected readonly draftPreview = computed<{ ing?: Omit<Ingredient, 'id'>; error?: string }>(() => {
    const d = this.draft();
    if (!d) return {};
    if (!/^\d+(\.\d+)?$/.test(d.qty.trim()) || Number(d.qty) <= 0) return { error: 'Escribe una cantidad mayor a cero (usa punto decimal).' };
    try { return { ing: calcIngredient(d.food, d.qty.trim(), d.unit) }; } catch (e) { return { error: e instanceof EngineError ? e.message : 'No se pudo calcular.' }; }
  });

  constructor() {
    this.form.valueChanges.subscribe((v) => { this.dirty.set(true); this.servings.set(v.servings ?? '1'); });
  }

  ngOnInit(): void {
    const id = this.id();
    if (!id) return;
    // Modo API: se pide la versión completa antes de llenar el formulario.
    this.dishes.load(id).subscribe({ next: () => this.populate(id), error: () => void this.router.navigate(['/platillos']) });
  }

  private populate(id: string): void {
    const dish = this.dishes.get(id);
    if (!dish) { void this.router.navigate(['/platillos']); return; }
    const v = this.dishes.current(dish);
    this.baseVersion.set(v.versionNumber);
    this.mode.set(v.recipeMode);
    this.form.patchValue({ name: dish.name, category: dish.category, servings: v.servings, prepTimeMinutes: v.prepTimeMinutes, tags: dish.tags.join(', '), description: v.description, instructionsText: v.instructionsText, recommendations: v.recommendations, imageAlt: v.image?.alt ?? '' });
    this.form.controls.changeReason.addValidators(Validators.required);
    this.form.controls.changeReason.updateValueAndValidity();
    this.ingredients.set(structuredClone(v.ingredients));
    this.steps.set(v.steps.length ? [...v.steps] : ['']);
    this.image.set(v.image?.dataUrl);
    this.servings.set(v.servings);
    this.dirty.set(false);
  }

  hasUnsavedChanges(): boolean { return this.dirty() && !this.saved; }

  @HostListener('window:beforeunload', ['$event'])
  protected warn(e: BeforeUnloadEvent): void { if (this.hasUnsavedChanges()) e.preventDefault(); }

  // ---------- Ingredientes ----------
  protected unitsOf = availableUnits;
  protected unitsFor(ing: Ingredient) {
    const food = this.data.resolveFood(ing.food);
    return food ? availableUnits(food) : [{ unit: ing.unit, label: ing.unit }];
  }

  protected startAdd(food: FoodView): void {
    const portion = food.portions[0];
    this.draft.set({ food, qty: portion ? '1' : '100', unit: portion ? portion.unit : 'g' });
  }

  protected updateDraft(patch: Partial<{ qty: string; unit: string }>): void {
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
  }

  protected commitDraft(): void {
    const pv = this.draftPreview();
    if (!pv.ing) return;
    this.ingredients.update((l) => [...l, { id: uid('i'), ...pv.ing! }]);
    this.draft.set(null);
    this.ingError.set('');
    this.dirty.set(true);
  }

  protected editIng(i: number, patch: { qty?: string; unit?: string }): void {
    const cur = this.ingredients()[i];
    const food = this.data.resolveFood(cur.food);
    if (!food) return;
    const qty = (patch.qty ?? cur.quantity).trim();
    const unit = patch.unit ?? cur.unit;
    try {
      if (!/^\d+(\.\d+)?$/.test(qty) || Number(qty) <= 0) throw new EngineError('La cantidad debe ser un número mayor a cero.');
      const next = { id: cur.id, ...calcIngredient(food, qty, unit) };
      this.ingredients.update((l) => l.map((x, j) => (j === i ? next : x)));
      this.ingError.set('');
    } catch (e) {
      this.ingError.set(e instanceof Error ? e.message : 'No se pudo recalcular.');
      this.ingredients.update((l) => [...l]);
    }
    this.dirty.set(true);
  }

  protected removeIng(i: number): void { this.ingredients.update((l) => l.filter((_, j) => j !== i)); this.dirty.set(true); }

  // ---------- Pasos ----------
  protected setMode(m: RecipeMode): void { this.mode.set(m); this.dirty.set(true); }
  protected addStep(): void { this.steps.update((s) => [...s, '']); this.dirty.set(true); }
  protected setStep(i: number, v: string): void { this.steps.update((s) => s.map((x, j) => (j === i ? v : x))); this.dirty.set(true); }
  protected removeStep(i: number): void { this.steps.update((s) => (s.length > 1 ? s.filter((_, j) => j !== i) : [''])); this.dirty.set(true); }
  protected moveStep(i: number, d: -1 | 1): void {
    this.steps.update((s) => { const a = [...s]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a; });
    this.dirty.set(true);
  }

  protected async onImage(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    this.imageError.set('');
    if (!file) return;
    try {
      const r = await processImage(file, this.data.db().settings.storage.maxImageBytes);
      this.image.set(r.dataUrl);
      this.dirty.set(true);
    } catch (err) {
      this.imageError.set(err instanceof Error ? err.message : 'No se pudo procesar la imagen.');
      input.value = '';
    }
  }

  protected save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) { this.toast.error('Revisa los campos marcados.'); return; }
    if (!this.ingredients().length && this.mode() === 'structured') { this.ingError.set('Agrega al menos un ingrediente para calcular el valor nutricional.'); return; }
    const v = this.form.getRawValue();
    this.dishes.save({
      id: this.id(), name: v.name, category: v.category, tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean),
      description: v.description, recipeMode: this.mode(), instructionsText: v.instructionsText, steps: this.steps().map((s) => s.trim()).filter(Boolean),
      servings: v.servings.trim(), prepTimeMinutes: Number(v.prepTimeMinutes) || 0, ingredients: this.ingredients(), recommendations: v.recommendations,
      imageDataUrl: this.image(), imageAlt: v.imageAlt, changeReason: v.changeReason.trim(),
    }).subscribe({
      next: (id) => {
        this.saved = true;
        this.toast.ok(this.isEdit() ? `Versión ${this.baseVersion() + 1} guardada. Los planes existentes conservan la versión que tenían.` : 'Platillo creado.');
        void this.router.navigate(['/platillos', id]);
      },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }
}
