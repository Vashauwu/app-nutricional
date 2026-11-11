import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, switchMap } from 'rxjs';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { PatientQuery, PatientRow, PatientsService } from '../../core/services/patients.service';
import { GOAL_LABEL, Goal, PATIENT_STATUS_LABEL, PatientStatus } from '../../shared/models/domain';
import { Badge, EmptyState, LoadError, Pagination, PATIENT_TONE, SearchBox, Skeleton } from '../../shared/components/ui';
import { Icon } from '../../shared/components/icon';
import { Loadable, Page, loadable } from '../../shared/utils/loadable';
import { formatDate } from '../../shared/utils/format';

@Component({
  selector: 'app-patient-list',
  imports: [RouterLink, TuiButton, Icon, Badge, EmptyState, LoadError, Pagination, SearchBox, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .filters { display: grid; grid-template-columns: minmax(12rem, 2fr) repeat(2, minmax(10rem, 1fr)); gap: var(--space-3); padding: var(--space-4) var(--space-5); border-block-end: 1px solid var(--line); }
    @media (max-width: 40rem) { .filters { grid-template-columns: minmax(0, 1fr); } }
    .name { display: flex; align-items: center; gap: .75rem; }
    .meter { inline-size: 5rem; }
    .cell-compliance { display: flex; align-items: center; gap: .5rem; }
  `,
  template: `
    <div class="page">
      <header class="page-header">
        <div><h1>Pacientes</h1><p class="sub">Busca por nombre, correo o teléfono, y filtra por estado y objetivo.</p></div>
        <div class="actions"><a tuiButton routerLink="/pacientes/nuevo" size="m"><app-icon name="user-plus" [size]="18" /> Nuevo paciente</a></div>
      </header>

      <section class="panel panel--flush" aria-label="Listado de pacientes">
        <div class="filters">
          <app-search label="Buscar pacientes" placeholder="Nombre, correo o teléfono" [value]="search()" (valueChange)="onSearch($event)" />
          <div class="field">
            <label class="visually-hidden" for="f-status">Estado</label>
            <select id="f-status" class="select" [value]="status()" (change)="onStatus($any($event.target).value)">
              <option value="">Todos los estados</option>
              @for (s of statuses; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
              <option value="deleted">Desactivados</option>
            </select>
          </div>
          <div class="field">
            <label class="visually-hidden" for="f-goal">Objetivo</label>
            <select id="f-goal" class="select" [value]="goal()" (change)="onGoal($any($event.target).value)">
              <option value="">Todos los objetivos</option>
              @for (g of goals; track g[0]) { <option [value]="g[0]">{{ g[1] }}</option> }
            </select>
          </div>
        </div>

        @if (result(); as r) {
          @if (r.state === 'loading') { <app-skeleton [count]="6" /> }
          @else if (r.state === 'error') { <app-load-error [message]="r.message" (retry)="retry.set(retry() + 1)" /> }
          @else {
            @if (r.data.items.length) {
              <div class="table-wrap">
                <table class="table">
                  <caption class="visually-hidden">Pacientes</caption>
                  <thead><tr><th scope="col">Paciente</th><th scope="col">Edad</th><th scope="col">Objetivo</th><th scope="col">Estado</th><th scope="col">Plan</th><th scope="col">Cumplimiento</th><th scope="col">Registro</th></tr></thead>
                  <tbody>
                    @for (row of r.data.items; track row.patient.id) {
                      <tr>
                        <td><div class="name"><span class="avatar" aria-hidden="true">{{ row.name[0] }}</span><div><a class="row-link" [routerLink]="['/pacientes', row.patient.id]">{{ row.name }}</a><div class="small muted">{{ row.patient.profile.email }}</div></div></div></td>
                        <td class="mono">{{ row.age }}</td>
                        <td>{{ goalLabel[row.patient.goal] }}</td>
                        <td><app-badge [tone]="tone[row.patient.status]">{{ statusLabel[row.patient.status] }}</app-badge></td>
                        <td>@if (row.planName) { <span class="small">{{ row.planName }}</span> } @else { <span class="muted small">Sin plan</span> }</td>
                        <td>@if (row.compliance !== null) { <div class="cell-compliance"><div class="meter"><span [style.inline-size.%]="row.compliance"></span></div><span class="mono">{{ row.compliance }}%</span></div> } @else { <span class="muted">—</span> }</td>
                        <td>@if (row.consentComplete) { <app-badge tone="ok" icon="check">Completo</app-badge> } @else { <app-badge tone="warn" icon="lock">Pendiente</app-badge> }<div class="small muted">Alta {{ fd(row.patient.createdAt) }}</div></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <app-pagination [page]="r.data.page" [pageSize]="r.data.pageSize" [total]="r.data.total" (pageChange)="page.set($event)" />
            } @else {
              <app-empty icon="users" title="No hay pacientes con estos filtros" text="Prueba con otra búsqueda o limpia los filtros.">
                <button tuiButton type="button" appearance="secondary" size="m" (click)="clear()">Limpiar filtros</button>
              </app-empty>
            }
          }
        }
      </section>
    </div>
  `,
})
export class PatientList {
  private readonly patients = inject(PatientsService);
  private readonly data = inject(DbService);
  /** Parámetros de URL (withComponentInputBinding): /pacientes?estado=active */
  readonly estado = input<string>();

  protected readonly search = signal('');
  protected readonly status = signal<PatientQuery['status']>('');
  protected readonly goal = signal<Goal | ''>('');
  protected readonly page = signal(1);
  protected readonly retry = signal(0);
  protected readonly statuses = Object.entries(PATIENT_STATUS_LABEL);
  protected readonly goals = Object.entries(GOAL_LABEL);
  protected readonly statusLabel = PATIENT_STATUS_LABEL;
  protected readonly goalLabel = GOAL_LABEL;
  protected readonly tone = PATIENT_TONE;
  protected readonly fd = formatDate;

  private readonly query = computed(() => ({
    q: { search: this.search(), status: this.estado() && !this.touchedStatus() ? (this.estado() as PatientStatus) : this.status(), goal: this.goal(), page: this.page(), pageSize: 10 } satisfies PatientQuery,
    v: this.data.version(),
    r: this.retry(),
  }));
  private readonly touchedStatus = signal(false);

  protected readonly result = toSignal(
    toObservable(this.query).pipe(debounceTime(250), switchMap(({ q }) => loadable(this.patients.list(q)))),
    { initialValue: { state: 'loading' } as Loadable<Page<PatientRow>> },
  );

  protected onSearch(v: string): void { this.search.set(v); this.page.set(1); }
  protected onStatus(v: PatientQuery['status']): void { this.touchedStatus.set(true); this.status.set(v); this.page.set(1); }
  protected onGoal(v: Goal | ''): void { this.goal.set(v); this.page.set(1); }
  protected clear(): void { this.search.set(''); this.touchedStatus.set(true); this.status.set(''); this.goal.set(''); this.page.set(1); }
}
