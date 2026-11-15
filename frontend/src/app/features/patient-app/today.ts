import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { TrackingService } from '../../core/services/tracking.service';
import { ToastService } from '../../core/services/ui.services';
import { Icon } from '../../shared/components/icon';
import { DishThumb } from '../../shared/components/nutrition-bits';
import { EmptyState, Skeleton } from '../../shared/components/ui';
import { PatientAppApi } from '../../core/api/patient-app-api';
import { addDays, fmtCompact, longDate, startOfWeek } from '../../shared/utils/format';
import { PatientContext, PatientItemVM } from './patient-context';
import { NextAppointment } from '../agenda/agenda-widgets';

@Component({
  selector: 'app-patient-today',
  imports: [RouterLink, TuiButton, Icon, DishThumb, EmptyState, Skeleton, NextAppointment],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: var(--space-4); }
    .day-nav { display: flex; align-items: center; gap: var(--space-2); }
    .day-nav h1 { flex: 1; font-size: 1.375rem; text-align: center; }
    .progress { display: grid; gap: var(--space-2); padding: var(--space-4) var(--space-5); border-radius: var(--radius-l); background: var(--surface); border: 1px solid var(--line); }
    .progress .big { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .progress.complete { background: var(--nutri-salvia); border-color: transparent; color: var(--nutri-texto-fuerte); }
    .slot h2, .next h2 { font-size: 1rem; font-family: var(--nutri-font-ui); font-weight: 600; color: var(--nutri-texto-fuerte); margin-block-end: var(--space-2); }
    .next { display: grid; gap: var(--space-2); }
    .next .card { grid-template-columns: 1fr; padding: 0; overflow: hidden; border-color: var(--brand-ink); border-width: 1.5px; box-shadow: var(--shadow-m); }
    .next .body { display: grid; gap: var(--space-3); padding: var(--space-4); }
    .next .name { font-size: 1.1875rem; }
    .card { display: grid; grid-template-columns: 5rem minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); }
    .name { font-weight: 600; color: var(--nutri-texto-fuerte); text-decoration: none; line-height: 1.25; } .name:hover { text-decoration: underline; }
    .acts { grid-column: 1 / -1; display: grid; grid-template-columns: 1.4fr 1fr; gap: var(--space-2); }
    .acts button { min-block-size: var(--tap); }
    .reply { display: inline-flex; gap: .25rem; align-items: center; padding: 0 .5rem; border-radius: 999px; background: var(--nutri-lavanda); font-size: .75rem; font-weight: 600; }
    details.logged { border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); }
    details.logged > summary { display: flex; align-items: center; gap: var(--space-2); min-block-size: var(--tap); padding: 0 var(--space-4); cursor: pointer; list-style: none; font-weight: 600; }
    details.logged > summary::-webkit-details-marker { display: none; }
    details.logged > summary .chev { margin-inline-start: auto; transition: rotate .15s ease; color: var(--muted); }
    details.logged[open] > summary .chev { rotate: 180deg; }
    .logged-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); border-block-start: 1px solid var(--line); }
    .logged-row .who { flex: 1; min-inline-size: 0; }
    .logged-row .who a { font-weight: 500; color: inherit; text-decoration: none; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .state { display: inline-flex; align-items: center; gap: .375rem; font-size: .8125rem; font-weight: 600; }
    .state.ok { color: var(--ok); } .state.skip { color: var(--warn); }
  `,
  template: `
    <app-next-appointment />
    @if (ctx.plan(); as plan) {
      <div class="stack">
        <div class="day-nav">
          <button type="button" class="icon-btn" aria-label="Día anterior" [disabled]="date() <= plan.startDate" (click)="go(-1)"><app-icon name="chevron-left" /></button>
          <h1>{{ title() }}</h1>
          <button type="button" class="icon-btn" aria-label="Día siguiente" [disabled]="date() >= plan.endDate" (click)="go(1)"><app-icon name="chevron-right" /></button>
        </div>

        @if (!isToday()) { <button tuiButton type="button" size="s" appearance="secondary" (click)="today()">Volver a hoy</button> }

        <section class="progress" [class.complete]="total() > 0 && done() === total()" aria-label="Avance del día">
          <p><span class="big">{{ done() }} de {{ total() }}</span> comidas realizadas</p>
          <div class="meter" role="img" [attr.aria-label]="dayPct() + '% del día completado'"><span [style.inline-size.%]="dayPct()"></span></div>
          <p class="small">@if (total() > 0 && done() === total()) { Listo por hoy. Gracias por registrar tus comidas. } @else if (total() > 0 && pendingCount() === 0) { Ya registraste todas tus comidas de hoy. Gracias. } @else { Semana: {{ week().pct ?? 0 }} % de cumplimiento }</p>
        </section>

        @if (note()) { <div class="callout callout--warn"><app-icon name="info" /><div class="callout-body"><strong>Indicación del día</strong><p>{{ note() }}</p></div></div> }

        @if (view().next; as nx) {
          <section class="next" aria-labelledby="h-next">
            <h2 id="h-next">Siguiente: {{ nx.slot.name }}</h2>
            <article class="card">
              <app-dish-thumb [category]="nx.vm.dish?.category ?? 'Comida'" [src]="nx.vm.version?.image?.dataUrl" [alt]="nx.vm.version?.image?.alt ?? ''" [size]="28" />
              <div class="body">
                <div>
                  <a class="name" [routerLink]="['/paciente/platillo', date(), nx.vm.item.id]">{{ nx.vm.dish?.name }}</a>
                  <p class="small muted">{{ f(nx.vm.totals.nutrients.energy) }} kcal@if (nx.vm.item.servings !== '1') { · {{ nx.vm.item.servings }} porciones } · <a [routerLink]="['/paciente/platillo', date(), nx.vm.item.id]">Ver preparación</a></p>
                </div>
                <div class="acts" role="group" [attr.aria-label]="'Registrar ' + nx.vm.dish?.name">
                  <button tuiButton type="button" size="l" [disabled]="!online()" (click)="mark(nx.vm, 'done')"><app-icon name="check" [size]="18" /> Marcar realizada</button>
                  <button tuiButton type="button" size="l" appearance="secondary" [disabled]="!online()" (click)="mark(nx.vm, 'skipped')">No la comí</button>
                </div>
              </div>
            </article>
          </section>
        }

        @for (g of view().rest; track g.slot.id) {
          <section class="slot" [attr.aria-labelledby]="'s-' + g.slot.id">
            <h2 [id]="'s-' + g.slot.id">{{ g.slot.name }}</h2>
            <div class="stack--s">
              @for (vm of g.items; track vm.item.id) {
                <article class="card">
                  <app-dish-thumb [category]="vm.dish?.category ?? 'Comida'" [src]="vm.version?.image?.dataUrl" [alt]="vm.version?.image?.alt ?? ''" [size]="24" />
                  <div>
                    <a class="name" [routerLink]="['/paciente/platillo', date(), vm.item.id]">{{ vm.dish?.name }}</a>
                    <p class="small muted">{{ f(vm.totals.nutrients.energy) }} kcal@if (vm.item.servings !== '1') { · {{ vm.item.servings }} porciones }</p>
                  </div>
                  <div class="acts" role="group" [attr.aria-label]="'Registrar ' + vm.dish?.name">
                    <button tuiButton type="button" size="m" [disabled]="!online()" (click)="mark(vm, 'done')"><app-icon name="check" [size]="18" /> Marcar realizada</button>
                    <button tuiButton type="button" size="m" appearance="secondary" [disabled]="!online()" (click)="mark(vm, 'skipped')">No la comí</button>
                  </div>
                </article>
              }
            </div>
          </section>
        }

        @if (view().logged.length) {
          <details class="logged" [open]="view().rest.length === 0 && !view().next">
            <summary><app-icon name="check-circle" [size]="18" /> Ya registradas ({{ view().logged.length }})<app-icon class="chev" name="chevron-down" [size]="18" /></summary>
            @for (r of view().logged; track r.vm.item.id) {
              <div class="logged-row">
                <div class="who">
                  <a [routerLink]="['/paciente/platillo', date(), r.vm.item.id]">{{ r.vm.dish?.name }}</a>
                  <span class="state" [class.ok]="r.vm.entry?.status === 'done'" [class.skip]="r.vm.entry?.status === 'skipped'">
                    <app-icon [name]="r.vm.entry?.status === 'done' ? 'check' : 'skip'" [size]="14" /> {{ r.slot.name }} · {{ r.vm.entry?.status === 'done' ? 'Realizada' : 'No la comí' }}
                    @if (r.vm.unreadReplies) { <span class="reply"><app-icon name="message" [size]="12" /> {{ r.vm.unreadReplies }}</span> }
                  </span>
                </div>
                <button type="button" class="link-btn small" [disabled]="!online()" (click)="undo(r.vm)">Deshacer</button>
              </div>
            }
          </details>
        }

        @if (!groups().length) { <app-empty icon="calendar" title="Sin comidas para este día" text="Tu nutrióloga aún no programó platillos para esta fecha." /> }

        @if (!online() && groups().length) { <p class="small muted" role="status">Sin conexión: puedes consultar tu menú, pero marcar comidas requiere conexión.</p> }
      </div>
    } @else if (loading()) {
      <app-skeleton [count]="5" height="4rem" />
    } @else {
      <app-empty icon="calendar" title="Aún no tienes un plan publicado" text="Cuando tu nutrióloga publique tu plan, lo verás aquí al instante." />
    }
  `,
})
export class PatientToday {
  protected readonly ctx = inject(PatientContext);
  protected readonly loading = inject(PatientAppApi).pending;
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
  protected readonly pendingCount = computed(() => this.groups().reduce((a, g) => a + g.items.filter((i) => !i.entry).length, 0));
  /** Lo siguiente por hacer (solo hoy), el resto pendiente por tiempo de comida y lo ya registrado plegado. */
  protected readonly view = computed(() => {
    const pendingGroups = this.groups().map((g) => ({ slot: g.slot, items: g.items.filter((i) => !i.entry) })).filter((g) => g.items.length);
    const logged = this.groups().flatMap((g) => g.items.filter((i) => i.entry).map((vm) => ({ slot: g.slot, vm })));
    let next: { slot: (typeof pendingGroups)[number]['slot']; vm: PatientItemVM } | null = null;
    let rest = pendingGroups;
    if (this.isToday() && pendingGroups.length) {
      next = { slot: pendingGroups[0].slot, vm: pendingGroups[0].items[0] };
      rest = pendingGroups.map((g, i) => (i === 0 ? { slot: g.slot, items: g.items.slice(1) } : g)).filter((g) => g.items.length);
    }
    return { next, rest, logged };
  });
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
    const previous = vm.entry?.status;
    this.tracking.record({ patientId: pid, plan: vm.plan, date: vm.date, slot: vm.slot, item: vm.item, status }).subscribe({
      next: () => this.toast.undoable(status === 'done' ? 'Marcada como realizada' : 'Anotada: no la comiste', () => this.restore(vm, previous)),
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar.'),
    });
  }

  /** «Deshacer» desde la lista de ya registradas. */
  protected undo(vm: PatientItemVM): void {
    this.tracking.clearRecord(vm.plan.id, vm.item.id).subscribe({
      next: () => this.toast.ok('Registro quitado. La comida vuelve a estar pendiente.'),
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo deshacer.'),
    });
  }

  /** Vuelve al estado anterior al toque: sin registro, o el estado que tenía. */
  private restore(vm: PatientItemVM, previous: 'done' | 'skipped' | undefined): void {
    const pid = this.auth.patientId();
    const op = previous && pid
      ? this.tracking.record({ patientId: pid, plan: vm.plan, date: vm.date, slot: vm.slot, item: vm.item, status: previous })
      : this.tracking.clearRecord(vm.plan.id, vm.item.id);
    op.subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo deshacer.') });
  }
}
