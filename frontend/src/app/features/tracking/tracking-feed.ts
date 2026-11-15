import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, switchMap } from 'rxjs';
import { TuiButton } from '@taiga-ui/core';
import { forkJoin } from 'rxjs';
import { ToastService } from '../../core/services/ui.services';
import { Icon } from '../../shared/components/icon';
import { Combobox } from '../../shared/components/combobox';
import { PageHeader } from '../../shared/components/page-header';
import { DbService } from '../../core/data/db.service';
import { FeedQuery, TrackingService } from '../../core/services/tracking.service';
import { PatientsService } from '../../core/services/patients.service';
import { TrackingEntry } from '../../shared/models/domain';
import { EmptyState, LoadError, Pagination, SearchBox, Skeleton } from '../../shared/components/ui';
import { Loadable, Page, loadable } from '../../shared/utils/loadable';
import { TrackingCard } from './tracking-card';

type Kind = FeedQuery['kind'];

@Component({
  selector: 'app-tracking-feed',
  imports: [TrackingCard, EmptyState, LoadError, Pagination, SearchBox, Skeleton, PageHeader, TuiButton, Icon, Combobox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .feed { display: grid; gap: var(--space-4); max-inline-size: 60rem; }
    .bar { display: grid; gap: var(--space-3); grid-template-columns: minmax(12rem, 2fr) minmax(10rem, 1fr); }
    .batch { position: sticky; inset-block-end: 1rem; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4);
      border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); box-shadow: var(--shadow-m); }
    .batch label { display: inline-flex; align-items: center; gap: .5rem; }
    .batch input { inline-size: 1.25rem; block-size: 1.25rem; accent-color: var(--brand-ink); }
    @media (max-width: 40rem) { .bar { grid-template-columns: minmax(0, 1fr); } }
  `,
  template: `
    <div class="page">
      <app-page-header title="Seguimiento" sub="Registros de comidas, fotografías y comentarios. Responde dentro de cada tiempo de comida; no hay chat independiente." />
      <div class="feed">
      <div class="panel">
        <div class="bar">
          <app-search label="Buscar en el seguimiento" placeholder="Platillo, comentario o paciente" [value]="search()" (valueChange)="onSearch($event)" />
          <app-combobox label="Paciente" [hideLabel]="true" [allowAll]="true" allLabel="Todos los pacientes" placeholder="Todos los pacientes" [options]="patientOptions()" [value]="patientId()" (valueChange)="patientId.set($event); page.set(1)" />
        </div>
        <div class="chips" role="group" aria-label="Filtrar por actividad">
          @for (k of kinds; track k.id) { <button type="button" class="chip-toggle" [attr.aria-pressed]="kind() === k.id" (click)="onKind(k.id)">{{ k.label }}@if (k.id === 'review') { ({{ toReview() }}) }</button> }
        </div>
      </div>

      @if (result(); as r) {
        @if (r.state === 'loading') { <div class="panel panel--flush"><app-skeleton [count]="5" height="4rem" /></div> }
        @else if (r.state === 'error') { <div class="panel"><app-load-error [message]="r.message" (retry)="retry.set(retry() + 1)" /></div> }
        @else {
          @if (reviewable(r.data.items).length > 1) {
            <label class="small row"><input type="checkbox" class="check-all" [checked]="allSelected(r.data.items)" (change)="toggleAll(r.data.items)" /> Seleccionar los {{ reviewable(r.data.items).length }} registros por revisar de esta página</label>
          }
          @for (e of r.data.items; track e.id) { <app-tracking-card [entry]="e" [selectable]="e.needsReview" [selected]="selection().has(e.id)" (toggled)="toggle(e.id)" /> } @empty {
            <div class="panel"><app-empty icon="activity" title="No hay registros con estos filtros" text="Cuando los pacientes registren comidas, fotos o comentarios aparecerán aquí." /></div>
          }
          <div class="panel panel--flush"><app-pagination [page]="r.data.page" [pageSize]="r.data.pageSize" [total]="r.data.total" (pageChange)="page.set($event)" /></div>
        }
      }
      @if (selection().size > 0) {
        <div class="batch" role="region" aria-label="Acciones en lote">
          <strong>{{ selection().size }} seleccionado(s)</strong>
          <button tuiButton type="button" size="m" [disabled]="busy()" (click)="markSelected()"><app-icon name="check" [size]="16" /> Marcar como revisados</button>
          <button tuiButton type="button" size="m" appearance="flat" (click)="selection.set(emptySet)">Quitar selección</button>
        </div>
      }
      </div>
    </div>
  `,
})
export class TrackingFeed {
  private readonly tracking = inject(TrackingService);
  private readonly patients = inject(PatientsService);
  private readonly data = inject(DbService);
  /** /seguimiento?filtro=review */
  readonly filtro = input<string>();

  protected readonly search = signal('');
  protected readonly patientId = signal('');
  private readonly kindSignal = signal<Kind | null>(null);
  protected readonly kind = computed<Kind>(() => this.kindSignal() ?? ((['review', 'photos', 'comments', 'skipped'] as string[]).includes(this.filtro() ?? '') ? (this.filtro() as Kind) : ''));
  protected readonly page = signal(1);
  protected readonly retry = signal(0);
  protected readonly kinds: { id: Kind; label: string }[] = [
    { id: '', label: 'Todo' }, { id: 'review', label: 'Por revisar' }, { id: 'photos', label: 'Con fotos' }, { id: 'comments', label: 'Con comentarios' }, { id: 'skipped', label: 'Omitidas' },
  ];
  protected readonly patientsList = computed(() => (this.data.version(), this.patients.all()));
  protected readonly toReview = computed(() => this.data.db().tracking.filter((t) => t.needsReview).length);
  protected name = (id: string): string => this.data.patientName(id);
  protected readonly patientOptions = computed(() => this.patientsList().map((p) => ({ id: p.id, label: this.data.patientName(p.id) })));

  private readonly query = computed(() => ({
    q: { search: this.search(), patientId: this.patientId(), kind: this.kind(), page: this.page(), pageSize: 8 } satisfies FeedQuery,
    // En modo API el listado viene del servidor: depender de la versión local provocaría un bucle de peticiones.
    v: this.tracking.apiMode ? 0 : this.data.version(), r: this.retry(),
  }));
  protected readonly result = toSignal(
    toObservable(this.query).pipe(debounceTime(250), switchMap(({ q }) => loadable(this.tracking.feed(q)))),
    { initialValue: { state: 'loading' } as Loadable<Page<TrackingEntry>> },
  );

  // ---- Acciones en lote: marcar varios registros como revisados ----
  private readonly toast = inject(ToastService);
  protected readonly emptySet = new Set<string>();
  protected readonly selection = signal<Set<string>>(this.emptySet);
  protected readonly busy = signal(false);
  protected reviewable = (items: TrackingEntry[]): TrackingEntry[] => items.filter((e) => e.needsReview);
  protected allSelected = (items: TrackingEntry[]): boolean => { const r = this.reviewable(items); return r.length > 0 && r.every((e) => this.selection().has(e.id)); };
  protected toggle(id: string): void {
    const next = new Set(this.selection());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selection.set(next);
  }
  protected toggleAll(items: TrackingEntry[]): void {
    this.selection.set(this.allSelected(items) ? this.emptySet : new Set(this.reviewable(items).map((e) => e.id)));
  }
  protected markSelected(): void {
    const ids = [...this.selection()];
    this.busy.set(true);
    forkJoin(ids.map((id) => this.tracking.markReviewed(id))).subscribe({
      next: () => { this.selection.set(this.emptySet); this.busy.set(false); this.retry.update((n) => n + 1); this.toast.ok(`${ids.length} registro(s) marcados como revisados.`); },
      error: (e: unknown) => { this.busy.set(false); this.toast.error(e instanceof Error ? e.message : 'No se pudieron marcar todos.'); },
    });
  }

  protected onSearch(v: string): void { this.search.set(v); this.page.set(1); }
  protected onKind(k: Kind): void { this.kindSignal.set(k); this.page.set(1); }
}
