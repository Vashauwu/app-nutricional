import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { TrackingService } from '../../core/services/tracking.service';
import { ToastService } from '../../core/services/ui.services';
import { Icon } from '../../shared/components/icon';
import { Ring } from '../../shared/components/charts';
import { DishThumb } from '../../shared/components/nutrition-bits';
import { EmptyState } from '../../shared/components/ui';
import { addDays, fmtCompact, longDate, startOfWeek } from '../../shared/utils/format';
import { PatientContext, PatientItemVM } from './patient-context';

@Component({
  selector: 'app-patient-today',
  imports: [RouterLink, TuiButton, Icon, Ring, DishThumb, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .day-nav { display: flex; align-items: center; gap: var(--space-2); }
    .day-nav h1 { flex: 1; font-size: 1.375rem; text-align: center; }
    .hero { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-4) var(--space-5); border-radius: var(--radius-l); background: var(--nutri-salvia); color: var(--nutri-texto-fuerte); }
    .slot h2 { font-size: .8125rem; font-family: var(--nutri-font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-block-end: var(--space-2); }
    .card { display: grid; grid-template-columns: 5rem minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); }
    .card.done { border-color: var(--ok); } .card.skipped { background: var(--nutri-mantequilla); }
    .name { font-weight: 600; color: var(--nutri-texto-fuerte); text-decoration: none; line-height: 1.25; } .name:hover { text-decoration: underline; }
    .acts { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
    .acts button { min-block-size: var(--tap); }
    .reply { display: inline-flex; gap: .25rem; align-items: center; padding: 0 .5rem; border-radius: 999px; background: var(--nutri-lavanda); font-size: .75rem; font-weight: 600; }
  `,
  template: `
    @if (ctx.plan(); as plan) {
      <div class="stack">
        <div class="day-nav">
          <button type="button" class="icon-btn" aria-label="Día anterior" [disabled]="date() <= plan.startDate" (click)="go(-1)"><app-icon name="chevron-left" /></button>
          <h1>{{ title() }}</h1>
          <button type="button" class="icon-btn" aria-label="Día siguiente" [disabled]="date() >= plan.endDate" (click)="go(1)"><app-icon name="chevron-right" /></button>
        </div>

        @if (!isToday()) { <button tuiButton type="button" size="s" appearance="secondary" (click)="today()">Volver a hoy</button> }

        <section class="hero" aria-label="Avance del día">
          <app-ring [pct]="dayPct()" label="hoy" [size]="92" />
          <div><p><strong>{{ done() }} de {{ total() }}</strong> comidas realizadas</p><p class="small">Semana: {{ week().pct ?? 0 }} % de cumplimiento</p></div>
        </section>

        @if (note()) { <div class="callout callout--warn"><app-icon name="info" /><div class="callout-body"><strong>Indicación del día</strong><p>{{ note() }}</p></div></div> }

        @for (g of groups(); track g.slot.id) {
          <section class="slot" [attr.aria-labelledby]="'s-' + g.slot.id">
            <h2 [id]="'s-' + g.slot.id">{{ g.slot.name }}</h2>
            <div class="stack--s">
              @for (vm of g.items; track vm.item.id) {
                <article class="card" [class.done]="vm.entry?.status === 'done'" [class.skipped]="vm.entry?.status === 'skipped'">
                  <app-dish-thumb [category]="vm.dish?.category ?? 'Comida'" [src]="vm.version?.image?.dataUrl" [alt]="vm.version?.image?.alt ?? ''" [size]="24" />
                  <div>
                    <a class="name" [routerLink]="['/paciente/platillo', date(), vm.item.id]">{{ vm.dish?.name }}</a>
                    <p class="small muted">{{ f(vm.totals.nutrients.energy) }} kcal@if (vm.item.servings !== '1') { · {{ vm.item.servings }} porciones }</p>
                    @if (vm.entry) { <p class="small"><strong>{{ vm.entry.status === 'done' ? 'Realizada' : 'Omitida' }}</strong>@if (vm.unreadReplies) { <span class="reply"><app-icon name="message" [size]="12" /> {{ vm.unreadReplies }} respuesta(s)</span> }</p> }
                  </div>
                  <div class="acts" role="group" [attr.aria-label]="'Registrar ' + vm.dish?.name">
                    <button tuiButton type="button" size="m" [appearance]="vm.entry?.status === 'done' ? 'primary' : 'secondary'" [attr.aria-pressed]="vm.entry?.status === 'done'" [disabled]="!online()" (click)="mark(vm, 'done')"><app-icon name="check" [size]="18" /> Realizada</button>
                    <button tuiButton type="button" size="m" [appearance]="vm.entry?.status === 'skipped' ? 'primary' : 'secondary'" [attr.aria-pressed]="vm.entry?.status === 'skipped'" [disabled]="!online()" (click)="mark(vm, 'skipped')"><app-icon name="skip" [size]="18" /> Omitida</button>
                  </div>
                </article>
              }
            </div>
          </section>
        } @empty { <app-empty icon="calendar" title="Sin comidas para este día" text="Tu nutrióloga aún no programó platillos para esta fecha." /> }

        @if (!online() && groups().length) { <p class="small muted" role="status">Sin conexión: puedes consultar tu menú, pero marcar comidas requiere conexión.</p> }
      </div>
    } @else {
      <app-empty icon="calendar" title="Aún no tienes un plan publicado" text="Cuando tu nutrióloga publique tu plan, lo verás aquí al instante." />
    }
  `,
})
export class PatientToday {
  protected readonly ctx = inject(PatientContext);
  private readonly auth = inject(AuthService);
  private readonly data = inject(DbService);
  private readonly tracking = inject(TrackingService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly fecha = input<string>();
  protected readonly f = (v: string): string => fmtCompact(v);
  protected readonly online = this.data.isOnline;
  protected readonly date = computed(() => {
    const plan = this.ctx.plan();
    const wanted = this.fecha() ?? this.ctx.today;
    if (!plan) return wanted;
    return wanted < plan.startDate ? plan.startDate : wanted > plan.endDate ? plan.endDate : wanted;
  });
  protected readonly isToday = computed(() => this.date() === this.ctx.today);
  protected readonly title = computed(() => (this.isToday() ? 'Hoy' : longDate(this.date())));
  protected readonly groups = computed(() => (this.data.version(), this.ctx.items(this.date())));
  protected readonly note = computed(() => this.ctx.day(this.date())?.notes ?? '');
  protected readonly total = computed(() => this.groups().reduce((a, g) => a + g.items.length, 0));
  protected readonly done = computed(() => this.groups().reduce((a, g) => a + g.items.filter((i) => i.entry?.status === 'done').length, 0));
  protected readonly dayPct = computed(() => (this.total() ? Math.round((this.done() / this.total()) * 100) : 0));
  protected readonly week = computed(() => {
    this.data.version();
    const s = startOfWeek(this.date());
    return this.ctx.compliance(s, addDays(s, 6));
  });

  protected go(dir: -1 | 1): void { void this.router.navigate([], { queryParams: { fecha: addDays(this.date(), dir) } }); }
  protected today(): void { void this.router.navigate([], { queryParams: { fecha: null } }); }

  protected mark(vm: PatientItemVM, status: 'done' | 'skipped'): void {
    const pid = this.auth.patientId();
    if (!pid) return;
    const op = vm.entry?.status === status
      ? this.tracking.clearRecord(vm.plan.id, vm.item.id)
      : this.tracking.record({ patientId: pid, plan: vm.plan, date: vm.date, slot: vm.slot, item: vm.item, status });
    op.subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar.') });
  }
}
