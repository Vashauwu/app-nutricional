import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, switchMap } from 'rxjs';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { PatientsService } from '../../core/services/patients.service';
import { PlanQuery, PlansService } from '../../core/services/plans.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { MealPlan, PLAN_STATUS_LABEL, PlanStatus } from '../../shared/models/domain';
import { Badge, EmptyState, LoadError, PLAN_TONE, Pagination, SearchBox, Skeleton } from '../../shared/components/ui';
import { Icon } from '../../shared/components/icon';
import { Loadable, Page, loadable } from '../../shared/utils/loadable';
import { formatDate } from '../../shared/utils/format';

@Component({
  selector: 'app-plan-list',
  imports: [RouterLink, TuiButton, Icon, Badge, EmptyState, LoadError, Pagination, SearchBox, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .filters { display: grid; gap: var(--space-3); grid-template-columns: minmax(12rem, 2fr) repeat(4, minmax(8.5rem, 1fr)); padding: var(--space-4) var(--space-5); border-block-end: 1px solid var(--line); }
    @media (max-width: 62rem) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .filters app-search { grid-column: 1 / -1; } }
    .tpl { display: grid; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); align-content: start; }
  `,
  template: `
    <div class="page">
      <header class="page-header">
        <div><h1>Planes alimentarios</h1><p class="sub">Busca por paciente, estado y fechas. Un plan publicado se ve de inmediato en la app de la paciente.</p></div>
        <div class="actions"><a tuiButton routerLink="/planes/nuevo" size="m"><app-icon name="plus" [size]="18" /> Crear plan</a></div>
      </header>

      <div class="tabs" role="tablist" aria-label="Planes y plantillas">
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'planes'" (click)="tab.set('planes')">Planes</button>
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'plantillas'" (click)="tab.set('plantillas')">Plantillas ({{ templates().length }})</button>
      </div>

      @if (tab() === 'planes') {
        <section class="panel panel--flush" aria-label="Listado de planes">
          <div class="filters">
            <app-search label="Buscar planes" placeholder="Nombre del plan o paciente" [value]="search()" (valueChange)="search.set($event); page.set(1)" />
            <div class="field"><label class="visually-hidden" for="pl-st">Estado</label><select id="pl-st" class="select" [value]="statusValue()" (change)="onStatus($any($event.target).value)"><option value="">Todos los estados</option>@for (s of statuses; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }</select></div>
            <div class="field"><label class="visually-hidden" for="pl-pt">Paciente</label><select id="pl-pt" class="select" (change)="patientId.set($any($event.target).value); page.set(1)"><option value="">Todos los pacientes</option>@for (p of patientList(); track p.id) { <option [value]="p.id">{{ patientName(p.id) }}</option> }</select></div>
            <div class="field"><label for="pl-f" class="small">Desde</label><input id="pl-f" class="input" type="date" (change)="from.set($any($event.target).value); page.set(1)" /></div>
            <div class="field"><label for="pl-t" class="small">Hasta</label><input id="pl-t" class="input" type="date" (change)="to.set($any($event.target).value); page.set(1)" /></div>
          </div>
          @if (result(); as r) {
            @if (r.state === 'loading') { <app-skeleton [count]="5" /> }
            @else if (r.state === 'error') { <app-load-error [message]="r.message" (retry)="retry.set(retry() + 1)" /> }
            @else if (r.data.items.length) {
              <div class="table-wrap"><table class="table"><caption class="visually-hidden">Planes</caption><thead><tr><th scope="col">Plan</th><th scope="col">Paciente</th><th scope="col">Periodo</th><th scope="col">Estado</th><th scope="col" class="num">Platillos</th><th scope="col">Actualizado</th></tr></thead><tbody>
                @for (p of r.data.items; track p.id) {
                  <tr><td><a class="row-link" [routerLink]="['/planes', p.id]">{{ p.name }}</a></td><td><a [routerLink]="['/pacientes', p.patientId]">{{ patientName(p.patientId) }}</a></td><td class="mono">{{ fd(p.startDate) }} – {{ fd(p.endDate) }}</td>
                    <td><app-badge [tone]="tone[p.status]">{{ label[p.status] }}</app-badge></td><td class="num">{{ count(p) }}</td><td class="small">{{ fd(p.updatedAt) }}<div class="muted">{{ p.updatedBy }}</div></td></tr>
                }
              </tbody></table></div>
              <app-pagination [page]="r.data.page" [pageSize]="r.data.pageSize" [total]="r.data.total" (pageChange)="page.set($event)" />
            } @else { <app-empty icon="calendar" title="No hay planes con estos filtros" text="Cambia los filtros o crea un plan nuevo."><a tuiButton routerLink="/planes/nuevo" size="m">Crear plan</a></app-empty> }
          }
        </section>
      } @else {
        <section aria-label="Plantillas">
          <p class="small muted" style="margin-block-end: var(--space-3)">Modificar una plantilla no cambia los planes ya asignados: cada plan conserva su propia copia.</p>
          <div class="grid grid--3">
            @for (t of templates(); track t.id) {
              <article class="tpl">
                <div class="row"><app-badge [tone]="t.scope === 'global' ? 'info' : 'accent'">{{ t.scope === 'global' ? 'Global' : 'Paciente: ' + patientName(t.patientId ?? '') }}</app-badge><span class="small muted">{{ t.days.length }} día(s)</span></div>
                <h2 style="font-size: 1.0625rem; font-family: var(--nutri-font-ui)">{{ t.name }}</h2>
                <p class="small muted">{{ t.description }}</p>
                <div class="row"><a tuiButton size="s" routerLink="/planes/nuevo" [queryParams]="{ plantilla: t.id }">Usar</a><button tuiButton type="button" size="s" appearance="secondary" (click)="dupTpl(t.id)">Duplicar</button><button tuiButton type="button" size="s" appearance="flat" (click)="delTpl(t.id, t.name)">Eliminar</button></div>
              </article>
            } @empty { <div class="panel"><app-empty icon="copy" title="Sin plantillas" text="Desde el editor de un plan puedes guardarlo como plantilla." /></div> }
          </div>
        </section>
      }
    </div>
  `,
})
export class PlanList {
  private readonly plans = inject(PlansService);
  private readonly patients = inject(PatientsService);
  private readonly data = inject(DbService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  /** /planes?estado=published */
  readonly estado = input<string>();
  protected readonly tab = signal<'planes' | 'plantillas'>('planes');
  protected readonly search = signal('');
  private readonly statusSel = signal<string | null>(null);
  protected readonly statusValue = computed(() => this.statusSel() ?? this.estado() ?? '');
  protected readonly patientId = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly page = signal(1);
  protected readonly retry = signal(0);
  protected readonly statuses = Object.entries(PLAN_STATUS_LABEL);
  protected readonly label = PLAN_STATUS_LABEL;
  protected readonly tone = PLAN_TONE;
  protected readonly fd = formatDate;
  protected readonly patientList = computed(() => this.patients.all());
  protected readonly templates = computed(() => (this.data.version(), this.plans.allTemplates()));
  protected patientName = (id: string): string => this.data.patientName(id);
  protected count = (p: MealPlan): number => this.plans.itemCount(p);

  private readonly query = computed(() => ({
    q: { search: this.search(), status: this.statusValue() as PlanStatus | '', patientId: this.patientId(), from: this.from(), to: this.to(), page: this.page(), pageSize: 10 } satisfies PlanQuery,
    // En modo API el listado viene del servidor: depender de la versión local provocaría un bucle de peticiones.
    v: this.plans.apiMode ? 0 : this.data.version(), r: this.retry(),
  }));
  protected readonly result = toSignal(
    toObservable(this.query).pipe(debounceTime(250), switchMap(({ q }) => loadable(this.plans.list(q)))),
    { initialValue: { state: 'loading' } as Loadable<Page<MealPlan>> },
  );

  protected onStatus(v: string): void { this.statusSel.set(v); this.page.set(1); }
  constructor() {
    this.plans.loadTemplates().subscribe({ error: () => undefined });
    this.patients.loadAll().subscribe({ error: () => undefined });
  }

  protected dupTpl(id: string): void { this.plans.duplicateTemplate(id).subscribe({ next: () => this.toast.ok('Plantilla duplicada.'), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') }); }
  protected async delTpl(id: string, name: string): Promise<void> {
    if (await this.confirm.ask({ title: 'Eliminar plantilla', message: `"${name}" se eliminará. Los planes creados desde ella no cambian.`, confirmLabel: 'Eliminar', tone: 'danger' })) this.plans.deleteTemplate(id).subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') });
  }
}
