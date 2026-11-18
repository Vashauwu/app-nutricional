import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, switchMap, catchError, of, tap, combineLatest } from 'rxjs';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiChevron } from '@taiga-ui/kit/directives/chevron';
import { TuiDataListWrapper } from '@taiga-ui/kit/components/data-list-wrapper';
import { TuiInput } from '@taiga-ui/core/components/input';
import { TuiPagination } from '@taiga-ui/kit/components/pagination';
import { TuiSelect } from '@taiga-ui/kit/components/select';
import { TuiSkeleton } from '@taiga-ui/kit/directives/skeleton';
import { AccountsPage, PlatformApi } from '../../core/api/platform-api';
import { Icon } from '../../shared/components/icon';
import { PfHead } from './head';
import { PLAN_LABEL, STATE_LABEL, STATE_TONE, fd, nf, when } from './labels';

const PAGE = 25;
const PLAN_ITEMS = ['Todos', 'Gratuito', 'Estándar', 'Pro'];
const PLAN_CODE: Record<string, string> = { Todos: '', Gratuito: 'free', Estándar: 'standard', Pro: 'pro' };
const ACCESS_ITEMS = ['Todos', 'Activas', 'Suspendidas'];
const ACCESS_CODE: Record<string, string> = { Todos: '', Activas: 'active', Suspendidas: 'suspended' };
const label = (items: string[], codes: Record<string, string>, code: string) => items.find((l) => codes[l] === code) ?? 'Todos';

@Component({
  selector: 'app-platform-accounts',
  imports: [FormsModule, RouterLink, TuiAppearance, TuiBadge, TuiButton, TuiChevron, TuiDataListWrapper, TuiInput, TuiPagination, TuiSelect, TuiSkeleton, Icon, PfHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-pf-head title="Cuentas" sub="Cada consulta con su plan, su estado y cuándo vence lo vigente" />

    <form class="pf-toolbar" role="search" (submit)="$event.preventDefault()">
      <tui-textfield class="grow" [tuiTextfieldCleaner]="true">
        <label tuiLabel for="pf-q">Buscar por consulta o correo</label>
        <input id="pf-q" tuiInput type="search" autocomplete="off" [ngModel]="q()" (ngModelChange)="q.set($event ?? '')" name="q" />
      </tui-textfield>
      <tui-textfield tuiChevron class="fixed" [tuiTextfieldCleaner]="false">
        <label tuiLabel for="pf-plan">Plan</label>
        <input id="pf-plan" tuiSelect name="plan" [ngModel]="planLabel()" (ngModelChange)="plan.set(planCode[$event ?? 'Todos'] ?? '')" />
        <tui-data-list-wrapper *tuiDropdown new [items]="planItems" />
      </tui-textfield>
      <tui-textfield tuiChevron class="fixed" [tuiTextfieldCleaner]="false">
        <label tuiLabel for="pf-acc">Acceso</label>
        <input id="pf-acc" tuiSelect name="acceso" [ngModel]="accessLabel()" (ngModelChange)="status.set(accessCode[$event ?? 'Todos'] ?? '')" />
        <tui-data-list-wrapper *tuiDropdown new [items]="accessItems" />
      </tui-textfield>
    </form>

    @if (error()) {
      <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>No se pudo cargar la lista.</strong><span>{{ error() }}</span><span><button tuiButton appearance="secondary" size="s" type="button" (click)="reload.set(reload() + 1)">Reintentar</button></span></div></div>
    }

    <div class="pf-table-wrap" [attr.aria-busy]="loading()">
      <table class="pf-table pf-table--cards">
        <caption class="pf-sr">Cuentas de la plataforma</caption>
        <thead><tr><th scope="col">Consulta</th><th scope="col">Plan</th><th scope="col">Estado</th><th scope="col">Vence</th><th scope="col" class="num">Pacientes</th><th scope="col">Alta</th><th scope="col"><span class="pf-sr">Abrir</span></th></tr></thead>
        <tbody>
          @if (loading() && !page()) {
            @for (i of [1, 2, 3, 4, 5, 6]; track i) { <tr aria-hidden="true"><td colspan="7"><span [tuiSkeleton]="true">Consulta de ejemplo con nombre largo</span></td></tr> }
          }
          @for (a of items(); track a.id) {
            <tr>
              <td class="main">
                <a class="rowlink" [routerLink]="['/plataforma/cuentas', a.id]">{{ a.name }}</a>
                <span class="sub">{{ a.owner_email || 'Sin titular registrado' }}</span>
              </td>
              <td data-label="Plan">
                {{ plans[a.effective_plan] }}
                @if (a.comped) { <span tuiBadge tuiAppearance="info" size="s">Cortesía</span> }
                @if (a.effective_plan !== a.plan) { <span class="sub">contrató {{ plans[a.plan] }}</span> }
              </td>
              <td data-label="Estado">
                @if (a.status === 'suspended') { <span tuiBadge tuiAppearance="negative" size="m">Suspendida</span> }
                @else if (a.state !== 'free') { <span tuiBadge [tuiAppearance]="tone[a.state]" size="m">{{ states[a.state] }}</span> }
                @else { <span class="pf-muted">—</span> }
              </td>
              <td data-label="Vence" [class.urgent]="!a.comped && vence(a).urgent" [attr.title]="a.ends_at ? fd(a.ends_at) : null">{{ vence(a).text }}</td>
              <td data-label="Pacientes" class="num">{{ nf(a.active_patients) }}</td>
              <td data-label="Alta" class="pf-muted">{{ fd(a.created_at) }}</td>
              <td class="go"><app-icon name="chevron-right" [size]="16" /></td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="7" class="pf-empty" style="text-align:center">{{ filtered() ? 'Ninguna cuenta coincide con la búsqueda.' : 'Todavía no hay cuentas.' }}</td></tr> }
          }
        </tbody>
      </table>
    </div>

    <p class="pf-count" aria-live="polite">
      <span>{{ range() }}</span>
      @if (pages() > 1) { <tui-pagination [length]="pages()" [index]="index()" (indexChange)="index.set($event)" /> }
    </p>
  `,
})
export class PlatformAccounts {
  private readonly api = inject(PlatformApi);
  private readonly destroy = inject(DestroyRef);
  /** Filtros que llegan por la dirección (p. ej. desde el resumen: ?acceso=suspended). */
  readonly acceso = input('');
  readonly planQ = input('', { alias: 'plan' });
  protected readonly q = signal('');
  protected readonly plan = signal('');
  protected readonly status = signal('');
  protected readonly index = signal(0);
  protected readonly reload = signal(0);
  protected readonly page = signal<AccountsPage | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly plans = PLAN_LABEL;
  protected readonly states = STATE_LABEL;
  protected readonly tone = STATE_TONE;
  protected readonly planItems = PLAN_ITEMS;
  protected readonly accessItems = ACCESS_ITEMS;
  protected readonly planCode = PLAN_CODE;
  protected readonly accessCode = ACCESS_CODE;
  protected readonly fd = fd;
  protected readonly nf = nf;
  protected readonly planLabel = computed(() => label(PLAN_ITEMS, PLAN_CODE, this.plan()));
  protected readonly accessLabel = computed(() => label(ACCESS_ITEMS, ACCESS_CODE, this.status()));
  protected readonly items = computed(() => this.page()?.items ?? []);
  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.page()?.total ?? 0) / PAGE)));
  protected readonly filtered = computed(() => !!(this.q() || this.plan() || this.status()));
  protected readonly range = computed(() => {
    const p = this.page();
    if (!p) return 'Cargando…';
    if (p.total === 0) return '0 cuentas';
    return `${p.offset + 1}–${p.offset + p.items.length} de ${p.total} cuentas`;
  });

  /** Lo que vence: fin de la prueba, de la gracia, renovación o fin del acceso. Las cuentas con cortesía sin fecha no vencen. */
  protected vence(a: AccountsPage['items'][number]): { text: string; urgent: boolean } {
    if (a.state === 'free' && !a.comped) return { text: '—', urgent: false };
    return when(a.ends_at);
  }

  constructor() {
    effect(() => { const s = this.acceso(); const p = this.planQ(); untracked(() => { if (s) this.status.set(s); if (p) this.plan.set(p); }); });
    // La búsqueda espera a que termines de escribir; los filtros consultan al instante. Cualquier cambio de filtro vuelve a la primera página.
    const q$ = toObservable(this.q).pipe(debounceTime(300), distinctUntilChanged());
    const filters$ = combineLatest([q$, toObservable(this.plan), toObservable(this.status)]);
    filters$.pipe(takeUntilDestroyed(this.destroy)).subscribe(() => this.index.set(0));
    combineLatest([filters$, toObservable(this.index), toObservable(this.reload)])
      .pipe(
        debounceTime(0),
        tap(() => { this.loading.set(true); this.error.set(''); }),
        switchMap(([[q, plan, status], i]) => this.api.accounts({ q, plan, status, limit: PAGE, offset: i * PAGE }).pipe(catchError((e: Error) => { this.error.set(e.message); return of(null); }))),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe((p) => { if (p) this.page.set(p); this.loading.set(false); });
  }
}
