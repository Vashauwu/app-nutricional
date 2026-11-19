import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, switchMap, catchError, of, tap, combineLatest } from 'rxjs';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TuiDay } from '@taiga-ui/cdk/date-time';
import { TuiInputDate } from '@taiga-ui/kit/components/input-date';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiChevron } from '@taiga-ui/kit/directives/chevron';
import { TuiDataListWrapper } from '@taiga-ui/kit/components/data-list-wrapper';
import { TuiInput } from '@taiga-ui/core/components/input';
import { TuiPagination } from '@taiga-ui/kit/components/pagination';
import { TuiSelect } from '@taiga-ui/kit/components/select';
import { TuiSkeleton } from '@taiga-ui/kit/directives/skeleton';
import { ActivityCategory, ActivityPage, ActivityRow, PlatformApi } from '../../core/api/platform-api';
import { Icon } from '../../shared/components/icon';
import { PfHead } from './head';
import { ACTIVITY_TONE, CATEGORY_LABEL, auditLabel, categoryOf, fdt } from './labels';

const PAGE = 25;
const CATEGORY_ITEMS = ['Todas', 'Accesos', 'Cobros', 'Plataforma'];
const CATEGORY_CODE: Record<string, ActivityCategory> = { Todas: '', Accesos: 'auth', Cobros: 'billing', Plataforma: 'platform' };
const day = (v: string): TuiDay | null => { const [y, m, d] = v.split('-').map(Number); return y && m && d ? new TuiDay(y, m - 1, d) : null; };
const categoryLabel = (code: string) => CATEGORY_ITEMS.find((l) => CATEGORY_CODE[l] === code) ?? 'Todas';

/**
 * Bitácora global de la plataforma: accesos, cobros y operación de todas las consultas en un solo lugar, filtrable. Solo muestra
 * eventos operativos (el servidor no entrega nada clínico). Desde la ficha de una cuenta se llega con ?cuenta=<id>.
 */
@Component({
  selector: 'app-platform-activity',
  imports: [FormsModule, RouterLink, TuiAppearance, TuiBadge, TuiButton, TuiChevron, TuiDataListWrapper, TuiInput, TuiInputDate, TuiPagination, TuiSelect, TuiSkeleton, Icon, PfHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-pf-head title="Actividad" sub="Accesos, cobros y operación de todas las cuentas. Nunca incluye datos clínicos." />

    <form class="pf-toolbar" role="search" (submit)="$event.preventDefault()">
      <tui-textfield class="grow" [tuiTextfieldCleaner]="true">
        <label tuiLabel for="ac-q">Buscar por evento, consulta o correo</label>
        <input id="ac-q" tuiInput type="search" autocomplete="off" name="q" [ngModel]="q()" (ngModelChange)="q.set($event ?? '')" />
      </tui-textfield>
      <tui-textfield tuiChevron class="fixed" [tuiTextfieldCleaner]="false">
        <label tuiLabel for="ac-cat">Tipo</label>
        <input id="ac-cat" tuiSelect name="categoria" [ngModel]="catLabel()" (ngModelChange)="category.set(catCode[$event ?? 'Todas'] ?? '')" />
        <tui-data-list-wrapper *tuiDropdown new [items]="catItems" />
      </tui-textfield>
      <tui-textfield class="fixed" [tuiTextfieldCleaner]="true">
        <label tuiLabel for="ac-from">Desde</label>
        <input id="ac-from" tuiInputDate name="desde" [max]="toDay() ?? today" [ngModel]="fromDay()" (ngModelChange)="from.set(iso($event))" />
        <tui-calendar *tuiDropdown />
      </tui-textfield>
      <tui-textfield class="fixed" [tuiTextfieldCleaner]="true">
        <label tuiLabel for="ac-to">Hasta</label>
        <input id="ac-to" tuiInputDate name="hasta" [min]="fromDay()" [max]="today" [ngModel]="toDay()" (ngModelChange)="to.set(iso($event))" />
        <tui-calendar *tuiDropdown />
      </tui-textfield>
    </form>

    @if (cuenta()) {
      <p class="pf-filterchip">
        <span tuiBadge tuiAppearance="info" size="m">Solo una cuenta</span>
        <button tuiButton appearance="flat" size="s" type="button" (click)="clearAccount()">Quitar este filtro</button>
      </p>
    }

    @if (error()) {
      <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>No se pudo cargar la actividad.</strong><span>{{ error() }}</span><span><button tuiButton appearance="secondary" size="s" type="button" (click)="reload.set(reload() + 1)">Reintentar</button></span></div></div>
    }

    <div class="pf-table-wrap" [attr.aria-busy]="loading()">
      <table class="pf-table pf-table--cards">
        <caption class="pf-sr">Actividad de la plataforma, de lo más reciente a lo más antiguo</caption>
        <thead><tr><th scope="col">Cuándo</th><th scope="col">Evento</th><th scope="col">Consulta</th><th scope="col">Quién</th><th scope="col">Detalle</th></tr></thead>
        <tbody>
          @if (loading() && !page()) {
            @for (i of [1, 2, 3, 4, 5, 6]; track i) { <tr aria-hidden="true"><td colspan="5"><span [tuiSkeleton]="true">Evento de ejemplo de la plataforma</span></td></tr> }
          }
          @for (a of items(); track a.id) {
            <tr>
              <td data-label="Cuándo" class="pf-muted nowrap">{{ fdt(a.occurred_at) }}</td>
              <td class="main">
                <strong>{{ label(a.action) }}</strong>
                <span tuiBadge [tuiAppearance]="tone[cat(a.action)] ?? 'neutral'" size="s">{{ categories[cat(a.action)] ?? cat(a.action) }}</span>
              </td>
              <td data-label="Consulta">
                @if (a.practice_id) { <a class="pf-link" [routerLink]="['/plataforma/cuentas', a.practice_id]">{{ a.practice_name || 'Ver cuenta' }}</a> } @else { <span class="pf-muted">—</span> }
              </td>
              <td data-label="Quién" class="pf-muted">{{ who(a) }}</td>
              <td data-label="Detalle">{{ detail(a) }}</td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="5" class="pf-empty" style="text-align:center">{{ filtered() ? 'Ningún evento coincide con los filtros.' : 'Todavía no hay actividad.' }}</td></tr> }
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
export class PlatformActivity {
  private readonly api = inject(PlatformApi);
  private readonly destroy = inject(DestroyRef);
  /** Llega por la dirección (?cuenta=<id>) desde la ficha de una cuenta. */
  readonly cuentaQ = input('', { alias: 'cuenta' });
  protected readonly cuenta = signal('');
  protected readonly q = signal('');
  protected readonly category = signal<ActivityCategory>('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly index = signal(0);
  protected readonly reload = signal(0);
  protected readonly page = signal<ActivityPage | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly catItems = CATEGORY_ITEMS;
  protected readonly catCode = CATEGORY_CODE;
  protected readonly categories = CATEGORY_LABEL;
  protected readonly tone = ACTIVITY_TONE;
  protected readonly label = auditLabel;
  protected readonly cat = categoryOf;
  protected readonly fdt = fdt;
  /** Las fechas viajan al servidor como AAAA-MM-DD; el selector trabaja con días de Taiga. */
  protected readonly today = TuiDay.currentLocal();
  protected readonly fromDay = computed(() => day(this.from()));
  protected readonly toDay = computed(() => day(this.to()));
  protected iso(d: TuiDay | null): string { return d ? d.toString('yyyy/mm/dd', '-') : ''; }
  protected readonly catLabel = computed(() => categoryLabel(this.category()));
  protected readonly items = computed(() => this.page()?.items ?? []);
  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.page()?.total ?? 0) / PAGE)));
  protected readonly filtered = computed(() => !!(this.q() || this.category() || this.from() || this.to() || this.cuenta()));
  protected readonly range = computed(() => {
    const p = this.page();
    if (!p) return 'Cargando…';
    if (p.total === 0) return '0 eventos';
    return `${p.offset + 1}–${p.offset + p.items.length} de ${p.total} eventos`;
  });

  protected who(a: ActivityRow): string { return a.actor || (typeof a.metadata?.['by'] === 'string' ? (a.metadata['by'] as string) : 'Sistema'); }

  /** Lo más útil de los metadatos en una línea: motivo, error o el cambio de plan. Nunca vuelca el objeto completo. */
  protected detail(a: ActivityRow): string {
    const m = a.metadata ?? {};
    const parts: string[] = [];
    for (const k of ['reason', 'error', 'plan', 'ends_at']) { const v = m[k]; if (typeof v === 'string' && v) parts.push(k === 'reason' ? `«${v}»` : k === 'error' ? `Error: ${v}` : v); }
    if (typeof m['amount_mxn'] === 'number') parts.push(`$${m['amount_mxn']}`);
    if (m['self_approval'] === true) parts.push('autoaprobación');
    return parts.join(' · ') || '—';
  }

  protected clearAccount(): void { this.cuenta.set(''); }

  constructor() {
    queueMicrotask(() => { const c = this.cuentaQ(); if (c) this.cuenta.set(c); });
    // Igual que en Cuentas: el texto espera a que termines de escribir; los demás filtros consultan al instante y vuelven a la primera página.
    const q$ = toObservable(this.q).pipe(debounceTime(300), distinctUntilChanged());
    const filters$ = combineLatest([q$, toObservable(this.category), toObservable(this.from), toObservable(this.to), toObservable(this.cuenta)]);
    filters$.pipe(takeUntilDestroyed(this.destroy)).subscribe(() => this.index.set(0));
    combineLatest([filters$, toObservable(this.index), toObservable(this.reload)])
      .pipe(
        debounceTime(0),
        tap(() => { this.loading.set(true); this.error.set(''); }),
        switchMap(([[q, category, from, to, practice], i]) =>
          this.api.activity({ q, category, practice, from, to, limit: PAGE, offset: i * PAGE }).pipe(catchError((e: Error) => { this.error.set(e.message); return of(null); }))),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe((p) => { if (p) this.page.set(p); this.loading.set(false); });
  }
}
