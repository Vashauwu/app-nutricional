import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { debounceTime, switchMap } from 'rxjs';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { CatalogService, CustomFoodInput } from '../../core/services/catalog.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { FoodView } from '../../core/nutrition/engine';
import { CustomFood } from '../../shared/models/domain';
import { Badge, EmptyState, LoadError, SearchBox, Skeleton } from '../../shared/components/ui';
import { FieldError, decimalValidator, positiveDecimalValidator } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { Macros } from '../../shared/components/nutrition-bits';
import { Loadable, loadable } from '../../shared/utils/loadable';
import { fmtCompact, formatDate, formatDateTime } from '../../shared/utils/format';

type Tab = 'alimentos' | 'personalizados' | 'ediciones';
const STEP = 15;
const SOURCE_LABEL = { label: 'Etiqueta nutrimental', manufacturer: 'Fabricante', analysis: 'Análisis de laboratorio', manual: 'Captura manual', other: 'Otra' } as const;

@Component({
  selector: 'app-catalog',
  imports: [ReactiveFormsModule, TuiButton, Icon, Badge, EmptyState, LoadError, SearchBox, Skeleton, Modal, FieldError, Macros],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .gchips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .decide { display: inline-flex; gap: var(--space-2); }
    .decide label { display: inline-flex; align-items: center; gap: .25rem; min-block-size: 2.25rem; padding: 0 .5rem; cursor: pointer; }
  `,
  template: `
    <div class="page">
      <header class="page-header"><div><h1>Catálogo SMAE</h1><p class="sub">Alimentos, equivalentes y composición. La edición activa es <strong>{{ edition().name }}</strong>.</p></div></header>

      <div class="callout callout--warn"><app-icon name="alert" /><div class="callout-body"><p><strong>Datos de ejemplo.</strong> Este catálogo es sintético y no reproduce material protegido. La carga real depende de una fuente con licencia confirmada (§25.1).</p></div></div>

      <div class="tabs" role="tablist" aria-label="Secciones del catálogo">
        @for (t of tabs; track t.id) { <button type="button" role="tab" [attr.aria-selected]="tab() === t.id" [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="tab.set(t.id)">{{ t.label }}</button> }
      </div>

      @switch (tab()) {
        @case ('alimentos') {
          <section class="panel panel--flush" aria-label="Alimentos del catálogo">
            <div class="panel-head" style="padding: var(--space-4) var(--space-5)">
              <app-search label="Buscar alimentos" placeholder="Buscar alimento o etiqueta" [value]="search()" (valueChange)="search.set($event); limit.set(step)" />
              <div class="field"><label class="visually-hidden" for="src">Origen</label><select id="src" class="select" [value]="source()" (change)="source.set($any($event.target).value); limit.set(step)"><option value="all">Oficiales y personalizados</option><option value="smae">Solo catálogo SMAE</option><option value="custom">Solo personalizados</option></select></div>
            </div>
            <div class="gchips" style="padding: 0 var(--space-5) var(--space-4)" role="group" aria-label="Grupo de alimentos">
              <button type="button" class="chip-toggle" [attr.aria-pressed]="groupId() === ''" (click)="groupId.set(''); limit.set(step)">Todos</button>
              @for (g of groups(); track g.id) { <button type="button" class="chip-toggle" [attr.aria-pressed]="groupId() === g.id" (click)="groupId.set(g.id); limit.set(step)">{{ g.name }}</button> }
            </div>
            @if (foods(); as r) {
              @if (r.state === 'loading' && !prevFoods()) { <app-skeleton [count]="6" /> }
              @else if (r.state === 'error') { <app-load-error [message]="r.message" (retry)="retry.set(retry() + 1)" /> }
              @else if (view(); as v) {
                @if (v.items.length) {
                  <div class="table-wrap"><table class="table"><caption class="visually-hidden">Alimentos</caption><thead><tr><th scope="col">Alimento</th><th scope="col">Grupo / subgrupo</th><th scope="col" class="num">1 equivalente =</th><th scope="col" class="num">Por 100 g</th><th scope="col">Porciones caseras</th><th scope="col">Origen</th></tr></thead><tbody>
                    @for (f of v.items; track f.ref.id) {
                      <tr><td><strong>{{ f.name }}</strong></td><td>@if (f.equivalence) { {{ groupName(f.equivalence.subgroupCode) }} · <span class="small muted">{{ f.equivalence.subgroupCode }}</span> } @else { <span class="muted small">Sin equivalencia SMAE</span> }</td>
                        <td class="num">{{ f.equivalence ? c(f.equivalence.referenceGrams, 0) + ' g' : '—' }}</td>
                        <td class="num"><app-macros [n]="{ energy: f.profile.energy, protein: f.profile.protein, carbs: f.profile.carbs, lipids: f.profile.lipids, fiber: f.profile.fiber }" /></td>
                        <td class="small">@for (p of f.portions; track p.id) { {{ p.name }} ({{ c(p.gramsEquivalent, 0) }} g)@if (!$last) {, } } @empty { — }</td>
                        <td>@if (f.official) { <app-badge tone="info">Catálogo</app-badge> } @else { <app-badge tone="warn" icon="alert">Personalizado</app-badge> }</td></tr>
                    }
                  </tbody></table></div>
                  <p class="small muted" style="padding: var(--space-3) var(--space-5)" aria-live="polite">{{ v.items.length }} de {{ v.total }} alimentos</p>
                  @if (v.items.length < v.total) { <div class="row" style="justify-content: center; padding-block-end: var(--space-4)"><button tuiButton type="button" appearance="secondary" size="m" (click)="limit.set(limit() + step)">Cargar más</button></div> }
                } @else { <app-empty icon="search" title="Sin resultados" text="Prueba con otra búsqueda o grupo." /> }
              }
            }
          </section>
        }
        @case ('personalizados') {
          <section class="panel panel--flush" aria-labelledby="h-cust">
            <div class="panel-head"><h2 id="h-cust">Alimentos personalizados</h2><button tuiButton type="button" size="s" (click)="openFood()"><app-icon name="plus" [size]="16" /> Nuevo alimento</button></div>
            <p class="small muted" style="padding: 0 var(--space-5)">Se identifican como no oficiales en platillos y cálculos. Solo tienen equivalencia SMAE si tú la asignas, y queda registrado quién, cuándo y con qué criterio.</p>
            <ul class="list-plain list-rows">
              @for (f of customs(); track f.id) {
                <li style="align-items: flex-start; flex-wrap: wrap">
                  <div class="grow" style="min-inline-size: 14rem"><strong>{{ f.name }}</strong> @if (f.brand) { <span class="muted">· {{ f.brand }}</span> } @if (f.status === 'inactive') { <app-badge icon="ban">Inactivo</app-badge> }
                    <p class="small muted">{{ f.description }}</p>
                    <p class="small">Fuente: {{ source_[f.sourceType] }} — {{ f.sourceReference }}</p>
                    <app-macros [n]="{ energy: f.profile.energy, protein: f.profile.protein, carbs: f.profile.carbs, lipids: f.profile.lipids, fiber: f.profile.fiber }" /> <span class="small muted">por {{ f.profile.basisQuantity }} {{ f.profile.basisUnit }}</span>
                    <div class="row" style="margin-block-start: var(--space-2)">
                      @if (f.validatedAt) { <app-badge tone="ok" icon="check">Validado por {{ f.validatedBy }} · {{ fd(f.validatedAt) }}</app-badge> } @else { <app-badge tone="warn" icon="clock">Sin validar</app-badge> }
                      @if (f.equivalence; as e) { <app-badge tone="accent">Equivalencia {{ e.subgroupCode }} asignada por {{ e.assignedBy }}</app-badge> } @else { <app-badge>Sin equivalencia SMAE</app-badge> }
                    </div>
                    @if (f.equivalence; as e) { <p class="small muted">Criterio: {{ e.criterion }}</p> }
                  </div>
                  <div class="row">
                    <button tuiButton type="button" size="s" appearance="secondary" (click)="openFood(f)">Editar</button>
                    @if (!f.validatedAt) { <button tuiButton type="button" size="s" appearance="secondary" (click)="validate(f)">Validar</button> }
                    <button tuiButton type="button" size="s" appearance="secondary" (click)="openEq(f)">{{ f.equivalence ? 'Cambiar equivalencia' : 'Asignar equivalencia' }}</button>
                    <button tuiButton type="button" size="s" appearance="flat" (click)="toggleCustom(f)">{{ f.status === 'active' ? 'Desactivar' : 'Activar' }}</button>
                  </div>
                </li>
              } @empty { <li><app-empty icon="leaf" title="Sin alimentos personalizados" text="Agrega productos de etiqueta o recetas propias con valores nutricionales conocidos." /></li> }
            </ul>
          </section>
        }
        @case ('ediciones') {
          <div class="stack">
            @for (e of editions(); track e.id) {
              <section class="panel" [attr.aria-label]="e.name">
                <div class="panel-head"><div><h2 style="font-size: 1.125rem">{{ e.name }}</h2><p class="small muted">{{ e.publisher }} · vigente desde {{ fd(e.effectiveDate) }} · importada {{ fdt(e.importedAt) }}</p></div>
                  <app-badge [tone]="e.status === 'active' ? 'ok' : e.status === 'draft' ? 'warn' : 'neutral'">{{ e.status === 'active' ? 'Activa' : e.status === 'draft' ? 'Borrador' : 'Archivada' }}</app-badge></div>
                <p class="small">Fuente: {{ e.sourceReference }} · Licencia: {{ e.licenseReference }}</p>
                <p class="small muted">{{ e.notes }}</p>
                @if (e.status === 'draft') {
                  <div class="row"><button tuiButton type="button" size="m" (click)="detect(e.id)"><app-icon name="search" [size]="16" /> Detectar platillos afectados</button></div>
                  @if (reviewing() === e.id) {
                    @if (rows().length) {
                      <p><strong>{{ rows().length }} platillo(s) cambiarían.</strong> Ninguno se actualiza sin tu autorización; cada autorización crea una versión nueva e inmutable y los planes existentes conservan la suya.</p>
                      <div class="table-wrap"><table class="table"><caption class="visually-hidden">Comparación de valores anteriores y nuevos</caption><thead><tr><th scope="col">Platillo</th><th scope="col">Alimentos que cambian</th><th scope="col" class="num">kcal antes → después</th><th scope="col" class="num">Δ P / C / L (g)</th><th scope="col">Decisión</th></tr></thead><tbody>
                        @for (r of rows(); track r.dish.id) {
                          <tr><td><strong>{{ r.dish.name }}</strong><div class="small muted">v{{ r.fromVersion.versionNumber }} → v{{ r.fromVersion.versionNumber + 1 }} (propuesta)</div></td><td class="small">{{ r.changedFoods.join(', ') }}@if (r.blocked) { <div class="small" style="color: var(--danger)">No se puede autorizar: {{ r.blocked }}</div> }</td>
                            <td class="num">{{ c(r.fromVersion.nutrition.perServing.energy) }} → <strong>{{ c(r.after.perServing.energy) }}</strong></td><td class="num">{{ sg(r.diff.protein) }} / {{ sg(r.diff.carbs) }} / {{ sg(r.diff.lipids) }}</td>
                            <td><div class="decide" role="radiogroup" [attr.aria-label]="'Decisión para ' + r.dish.name"><label><input type="radio" [name]="'d-' + r.dish.id" [checked]="decisions()[r.dish.id] === true" (change)="decide(r.dish.id, true)" /> Autorizar</label><label><input type="radio" [name]="'d-' + r.dish.id" [checked]="decisions()[r.dish.id] === false" (change)="decide(r.dish.id, false)" /> Rechazar</label></div></td></tr>
                        }
                      </tbody></table></div>
                      <div class="form-actions"><button tuiButton type="button" appearance="secondary" size="m" (click)="authorizeAll()">Autorizar todos</button><button tuiButton type="button" size="m" [disabled]="!allDecided()" (click)="apply(e.id)">Registrar mis decisiones</button></div>
                    } @else { <div class="callout callout--ok"><app-icon name="check-circle" /><div class="callout-body">Ningún platillo vigente resulta afectado.</div></div> }
                  }
                  @if (batch(e.id); as b) {
                    <div class="callout callout--ok"><app-icon name="check-circle" /><div class="callout-body"><p>Decisiones registradas por {{ b.decidedBy }} el {{ fdt(b.decidedAt) }}: {{ authorized(b) }} autorizados, {{ b.decisions.length - authorized(b) }} rechazados.</p></div></div>
                    <div class="form-actions"><button tuiButton type="button" size="m" (click)="activate(e.id, e.name)">Activar esta edición</button></div>
                  } @else if (reviewing() === e.id && !rows().length) {
                    <div class="form-actions"><button tuiButton type="button" size="m" (click)="activate(e.id, e.name)">Activar esta edición</button></div>
                  }
                }
              </section>
            }
          </div>
        }
      }
    </div>

    <app-modal [(open)]="foodOpen" [title]="foodForm.controls.id.value ? 'Editar alimento personalizado' : 'Nuevo alimento personalizado'" size="wide">
      <form [formGroup]="foodForm" id="food-form" (ngSubmit)="saveFood()" class="stack" novalidate>
        <div class="form-grid">
          <div class="field"><label for="f-n">Nombre</label><input id="f-n" class="input" formControlName="name" /><app-field-error [control]="foodForm.controls.name" /></div>
          <div class="field"><label for="f-b">Marca <span class="muted">opcional</span></label><input id="f-b" class="input" formControlName="brand" /></div>
        </div>
        <div class="field"><label for="f-d">Descripción</label><input id="f-d" class="input" formControlName="description" /></div>
        <fieldset style="border: 0; padding: 0; margin: 0"><legend class="eyebrow" style="margin-block-end: var(--space-2)">Composición para la cantidad base</legend>
          <div class="form-grid">
            <div class="field"><label for="f-q">Cantidad base (g)</label><input id="f-q" class="input" inputmode="decimal" formControlName="baseQuantity" /><app-field-error [control]="foodForm.controls.baseQuantity" /></div>
            <div class="field"><label for="f-e">Energía (kcal)</label><input id="f-e" class="input" inputmode="decimal" formControlName="energy" /><app-field-error [control]="foodForm.controls.energy" /></div>
            <div class="field"><label for="f-p">Proteínas (g)</label><input id="f-p" class="input" inputmode="decimal" formControlName="protein" /><app-field-error [control]="foodForm.controls.protein" /></div>
            <div class="field"><label for="f-c">Carbohidratos (g)</label><input id="f-c" class="input" inputmode="decimal" formControlName="carbs" /><app-field-error [control]="foodForm.controls.carbs" /></div>
            <div class="field"><label for="f-l">Lípidos (g)</label><input id="f-l" class="input" inputmode="decimal" formControlName="lipids" /><app-field-error [control]="foodForm.controls.lipids" /></div>
            <div class="field"><label for="f-fi">Fibra (g)</label><input id="f-fi" class="input" inputmode="decimal" formControlName="fiber" /><app-field-error [control]="foodForm.controls.fiber" /></div>
          </div></fieldset>
        <div class="form-grid">
          <div class="field"><label for="f-st">Tipo de fuente</label><select id="f-st" class="select" formControlName="sourceType">@for (s of sources; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }</select></div>
          <div class="field"><label for="f-sr">Referencia de la fuente</label><input id="f-sr" class="input" formControlName="sourceReference" /><app-field-error [control]="foodForm.controls.sourceReference" /></div>
          <div class="field"><label for="f-pn">Medida casera <span class="muted">opcional</span></label><input id="f-pn" class="input" placeholder="p. ej. Barra, Pieza" formControlName="pieceName" /></div>
          <div class="field"><label for="f-pg">Gramos de esa medida</label><input id="f-pg" class="input" inputmode="decimal" formControlName="pieceGrams" /></div>
        </div>
      </form>
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="foodOpen.set(false)">Cancelar</button><button tuiButton type="submit" form="food-form" size="m">Guardar alimento</button></ng-container>
    </app-modal>

    <app-modal [open]="!!eqFood()" (closed)="eqFood.set(null)" title="Asignar equivalencia SMAE" size="narrow">
      @if (eqFood(); as f) {
        <p>Asignarás una equivalencia a <strong>{{ f.name }}</strong>. Quedará registrado quién, cuándo y con qué criterio.</p>
        <form [formGroup]="eqForm" id="eq-form" (ngSubmit)="saveEq()" class="stack" novalidate>
          <div class="field"><label for="q-sg">Subgrupo</label><select id="q-sg" class="select" formControlName="subgroup">@for (s of subgroups(); track s.id) { <option [value]="s.code">{{ s.name }} ({{ s.code }})</option> }</select></div>
          <div class="field"><label for="q-g">Gramos que equivalen a 1 equivalente</label><input id="q-g" class="input" inputmode="decimal" formControlName="grams" /><app-field-error [control]="eqForm.controls.grams" /></div>
          <div class="field"><label for="q-c">Criterio</label><textarea id="q-c" class="textarea" formControlName="criterion"></textarea><app-field-error [control]="eqForm.controls.criterion" /></div>
        </form>
      }
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="eqFood.set(null)">Cancelar</button><button tuiButton type="submit" form="eq-form" size="m">Asignar equivalencia</button></ng-container>
    </app-modal>
  `,
})
export class Catalog {
  private readonly catalog = inject(CatalogService);
  private readonly data = inject(DbService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly tab = signal<Tab>('alimentos');
  protected readonly tabs: { id: Tab; label: string }[] = [{ id: 'alimentos', label: 'Alimentos' }, { id: 'personalizados', label: 'Personalizados' }, { id: 'ediciones', label: 'Ediciones y recálculo' }];
  protected readonly step = STEP;
  protected readonly source_ = SOURCE_LABEL;
  protected readonly sources = Object.entries(SOURCE_LABEL);
  protected readonly fd = formatDate;
  protected readonly fdt = formatDateTime;
  protected readonly c = fmtCompact;

  protected readonly edition = this.data.activeEdition;
  protected readonly groups = this.data.activeGroups;
  protected readonly subgroups = this.data.activeSubgroups;
  protected readonly search = signal('');
  protected readonly source = signal<'all' | 'smae' | 'custom'>('all');
  protected readonly groupId = signal('');
  protected readonly limit = signal(STEP);
  protected readonly retry = signal(0);
  protected readonly editions = computed(() => (this.data.version(), this.catalog.editions()));
  protected readonly customs = computed(() => this.data.db().customFoods);

  private readonly query = computed(() => ({ q: { search: this.search(), groupId: this.groupId(), source: this.source(), limit: this.limit() }, v: this.data.version(), r: this.retry() }));
  protected readonly foods = toSignal(toObservable(this.query).pipe(debounceTime(200), switchMap(({ q }) => loadable(this.catalog.foods(q)))), { initialValue: { state: 'loading' } as Loadable<{ items: FoodView[]; total: number }> });
  private prev: { items: FoodView[]; total: number } | null = null;
  protected readonly prevFoods = () => this.prev;
  protected readonly view = computed(() => {
    const r = this.foods();
    if (r.state === 'ready') { this.prev = r.data; return r.data; }
    return this.prev;
  });
  protected groupName = (code: string): string => this.data.groupOfSubgroup(code)?.name ?? code;

  // ---------- Personalizados ----------
  protected readonly foodOpen = signal(false);
  protected readonly eqFood = signal<CustomFood | null>(null);
  private readonly dec = [decimalValidator];
  protected readonly foodForm = this.fb.nonNullable.group({
    id: [''], name: ['', Validators.required], brand: [''], description: [''],
    baseQuantity: ['100', [Validators.required, positiveDecimalValidator]],
    energy: ['', [Validators.required, ...this.dec, Validators.min(0)]], protein: ['', [Validators.required, ...this.dec]], carbs: ['', [Validators.required, ...this.dec]],
    lipids: ['', [Validators.required, ...this.dec]], fiber: ['0', this.dec],
    sourceType: ['label' as CustomFoodInput['sourceType']], sourceReference: ['', Validators.required], pieceName: [''], pieceGrams: ['', this.dec],
  });
  protected readonly eqForm = this.fb.nonNullable.group({ subgroup: ['CER-SG'], grams: ['', [Validators.required, positiveDecimalValidator]], criterion: ['', [Validators.required, Validators.minLength(10)]] });

  protected openFood(f?: CustomFood): void {
    this.foodForm.reset({
      id: f?.id ?? '', name: f?.name ?? '', brand: f?.brand ?? '', description: f?.description ?? '', baseQuantity: f?.profile.basisQuantity ?? '100',
      energy: f?.profile.energy ?? '', protein: f?.profile.protein ?? '', carbs: f?.profile.carbs ?? '', lipids: f?.profile.lipids ?? '', fiber: f?.profile.fiber ?? '0',
      sourceType: f?.sourceType ?? 'label', sourceReference: f?.sourceReference ?? '', pieceName: f?.portions[0]?.name ?? '', pieceGrams: f?.portions[0]?.gramsEquivalent ?? '',
    });
    this.foodOpen.set(true);
  }

  protected saveFood(): void {
    this.foodForm.markAllAsTouched();
    if (this.foodForm.invalid) return;
    const v = this.foodForm.getRawValue();
    this.catalog.saveCustomFood({ ...v, id: v.id || undefined }).subscribe({
      next: () => { this.foodOpen.set(false); this.toast.ok(v.id ? 'Alimento actualizado. Recuerda validarlo de nuevo.' : 'Alimento personalizado creado.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  protected validate(f: CustomFood): void { this.catalog.validateCustomFood(f.id).subscribe({ next: () => this.toast.ok('Alimento validado.'), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') }); }
  protected toggleCustom(f: CustomFood): void { this.catalog.setCustomActive(f.id, f.status !== 'active').subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') }); }
  protected openEq(f: CustomFood): void {
    this.eqForm.reset({ subgroup: f.equivalence?.subgroupCode ?? 'CER-SG', grams: f.equivalence?.referenceGrams ?? '', criterion: f.equivalence?.criterion ?? '' });
    this.eqFood.set(f);
  }
  protected saveEq(): void {
    this.eqForm.markAllAsTouched();
    const f = this.eqFood();
    if (this.eqForm.invalid || !f) return;
    const v = this.eqForm.getRawValue();
    this.catalog.assignEquivalence(f.id, v.subgroup, v.grams, v.criterion.trim()).subscribe({
      next: () => { this.eqFood.set(null); this.toast.ok('Equivalencia asignada y registrada.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  // ---------- Ediciones y recálculo ----------
  protected readonly reviewing = signal<string | null>(null);
  protected readonly decisions = signal<Record<string, boolean>>({});
  protected readonly rows = computed(() => (this.reviewing() ? (this.data.version(), this.catalog.affectedDishes(this.reviewing()!)) : []));
  protected readonly allDecided = computed(() => this.rows().every((r) => this.decisions()[r.dish.id] !== undefined));
  protected batch = (editionId: string) => (this.data.version(), this.catalog.batchFor(editionId));
  protected authorized = (b: { decisions: { decision: string }[] }): number => b.decisions.filter((d) => d.decision === 'authorized').length;
  protected sg = (v: string): string => { const n = Number(v); return (n > 0 ? '+' : '') + n.toFixed(1); };

  protected detect(id: string): void {
    this.decisions.set({});
    this.catalog.loadImpact(id).subscribe({ next: () => this.reviewing.set(id), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') });
  }
  protected decide(dishId: string, authorize: boolean): void { this.decisions.update((d) => ({ ...d, [dishId]: authorize })); }
  protected authorizeAll(): void { this.decisions.set(Object.fromEntries(this.rows().map((r) => [r.dish.id, true]))); }

  protected apply(editionId: string): void {
    this.catalog.applyRecalc(editionId, this.rows().map((r) => ({ dishId: r.dish.id, authorize: this.decisions()[r.dish.id] === true && !r.blocked }))).subscribe({
      next: () => { this.reviewing.set(null); this.toast.ok('Decisiones registradas. Los platillos autorizados tienen una versión nueva.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  protected async activate(id: string, name: string): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Activar edición', message: `"${name}" será la edición para platillos nuevos. La edición anterior se conserva archivada para reproducir planes históricos.`, confirmLabel: 'Activar' });
    if (!ok) return;
    this.catalog.activateEdition(id).subscribe({
      next: () => { this.toast.ok('Edición activada.'); void this.router.navigate([], { queryParams: {} }); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }
}
