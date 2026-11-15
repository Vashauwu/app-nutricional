import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { Icon } from '../../shared/components/icon';
import { EmptyState } from '../../shared/components/ui';
import { addDays, fmtCompact, longDate, startOfWeek } from '../../shared/utils/format';
import { PatientContext } from './patient-context';

@Component({
  selector: 'app-patient-week',
  imports: [RouterLink, TuiButton, Icon, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .nav { display: flex; align-items: center; gap: var(--space-2); } .nav strong { flex: 1; text-align: center; }
    details { border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); }
    details[open] { border-color: var(--brand-primary); }
    summary { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); min-block-size: 3.5rem; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    .st { display: inline-grid; place-items: center; inline-size: 1.75rem; block-size: 1.75rem; border-radius: 50%; flex: none; border: 1.5px solid var(--muted); color: var(--muted); }
    .st.ok { background: var(--nutri-salvia); border-color: var(--ok); color: var(--ok); } .st.part { background: var(--nutri-mantequilla); border-color: var(--warn); color: var(--warn); }
    .side { min-inline-size: 0; }
    .preview { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--nutri-texto-fuerte); }
    .body { padding: 0 var(--space-4) var(--space-4); display: grid; gap: var(--space-3); }
    ul { margin: 0; padding-inline-start: 1.1rem; }
  `,
  template: `
    @if (ctx.plan(); as plan) {
      <div class="stack">
        <h1 class="t-lg">Mi semana</h1>
        <div class="nav">
          <button type="button" class="icon-btn" aria-label="Semana anterior" [disabled]="start() <= plan.startDate" (click)="shift(-7)"><app-icon name="chevron-left" /></button>
          <strong>{{ range() }}</strong>
          <button type="button" class="icon-btn" aria-label="Semana siguiente" [disabled]="addDays(start(), 7) > plan.endDate" (click)="shift(7)"><app-icon name="chevron-right" /></button>
        </div>
        <p class="small muted" aria-live="polite">Cumplimiento de la semana: <strong>{{ weekPct() ?? '—' }}{{ weekPct() !== null ? '%' : '' }}</strong></p>
        @for (d of days(); track d.date) {
          <details [open]="d.date === ctx.today">
            <summary>
              <span class="st" [class.ok]="d.state === 'ok'" [class.part]="d.state === 'part'" aria-hidden="true"><app-icon [name]="d.state === 'ok' ? 'check' : d.state === 'part' ? 'minus' : 'clock'" [size]="14" /></span>
              <span class="grow-1 side"><strong>{{ longDate(d.date) }}</strong>@if (d.date === ctx.today) { <span class="badge badge--ok u-ms-2">Hoy</span> }<br /><span class="small"><span class="count">{{ d.done }}/{{ d.total }}</span> <span class="muted">{{ d.state === 'ok' ? 'completo' : d.state === 'part' ? 'en progreso' : 'pendiente' }} · {{ f(d.kcal) }} kcal</span></span><span class="small muted preview">{{ d.preview }}</span></span>
              <app-icon name="chevron-down" [size]="18" />
            </summary>
            <div class="body">
              @for (g of d.groups; track g.slot.id) { <div><strong class="small">{{ g.slot.name }}</strong><ul>@for (vm of g.items; track vm.item.id) { <li><a [routerLink]="['/paciente/platillo', d.date, vm.item.id]">{{ vm.dish?.name }}</a></li> }</ul></div> } @empty { <p class="muted">Sin comidas programadas.</p> }
              <a tuiButton size="s" appearance="secondary" routerLink="/paciente" [queryParams]="{ fecha: d.date }">Abrir este día</a>
            </div>
          </details>
        }
      </div>
    } @else { <app-empty icon="calendar" title="Aún no tienes un plan publicado" /> }
  `,
})
export class PatientWeek {
  protected readonly ctx = inject(PatientContext);
  private readonly data = inject(DbService);
  protected readonly f = (v: string): string => fmtCompact(v);
  protected readonly addDays = addDays;
  protected readonly longDate = longDate;
  protected readonly start = signal(startOfWeek(this.ctx.today));
  protected readonly range = computed(() => `${longDate(this.start()).split(' ').slice(1).join(' ')} – ${longDate(addDays(this.start(), 6)).split(' ').slice(1).join(' ')}`);
  protected readonly weekPct = computed(() => (this.data.version(), this.ctx.compliance(this.start(), addDays(this.start(), 6)).pct));
  protected readonly days = computed(() => {
    this.data.version();
    return Array.from({ length: 7 }, (_, i) => addDays(this.start(), i))
      .filter((date) => !!this.ctx.day(date))
      .map((date) => {
        const groups = this.ctx.items(date);
        const total = groups.reduce((a, g) => a + g.items.length, 0);
        const done = groups.reduce((a, g) => a + g.items.filter((i) => i.entry?.status === 'done').length, 0);
        const kcal = groups.reduce((a, g) => a + g.items.reduce((s, i) => s + Number(i.totals.nutrients.energy), 0), 0);
        const preview = groups.flatMap((g) => g.items.map((i) => i.dish?.name ?? '')).filter(Boolean).slice(0, 3).join(' · ');
        return { date, groups, total, done, kcal: String(kcal), preview, state: total && done === total ? 'ok' : done ? 'part' : 'none' };
      });
  });

  protected shift(n: number): void { this.start.set(addDays(this.start(), n)); }
}
