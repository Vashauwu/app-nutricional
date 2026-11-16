import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, debounceTime, of, startWith, switchMap } from 'rxjs';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { DietCalcSummary, DietocalculoService } from '../../core/services/dietocalculo.service';
import { PatientsService } from '../../core/services/patients.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { Combobox, ComboOption } from '../../shared/components/combobox';
import { Icon } from '../../shared/components/icon';
import { PageHeader } from '../../shared/components/page-header';
import { Badge, EmptyState, LoadError, SearchBox, Skeleton } from '../../shared/components/ui';
import { formatDate } from '../../shared/utils/format';

@Component({
  selector: 'app-dietocalculo-list',
  imports: [PageHeader, RouterLink, TuiButton, Icon, Badge, EmptyState, LoadError, SearchBox, Skeleton, Combobox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page" aria-labelledby="dc-title">
      <app-page-header title="Dietocálculo" sub="Calcula el gasto, los macronutrimentos y el cuadro dietosintético de una dieta. Puedes guardarla suelta o enlazarla a un paciente.">
        <a tuiButton size="m" routerLink="/dietocalculo/nuevo"><app-icon name="plus" [size]="18" /> Nueva dieta</a>
      </app-page-header>

      <section class="panel panel--flush" aria-label="Dietas guardadas">
        <div class="filters">
          <app-search label="Buscar dietas" placeholder="Nombre de la dieta" [value]="search()" (valueChange)="search.set($event)" />
          <app-combobox label="Paciente" [hideLabel]="true" [allowAll]="true" allLabel="Todos los pacientes" placeholder="Todos los pacientes" [options]="patientOptions()" [value]="patient()" (valueChange)="patient.set($event)" />
          <label class="check"><input type="checkbox" [checked]="unlinked()" (change)="unlinked.set($any($event.target).checked)" /> Solo sin paciente</label>
        </div>
        @if (state() === 'loading') { <app-skeleton [count]="4" /> }
        @else if (state() === 'error') { <app-load-error message="No se pudieron cargar las dietas." (retry)="reload.set(reload() + 1)" /> }
        @else if (items().length) {
          <div class="table-wrap">
            <table class="table">
              <caption class="visually-hidden">Dietas guardadas</caption>
              <thead><tr><th scope="col">Dieta</th><th scope="col">Paciente</th><th scope="col" class="num">Prescripción</th><th scope="col">Actualizada</th><th scope="col"><span class="visually-hidden">Acciones</span></th></tr></thead>
              <tbody>
                @for (d of items(); track d.id) {
                  <tr>
                    <td><a class="link-btn" [routerLink]="['/dietocalculo', d.id]"><strong>{{ d.name }}</strong></a></td>
                    <td>@if (d.patientId) { <a [routerLink]="['/pacientes', d.patientId]">{{ d.patientName }}</a> } @else { <app-badge>Sin paciente</app-badge> }</td>
                    <td class="num">{{ d.kcal }} kcal</td>
                    <td>{{ fd(d.updatedAt) }}</td>
                    <td><button type="button" class="icon-btn" [attr.aria-label]="'Eliminar ' + d.name" (click)="remove(d)"><app-icon name="trash" [size]="18" /></button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <app-empty icon="scale" title="Aún no hay dietas guardadas" text="Crea una dieta nueva para calcular el gasto energético y repartir los equivalentes.">
            <a tuiButton size="m" routerLink="/dietocalculo/nuevo"><app-icon name="plus" [size]="18" /> Nueva dieta</a>
          </app-empty>
        }
      </section>
    </section>
  `,
})
export class DietocalculoList {
  private readonly svc = inject(DietocalculoService);
  private readonly data = inject(DbService);
  private readonly patients = inject(PatientsService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  protected readonly search = signal('');
  protected readonly patient = signal(this.route.snapshot.queryParamMap.get('paciente') ?? '');
  protected readonly unlinked = signal(false);
  protected readonly reload = signal(0);
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly fd = formatDate;

  protected readonly patientOptions = computed<ComboOption[]>(() =>
    this.data.db().patients.filter((p) => !p.deletedAt).map((p) => ({ id: p.id, label: `${p.profile.firstName} ${p.profile.lastName}`, hint: p.profile.email })));

  private readonly query = computed(() => ({ q: this.search(), patientId: this.patient() || undefined, unlinked: this.unlinked(), r: this.reload() }));
  protected readonly items = toSignal(
    toObservable(this.query).pipe(
      debounceTime(150),
      switchMap((q) => { this.state.set('loading'); return this.svc.list(q).pipe(catchError(() => { this.state.set('error'); return of(null); })); }),
      switchMap((r) => { if (r) this.state.set('ok'); return of(r ?? []); }),
      startWith([] as DietCalcSummary[]),
    ),
    { initialValue: [] as DietCalcSummary[] },
  );

  constructor() { this.patients.loadAll().subscribe({ error: () => undefined }); }

  protected async remove(d: DietCalcSummary): Promise<void> {
    if (!(await this.confirm.ask({ title: `Eliminar «${d.name}»`, message: 'La dieta guardada dejará de aparecer. El expediente del paciente no se modifica.', confirmLabel: 'Eliminar', tone: 'danger' }))) return;
    this.svc.remove(d.id).subscribe({ next: () => { this.toast.ok('Dieta eliminada.'); this.reload.set(this.reload() + 1); }, error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo eliminar.') });
  }
}
