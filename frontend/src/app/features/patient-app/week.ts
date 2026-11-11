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
    .dot { inline-size: .75rem; block-size: .75rem; border-radius: 50%; border: 2px solid var(--muted); flex: none; } .dot.ok { background: var(--ok); border-color: var(--ok); } .dot.part { background: var(--nutri-mantequilla); border-color: var(--warn); }
    .body { padding: 0 var(--space-4) var(--space-4); display: grid; gap: var(--space-3); }
    ul { margin: 0; padding-inline-start: 1.1rem; }
  `,
  template: `
    @if (ctx.plan(); as plan) {
      <div class="stack">
        <h1 style="font-size: 1.5rem">Mi semana</h1>
        <div class="nav">
          <button type="button" class="icon-btn" aria-label="Semana anterior" [disabled]="start() <= plan.startDate" (click)="shift(-7)"><app-icon name="chevron-left" /></button>
          <strong>{{ range() }}</strong>
          <button type="button" class="icon-btn" aria-label="Semana siguiente" [disabled]="addDays(start(), 7) > plan.endDate" (click)="shift(7)"><app-icon name="chevron-right" /></button>
        </div>
        <p class="small muted" aria-live="polite">Cumplimiento de la semana: <strong>{{ weekPct() ?? '—' }}{{ weekPct() !== null ? '%' : '' }}</strong></p>
        @for (d of days(); track d.date) {
          <details [open]="d.date === ctx.today">
            <summary>
              <span class="dot" [class.ok]="d.state === 'ok'" [class.part]="d.state === 'part'" aria-hidden="true"></span>
              <span style="flex: 1"><strong>{{ longDate(d.date) }}</strong>@if (d.date === ctx.today) { <span class="badge badge--ok" style="margin-inline-start: .5rem">Hoy</span> }<br /><span class="small muted">{{ d.done }}/{{ d.total }} realizadas · {{ f(d.kcal) }} kcal</span></span>
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
        return { date, groups, total, done, kcal: String(kcal), state: total && done === total ? 'ok' : done ? 'part' : 'none' };
      });
  });

  protected shift(n: number): void { this.start.set(addDays(this.start(), n)); }
}
