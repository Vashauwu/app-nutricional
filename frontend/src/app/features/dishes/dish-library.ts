import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, switchMap, firstValueFrom } from 'rxjs';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { DishQuery, DishRow, DishesService } from '../../core/services/dishes.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { Badge, EmptyState, LoadError, SearchBox, Skeleton } from '../../shared/components/ui';
import { DishThumb, EqChips, Macros } from '../../shared/components/nutrition-bits';
import { Icon } from '../../shared/components/icon';
import { Loadable, loadable } from '../../shared/utils/loadable';

type Result = { items: DishRow[]; total: number };
const STEP = 12;

@Component({
  selector: 'app-dish-library',
  imports: [RouterLink, TuiButton, Icon, Badge, EmptyState, LoadError, SearchBox, DishThumb, Macros, EqChips],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .filters { display: grid; gap: var(--space-3); grid-template-columns: minmax(12rem, 2fr) repeat(3, minmax(9rem, 1fr)); }
    @media (max-width: 52rem) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .filters app-search { grid-column: 1 / -1; } }
    .cards { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); }
    article { position: relative; display: grid; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); align-content: start; }
    article:hover { box-shadow: var(--shadow-m); }
    article a.cover { position: absolute; inset: 0; border-radius: inherit; z-index: 1; }
    article h2 { font-size: 1.0625rem; font-family: var(--nutri-font-ui); font-weight: 600; }
    .acts { position: relative; z-index: 2; display: flex; gap: .25rem; margin-inline-start: auto; }
    .inactive { opacity: .72; }
  `,
  template: `
    <div class="page">
      <header class="page-header">
        <div><h1>Platillos</h1><p class="sub">Biblioteca reutilizable. Cada cambio crea una versión nueva; los planes publicados conservan la que tenían.</p></div>
        <div class="actions"><a tuiButton routerLink="/platillos/nuevo" size="m"><app-icon name="plus" [size]="18" /> Crear platillo</a></div>
      </header>

      <section class="panel" aria-label="Filtros">
        <div class="filters">
          <app-search label="Buscar platillos" placeholder="Nombre, ingrediente o etiqueta" [value]="search()" (valueChange)="set(search, $event)" />
          <div class="field"><label class="visually-hidden" for="d-cat">Categoría</label><select id="d-cat" class="select" [value]="category()" (change)="set(category, $any($event.target).value)"><option value="">Todas las categorías</option>@for (c of categories; track c) { <option [value]="c">{{ c }}</option> }</select></div>
          <div class="field"><label class="visually-hidden" for="d-sg">Grupo SMAE</label><select id="d-sg" class="select" [value]="subgroup()" (change)="set(subgroup, $any($event.target).value)"><option value="">Todos los grupos SMAE</option>@for (s of subgroups(); track s.id) { <option [value]="s.code">{{ s.name }}</option> }</select></div>
          <div class="field"><label class="visually-hidden" for="d-st">Estado</label><select id="d-st" class="select" [value]="status()" (change)="set(status, $any($event.target).value)"><option value="">Activos e inactivos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></div>
        </div>
      </section>

      @if (result(); as r) {
        @if (r.state === 'loading' && !view()) { <div class="cards">@for (i of skeletons; track i) { <span class="skeleton" style="block-size: 17rem; border-radius: var(--radius-m)"></span> }</div> }
        @else if (r.state === 'error') { <div class="panel"><app-load-error [message]="r.message" (retry)="retry.set(retry() + 1)" /></div> }
        @else {
          @if (view(); as v) {
            @if (v.items.length) {
              <p class="small muted" aria-live="polite">{{ v.items.length }} de {{ v.total }} platillos</p>
              <div class="cards" role="list">
                @for (row of v.items; track row.dish.id) {
                  <article role="listitem" [class.inactive]="row.dish.status === 'inactive'">
                    <a class="cover" [routerLink]="['/platillos', row.dish.id]" [attr.aria-label]="'Abrir ' + row.dish.name"></a>
                    <app-dish-thumb [category]="row.dish.category" [src]="row.current.image?.dataUrl" [alt]="row.current.image?.alt ?? ''" />
                    <div class="row"><app-badge tone="accent">{{ row.dish.category }}</app-badge>@if (row.dish.status === 'inactive') { <app-badge icon="ban">Inactivo</app-badge> }<span class="small muted">v{{ row.dish.currentVersion }}</span>
                      <span class="acts">
                        <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Duplicar ' + row.dish.name" (click)="duplicate(row.dish.id)"><app-icon name="copy" [size]="18" /></button>
                        <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="(row.dish.status === 'active' ? 'Desactivar ' : 'Activar ') + row.dish.name" (click)="toggle(row)"><app-icon [name]="row.dish.status === 'active' ? 'ban' : 'refresh'" [size]="18" /></button>
                      </span></div>
                    <h2>{{ row.dish.name }}</h2>
                    <app-macros [n]="row.current.nutrition.perServing" />
                    <app-eq-chips [eq]="row.current.nutrition.equivalents" />
                    @if (row.current.nutrition.hasCustomFoods) { <span class="small" style="color: var(--warn)"><app-icon name="alert" [size]="14" /> Incluye alimentos personalizados</span> }
                  </article>
                }
              </div>
              @if (v.items.length < v.total) {
                <div class="row" style="justify-content: center"><button tuiButton type="button" appearance="secondary" size="m" [disabled]="r.state === 'loading'" (click)="limit.set(limit() + step)">{{ r.state === 'loading' ? 'Cargando…' : 'Cargar más platillos' }}</button></div>
              }
            } @else {
              <div class="panel"><app-empty icon="dish" title="No hay platillos con estos filtros" text="Ajusta la búsqueda o crea uno nuevo."><a tuiButton routerLink="/platillos/nuevo" size="m">Crear platillo</a></app-empty></div>
            }
          }
        }
      }
    </div>
  `,
})
export class DishLibrary {
  private readonly dishes = inject(DishesService);
  private readonly data = inject(DbService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly search = signal('');
  protected readonly category = signal('');
  protected readonly subgroup = signal('');
  protected readonly status = signal<'active' | 'inactive' | ''>('');
  protected readonly limit = signal(STEP);
  protected readonly retry = signal(0);
  protected readonly step = STEP;
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];
  protected readonly categories = this.dishes.categories();
  protected readonly subgroups = this.data.activeSubgroups;

  private readonly query = computed(() => ({
    q: { search: this.search(), category: this.category(), subgroupCode: this.subgroup(), status: this.status(), limit: this.limit() } satisfies DishQuery,
    // En modo API el listado viene del servidor: depender de la versión local provocaría un bucle de peticiones.
    v: this.dishes.apiMode ? 0 : this.data.version(), r: this.retry(),
  }));
  protected readonly result = toSignal(
    toObservable(this.query).pipe(debounceTime(250), switchMap(({ q }) => loadable(this.dishes.list(q)))),
    { initialValue: { state: 'loading' } as Loadable<Result> },
  );
  /** Mantiene el último listado visible mientras llegan más resultados (carga progresiva). */
  private prev: Result | null = null;
  protected readonly view = computed(() => {
    const r = this.result();
    if (r.state === 'ready') { this.prev = r.data; return r.data; }
    return this.prev;
  });

  protected set(target: { set(v: never): void }, v: string): void {
    (target as { set(v: string): void }).set(v);
    this.limit.set(STEP);
  }

  protected duplicate(id: string): void {
    this.dishes.duplicate(id).subscribe({
      next: (copy) => { this.toast.ok('Platillo duplicado. Ahora puedes editar la copia.'); void this.router.navigate(['/platillos', copy, 'editar']); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  protected async toggle(row: DishRow): Promise<void> {
    if (row.dish.status === 'active') {
      const used = await firstValueFrom(this.dishes.usage(row.dish.id)).catch(() => 0);
      const ok = await this.confirm.ask({
        title: 'Desactivar platillo',
        message: used ? `"${row.dish.name}" está en ${used} plan(es) vigente(s). Seguirá visible en ellos, pero no podrá agregarse a planes nuevos.` : `"${row.dish.name}" no podrá agregarse a planes nuevos. Podrás reactivarlo.`,
        confirmLabel: 'Desactivar',
      });
      if (!ok) return;
    }
    const wasActive = row.dish.status === 'active';
    this.dishes.setActive(row.dish.id, !wasActive).subscribe({ next: () => this.toast.ok(wasActive ? 'Platillo desactivado.' : 'Platillo activado.'), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') });
  }
}
