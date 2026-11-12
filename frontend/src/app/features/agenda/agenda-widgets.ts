import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AgendaService } from '../../core/services/agenda.service';
import { APPOINTMENT_KIND_LABEL, APPOINTMENT_MODE_LABEL } from '../../shared/models/domain';
import { Icon } from '../../shared/components/icon';
import { Badge } from '../../shared/components/ui';
import { isoDay, longDate, timeLabel, todayIso } from '../../shared/utils/format';

/** «Tu próxima consulta» en la app del paciente. No ocupa espacio si no hay ninguna. */
@Component({
  selector: 'app-next-appointment',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .next { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-l); background: var(--nutri-lavanda); color: var(--nutri-texto-fuerte); }
    .next .ic { display: grid; place-items: center; inline-size: 2.5rem; block-size: 2.5rem; border-radius: 50%; background: var(--surface); flex: none; }
    .next p { margin: 0; } .next .t { font-weight: 700; }
  `,
  template: `
    @if (next(); as a) {
      <section class="next" aria-label="Próxima consulta">
        <span class="ic" aria-hidden="true"><app-icon name="calendar" /></span>
        <div>
          <p class="small">{{ isToday() ? 'Tu consulta es hoy' : 'Tu próxima consulta' }}</p>
          <p class="t">{{ when() }}, {{ time(a.startsAt) }}</p>
          <p class="small">{{ kind[a.kind] }} · {{ mode[a.mode] }}@if (a.place) { · {{ a.place }} }</p>
        </div>
      </section>
    }
  `,
})
export class NextAppointment {
  private readonly agenda = inject(AgendaService);
  protected readonly kind = APPOINTMENT_KIND_LABEL;
  protected readonly mode = APPOINTMENT_MODE_LABEL;
  protected readonly time = timeLabel;

  protected readonly next = computed(() => {
    const now = Date.now();
    return this.agenda.mine().filter((a) => a.status === 'scheduled' && Date.parse(a.endsAt) >= now).sort((x, y) => x.startsAt.localeCompare(y.startsAt))[0];
  });
  protected readonly isToday = computed(() => (this.next() ? isoDay(this.next()!.startsAt) === todayIso() : false));
  protected readonly when = computed(() => (this.isToday() ? 'Hoy' : longDate(isoDay(this.next()!.startsAt))));

  constructor() {
    this.agenda.loadMine().subscribe({ error: () => undefined });
  }
}

/** «Consultas de hoy» en el inicio de la nutrióloga. */
@Component({
  selector: 'app-today-appointments',
  imports: [RouterLink, Icon, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .row { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; padding: var(--space-3) var(--space-4); border-block-end: 1px solid var(--line); }
    .row:last-child { border-block-end: 0; } .t { font-variant-numeric: tabular-nums; font-weight: 700; }
    .row a { color: inherit; font-weight: 600; text-decoration: none; } .row a:hover { text-decoration: underline; }
  `,
  template: `
    <section class="panel panel--flush" aria-labelledby="h-hoy">
      <div class="panel-head"><h2 id="h-hoy">Consultas de hoy</h2><a class="small" routerLink="/consultas">Ver calendario completo</a></div>
      @for (a of today(); track a.id) {
        <div class="row">
          <span class="t">{{ time(a.startsAt) }}</span>
          <div><a [routerLink]="['/pacientes', a.patientId]">{{ a.patientName }}</a><p class="small muted">{{ kind[a.kind] }} · {{ mode[a.mode] }}@if (a.place) { · {{ a.place }} }</p></div>
          @if (a.status === 'completed') { <app-badge tone="ok" icon="check">Realizada</app-badge> }
        </div>
      } @empty {
        <p class="small muted" style="padding: var(--space-4)"><app-icon name="calendar" [size]="16" /> No tienes consultas programadas para hoy.</p>
      }
    </section>
  `,
})
export class TodayAppointments {
  private readonly agenda = inject(AgendaService);
  protected readonly kind = APPOINTMENT_KIND_LABEL;
  protected readonly mode = APPOINTMENT_MODE_LABEL;
  protected readonly time = timeLabel;
  protected readonly today = computed(() =>
    this.agenda.items().filter((a) => isoDay(a.startsAt) === todayIso() && ['scheduled', 'completed'].includes(a.status)).sort((x, y) => x.startsAt.localeCompare(y.startsAt)));

  constructor() {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    this.agenda.loadRange(from, to).subscribe({ error: () => undefined });
  }
}
