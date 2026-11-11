import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, switchMap } from 'rxjs';
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
  imports: [TrackingCard, EmptyState, LoadError, Pagination, SearchBox, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar { display: grid; gap: var(--space-3); grid-template-columns: minmax(12rem, 2fr) minmax(10rem, 1fr); }
    @media (max-width: 40rem) { .bar { grid-template-columns: minmax(0, 1fr); } }
  `,
  template: `
    <div class="page page--narrow" style="max-inline-size: 56rem">
      <header class="page-header"><div><h1>Seguimiento</h1><p class="sub">Registros de comidas, fotografías y comentarios. Responde dentro de cada tiempo de comida; no hay chat independiente.</p></div></header>
      <div class="panel">
        <div class="bar">
          <app-search label="Buscar en el seguimiento" placeholder="Platillo, comentario o paciente" [value]="search()" (valueChange)="onSearch($event)" />
          <div class="field"><label class="visually-hidden" for="s-pat">Paciente</label>
            <select id="s-pat" class="select" [value]="patientId()" (change)="patientId.set($any($event.target).value); page.set(1)"><option value="">Todos los pacientes</option>@for (p of patientsList(); track p.id) { <option [value]="p.id">{{ name(p.id) }}</option> }</select></div>
        </div>
        <div class="chips" role="group" aria-label="Filtrar por actividad">
          @for (k of kinds; track k.id) { <button type="button" class="chip-toggle" [attr.aria-pressed]="kind() === k.id" (click)="onKind(k.id)">{{ k.label }}@if (k.id === 'review') { ({{ toReview() }}) }</button> }
        </div>
      </div>

      @if (result(); as r) {
        @if (r.state === 'loading') { <div class="panel panel--flush"><app-skeleton [count]="5" height="4rem" /></div> }
        @else if (r.state === 'error') { <div class="panel"><app-load-error [message]="r.message" (retry)="retry.set(retry() + 1)" /></div> }
        @else {
          @for (e of r.data.items; track e.id) { <app-tracking-card [entry]="e" /> } @empty {
            <div class="panel"><app-empty icon="activity" title="No hay registros con estos filtros" text="Cuando los pacientes registren comidas, fotos o comentarios aparecerán aquí." /></div>
          }
          <div class="panel panel--flush"><app-pagination [page]="r.data.page" [pageSize]="r.data.pageSize" [total]="r.data.total" (pageChange)="page.set($event)" /></div>
        }
      }
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

  private readonly query = computed(() => ({
    q: { search: this.search(), patientId: this.patientId(), kind: this.kind(), page: this.page(), pageSize: 8 } satisfies FeedQuery,
    // En modo API el listado viene del servidor: depender de la versión local provocaría un bucle de peticiones.
    v: this.tracking.apiMode ? 0 : this.data.version(), r: this.retry(),
  }));
  protected readonly result = toSignal(
    toObservable(this.query).pipe(debounceTime(250), switchMap(({ q }) => loadable(this.tracking.feed(q)))),
    { initialValue: { state: 'loading' } as Loadable<Page<TrackingEntry>> },
  );

  protected onSearch(v: string): void { this.search.set(v); this.page.set(1); }
  protected onKind(k: Kind): void { this.kindSignal.set(k); this.page.set(1); }
}
