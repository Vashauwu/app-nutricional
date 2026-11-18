import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, switchMap, combineLatest, of, catchError, tap } from 'rxjs';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiChevron } from '@taiga-ui/kit/directives/chevron';
import { TuiDataListWrapper } from '@taiga-ui/kit/components/data-list-wrapper';
import { TuiPagination } from '@taiga-ui/kit/components/pagination';
import { TuiSelect } from '@taiga-ui/kit/components/select';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiInput } from '@taiga-ui/core/components/input';
import { TuiLoader } from '@taiga-ui/core/components/loader';
import { AccountsPage, PlatformApi } from '../../core/api/platform-api';
import { Icon } from '../../shared/components/icon';
import { PageHeader } from '../../shared/components/page-header';
import { PLAN_LABEL, STATE_LABEL, STATE_TONE, fd, fdt, nf } from './labels';

const PAGE = 25;

@Component({
  selector: 'app-platform-accounts',
  imports: [FormsModule, TuiAppearance, TuiBadge, TuiChevron, TuiDataListWrapper, TuiInput, TuiLoader, TuiPagination, TuiSelect, Icon, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Cuentas" sub="Consultas registradas, su plan y su estado" />

    <form class="pf-toolbar" role="search" (submit)="$event.preventDefault()">
      <tui-textfield class="grow">
        <label tuiLabel for="pf-q">Buscar por consulta o correo</label>
        <input id="pf-q" tuiInput type="search" autocomplete="off" [ngModel]="q()" (ngModelChange)="q.set($event ?? '')" name="q" />
      </tui-textfield>
      <tui-textfield tuiChevron class="fixed">
        <label tuiLabel for="pf-plan">Plan</label>
        <input id="pf-plan" tuiSelect name="plan" [ngModel]="planLabel()" (ngModelChange)="setPlan($event)" />
        <tui-data-list-wrapper *tuiDropdown new [items]="planItems" />
      </tui-textfield>
      <tui-textfield tuiChevron class="fixed">
        <label tuiLabel for="pf-status">Acceso</label>
        <input id="pf-status" tuiSelect name="status" [ngModel]="statusLabel()" (ngModelChange)="setStatus($event)" />
        <tui-data-list-wrapper *tuiDropdown new [items]="statusItems" />
      </tui-textfield>
    </form>

    @if (error()) { <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>No se pudo cargar.</strong><span>{{ error() }}</span></div></div> }

    <section class="pf-card pf-table-card" aria-label="Lista de cuentas">
      <tui-loader [loading]="loading()" [overlay]="true">
        <div class="table-wrap">
          <table class="table table--cards">
            <caption class="pf-sr">Cuentas de la plataforma</caption>
            <thead>
              <tr><th scope="col">Consulta</th><th scope="col">Plan</th><th scope="col">Estado</th><th scope="col" class="num">Pacientes</th><th scope="col">Alta</th></tr>
            </thead>
            <tbody>
              @for (a of items(); track a.id) {
                <tr class="link" tabindex="0" (click)="open(a.id)" (keydown.enter)="open(a.id)">
                  <td class="cell-main">
                    <span class="pf-name"><strong>{{ a.name }}</strong><small>{{ a.owner_email || 'Sin titular' }}</small></span>
                  </td>
                  <td data-label="Plan">
                    {{ plans[a.effective_plan] }}
                    @if (a.comped) { <span tuiBadge tuiAppearance="info" size="s">Cortesía</span> }
                    @if (a.effective_plan !== a.plan) { <small class="muted"> contrató {{ plans[a.plan] }}</small> }
                  </td>
                  <td data-label="Estado">
                    <span tuiBadge [tuiAppearance]="tone[a.state]" size="m">{{ states[a.state] }}</span>
                    @if (a.status === 'suspended') { <span tuiBadge tuiAppearance="negative" size="m">Suspendida</span> }
                  </td>
                  <td class="num" data-label="Pacientes">{{ nf(a.active_patients) }}</td>
                  <td data-label="Alta">{{ fd(a.created_at) }}</td>
                </tr>
              } @empty {
                @if (!loading()) { <tr><td colspan="5" class="pf-empty">No hay cuentas con esos filtros.</td></tr> }
              }
            </tbody>
          </table>
        </div>
        <div class="foot">
          <span>{{ range() }}</span>
          @if (pages() > 1) { <tui-pagination [length]="pages()" [index]="index()" (indexChange)="index.set($event)" /> }
        </div>
      </tui-loader>
    </section>
  `,
})
export class PlatformAccounts {
  protected readonly fd = fd; protected readonly fdt = fdt; protected readonly nf = nf;
  private readonly api = inject(PlatformApi);
  private readonly router = inject(Router);
  protected readonly q = signal('');
  protected readonly plan = signal('');
  protected readonly status = signal('');
  protected readonly index = signal(0);
  protected readonly page = signal<AccountsPage | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly plans = PLAN_LABEL;
  protected readonly states = STATE_LABEL;
  protected readonly tone = STATE_TONE;
  protected readonly planItems = ['Todos', 'Gratuito', 'Estándar', 'Pro'];
  protected readonly statusItems = ['Todos', 'Activas', 'Suspendidas'];
  private readonly planCodes: Record<string, string> = { Todos: '', Gratuito: 'free', Estándar: 'standard', Pro: 'pro' };
  private readonly statusCodes: Record<string, string> = { Todos: '', Activas: 'active', Suspendidas: 'suspended' };
  protected readonly planLabel = computed(() => this.planItems.find((l) => this.planCodes[l] === this.plan()) ?? 'Todos');
  protected readonly statusLabel = computed(() => this.statusItems.find((l) => this.statusCodes[l] === this.status()) ?? 'Todos');
  protected setPlan(label: string | null): void { this.plan.set(this.planCodes[label ?? 'Todos'] ?? ''); }
  protected setStatus(label: string | null): void { this.status.set(this.statusCodes[label ?? 'Todos'] ?? ''); }
  protected readonly items = computed(() => this.page()?.items ?? []);
  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.page()?.total ?? 0) / PAGE)));
  protected readonly range = computed(() => {
    const p = this.page();
    if (!p || p.total === 0) return '0 cuentas';
    return `${p.offset + 1}–${p.offset + p.items.length} de ${p.total}`;
  });

  constructor() {
    // La búsqueda espera a que termines de escribir; los filtros y la página consultan de inmediato.
    const q$ = toObservable(this.q).pipe(debounceTime(300), distinctUntilChanged());
    combineLatest([q$, toObservable(this.plan), toObservable(this.status), toObservable(this.index)])
      .pipe(
        tap(() => { this.loading.set(true); this.error.set(''); }),
        switchMap(([q, plan, status, i]) => this.api.accounts({ q, plan, status, limit: PAGE, offset: i * PAGE }).pipe(catchError((e: Error) => { this.error.set(e.message); return of(null); }))),
        takeUntilDestroyed(),
      )
      .subscribe((p) => { if (p) this.page.set(p); this.loading.set(false); });
    // Cambiar un filtro vuelve a la primera página.
    toObservable(this.q).pipe(distinctUntilChanged(), takeUntilDestroyed()).subscribe(() => this.index.set(0));
    toObservable(this.plan).pipe(takeUntilDestroyed()).subscribe(() => this.index.set(0));
    toObservable(this.status).pipe(takeUntilDestroyed()).subscribe(() => this.index.set(0));
  }

  protected open(id: string): void { void this.router.navigate(['/plataforma/cuentas', id]); }
}
