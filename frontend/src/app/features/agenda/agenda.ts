import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AgendaService, AppointmentInput } from '../../core/services/agenda.service';
import { PatientsService } from '../../core/services/patients.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import {
  APPOINTMENT_KIND_LABEL, APPOINTMENT_MODE_LABEL, APPOINTMENT_STATUS_LABEL, Appointment, AppointmentStatus,
} from '../../shared/models/domain';
import { FieldError } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { Badge, EmptyState, Tone } from '../../shared/components/ui';
import { addDays, isoDay, longDate, parseIsoDate, startOfWeek, timeLabel, toIsoDate, todayIso } from '../../shared/utils/format';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const STATUS_TONE: Record<AppointmentStatus, Tone> = { scheduled: 'info', completed: 'ok', cancelled: 'neutral', no_show: 'warn' };

interface Cell { date: string; day: number; inMonth: boolean; isToday: boolean; count: number }

@Component({
  selector: 'app-agenda',
  imports: [ReactiveFormsModule, RouterLink, TuiButton, Icon, Modal, Badge, EmptyState, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .layout { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
    @media (max-width: 64rem) { .layout { grid-template-columns: minmax(0, 1fr); } }
    .month-nav { display: flex; align-items: center; gap: var(--space-2); }
    .month-nav h2 { flex: 1; text-align: center; font-size: 1.25rem; text-transform: capitalize; }
    .cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
    .cal .dow { text-align: center; font-size: .75rem; font-weight: 600; color: var(--muted); padding-block: .375rem; }
    .cal button.day { display: flex; flex-direction: column; align-items: flex-start; gap: .25rem; min-block-size: 4.25rem; padding: .375rem .5rem; border: 1px solid var(--line); border-radius: var(--radius-s, .5rem); background: var(--surface); color: inherit; cursor: pointer; font: inherit; text-align: start; }
    .cal button.day.out { opacity: .45; }
    .cal button.day.today .n { background: var(--nutri-texto-fuerte); color: var(--surface); }
    .cal button.day.sel { outline: 2px solid var(--nutri-texto-fuerte); outline-offset: 1px; }
    .cal .n { display: inline-grid; place-items: center; min-inline-size: 1.5rem; block-size: 1.5rem; border-radius: 999px; font-size: .8125rem; font-weight: 600; }
    .cal .cnt { font-size: .6875rem; font-weight: 600; padding: 0 .4rem; border-radius: 999px; background: var(--nutri-lavanda); }
    .appt { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr) auto; gap: var(--space-3); align-items: start; padding: var(--space-3) var(--space-4); border-block-end: 1px solid var(--line); }
    .appt:last-child { border-block-end: 0; }
    .appt .t { font-variant-numeric: tabular-nums; font-weight: 700; }
    .appt .who a { color: inherit; font-weight: 600; text-decoration: none; } .appt .who a:hover { text-decoration: underline; }
    .appt.off { opacity: .6; }
    .sync input { font-family: ui-monospace, monospace; font-size: .8125rem; }
    .sync ol { margin: 0; padding-inline-start: 1.25rem; display: grid; gap: .25rem; }
  `,
  template: `
    <div class="page">
      <header class="page-header">
        <div><h1>Consultas</h1><p class="sub">Agenda de citas con tus pacientes.</p></div>
        <div class="actions"><button tuiButton type="button" size="m" (click)="openNew()"><app-icon name="plus" [size]="18" /> Nueva consulta</button></div>
      </header>

      <div class="layout">
        <section class="panel" aria-label="Calendario">
          <div class="month-nav">
            <button type="button" class="icon-btn" aria-label="Mes anterior" (click)="shift(-1)"><app-icon name="chevron-left" /></button>
            <h2 aria-live="polite">{{ monthTitle() }}</h2>
            <button type="button" class="icon-btn" aria-label="Mes siguiente" (click)="shift(1)"><app-icon name="chevron-right" /></button>
            <button tuiButton type="button" size="s" appearance="secondary" (click)="goToday()">Hoy</button>
          </div>
          <div class="cal" role="grid" aria-label="Días del mes">
            @for (d of dows; track $index) { <span class="dow" role="columnheader">{{ d }}</span> }
            @for (c of cells(); track c.date) {
              <button type="button" class="day" role="gridcell" [class.out]="!c.inMonth" [class.today]="c.isToday" [class.sel]="c.date === selected()"
                [attr.aria-selected]="c.date === selected()" [attr.aria-label]="label(c)" (click)="selected.set(c.date)">
                <span class="n">{{ c.day }}</span>
                @if (c.count) { <span class="cnt">{{ c.count }} {{ c.count === 1 ? 'consulta' : 'consultas' }}</span> }
              </button>
            }
          </div>
        </section>

        <div class="stack">
          <section class="panel panel--flush" aria-labelledby="h-day">
            <div class="panel-head"><h2 id="h-day">{{ dayTitle() }}</h2><button tuiButton type="button" size="s" appearance="secondary" (click)="openNew()"><app-icon name="plus" [size]="16" /> Agendar</button></div>
            @for (a of dayItems(); track a.id) {
              <article class="appt" [class.off]="a.status === 'cancelled' || a.status === 'no_show'">
                <span class="t">{{ time(a.startsAt) }}<br /><span class="small muted">{{ time(a.endsAt) }}</span></span>
                <div class="who">
                  <a [routerLink]="['/pacientes', a.patientId]">{{ a.patientName }}</a>
                  <p class="small muted">{{ kindLabel[a.kind] }} · {{ modeLabel[a.mode] }}@if (a.place) { · {{ a.place }} }</p>
                  @if (a.notes) { <p class="small">{{ a.notes }}</p> }
                  @if (a.status !== 'scheduled') { <app-badge [tone]="tone[a.status]">{{ statusLabel[a.status] }}</app-badge> }
                </div>
                <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Editar consulta de ' + a.patientName" (click)="openEdit(a)"><app-icon name="edit" [size]="18" /></button>
              </article>
            } @empty {
              <div style="padding: var(--space-4)"><app-empty icon="calendar" title="Sin consultas este día" text="Elige otro día o agenda una consulta nueva." /></div>
            }
          </section>

          <section class="panel sync" aria-labelledby="h-sync">
            <div class="panel-head"><h2 id="h-sync">Sincronizar con tu calendario</h2></div>
            @if (agenda.apiMode) {
              <p class="small muted">Suscribe tu agenda en Google Calendar, Apple Calendar u Outlook con un enlace privado. Se actualiza sola.</p>
              @if (feed(); as url) {
                <div class="field"><label for="feed">Enlace privado (.ics)</label>
                  <div class="row"><input id="feed" class="input grow" readonly [value]="url" (focus)="$any($event.target).select()" />
                    <button tuiButton type="button" size="m" appearance="secondary" (click)="copy(url)"><app-icon name="copy" [size]="16" /> Copiar</button></div></div>
                <ol class="small">
                  <li>En Google Calendar abre <strong>Otros calendarios (+) → Desde URL</strong>.</li>
                  <li>Pega el enlace y pulsa <strong>Agregar calendario</strong>.</li>
                  <li>Google tarda de unas horas a un día en reflejar los cambios.</li>
                </ol>
                <div class="callout callout--warn"><app-icon name="lock" /><div class="callout-body">Quien tenga este enlace puede ver tus consultas (nombre del paciente y horario). No lo compartas; si se filtra, regéneralo.</div></div>
                <div class="form-actions"><button tuiButton type="button" size="s" appearance="secondary" (click)="rotate()">Regenerar enlace</button></div>
              } @else { <p class="small muted">Preparando el enlace…</p> }
            } @else {
              <p class="small muted">La sincronización con Google Calendar está disponible cuando la aplicación está conectada al servidor.</p>
            }
          </section>
        </div>
      </div>
    </div>

    <app-modal [(open)]="open" [title]="editing() ? 'Editar consulta' : 'Nueva consulta'">
      <form [formGroup]="form" id="appt-form" (ngSubmit)="save()" class="stack" novalidate>
        <div class="field"><label for="a-p">Paciente</label>
          <select id="a-p" class="select" formControlName="patientId" [attr.disabled]="editing() ? '' : null">
            <option value="">Elige un paciente…</option>
            @for (p of patientOptions(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
          </select><app-field-error [control]="form.controls.patientId" /></div>
        <div class="form-grid">
          <div class="field"><label for="a-d">Fecha</label><input id="a-d" class="input" type="date" formControlName="date" /><app-field-error [control]="form.controls.date" /></div>
          <div class="field"><label for="a-t">Hora</label><input id="a-t" class="input" type="time" formControlName="time" /><app-field-error [control]="form.controls.time" /></div>
          <div class="field"><label for="a-m">Duración (min)</label><input id="a-m" class="input" type="number" min="5" max="480" step="5" formControlName="minutes" /><app-field-error [control]="form.controls.minutes" [messages]="{ min: 'Mínimo 5 minutos.', max: 'Máximo 8 horas.' }" /></div>
          <div class="field"><label for="a-k">Tipo</label><select id="a-k" class="select" formControlName="kind">@for (k of kinds; track k[0]) { <option [value]="k[0]">{{ k[1] }}</option> }</select></div>
          <div class="field"><label for="a-mo">Modalidad</label><select id="a-mo" class="select" formControlName="mode">@for (k of modes; track k[0]) { <option [value]="k[0]">{{ k[1] }}</option> }</select></div>
          @if (editing()) { <div class="field"><label for="a-s">Estado</label><select id="a-s" class="select" formControlName="status">@for (k of statuses; track k[0]) { <option [value]="k[0]">{{ k[1] }}</option> }</select></div> }
        </div>
        <div class="field"><label for="a-pl">Lugar o enlace de la videollamada <span class="muted">opcional</span></label><input id="a-pl" class="input" formControlName="place" /></div>
        <div class="field"><label for="a-n">Notas internas <span class="muted">opcional · el paciente no las ve</span></label><textarea id="a-n" class="textarea" formControlName="notes"></textarea></div>
      </form>
      <ng-container modalFooter>
        <button tuiButton type="button" appearance="secondary" size="m" (click)="open.set(false)">Cancelar</button>
        <button tuiButton type="submit" form="appt-form" size="m" [disabled]="saving()">{{ editing() ? 'Guardar cambios' : 'Agendar consulta' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class Agenda {
  protected readonly agenda = inject(AgendaService);
  private readonly patients = inject(PatientsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);

  /** `?paciente=<id>` abre el alta con ese paciente ya elegido (viene del expediente). */
  readonly paciente = input<string>();

  protected readonly dows = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  protected readonly kindLabel = APPOINTMENT_KIND_LABEL;
  protected readonly modeLabel = APPOINTMENT_MODE_LABEL;
  protected readonly statusLabel = APPOINTMENT_STATUS_LABEL;
  protected readonly tone = STATUS_TONE;
  protected readonly kinds = Object.entries(APPOINTMENT_KIND_LABEL);
  protected readonly modes = Object.entries(APPOINTMENT_MODE_LABEL);
  protected readonly statuses = Object.entries(APPOINTMENT_STATUS_LABEL);
  protected readonly time = timeLabel;

  protected readonly month = signal(todayIso().slice(0, 8) + '01');
  protected readonly selected = signal(todayIso());
  protected readonly open = signal(false);
  protected readonly saving = signal(false);
  protected readonly editing = signal<Appointment | null>(null);
  protected readonly feed = signal<string | null>(null);

  protected readonly monthTitle = computed(() => { const d = parseIsoDate(this.month()); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; });
  private readonly gridStart = computed(() => startOfWeek(this.month(), 'mon'));
  protected readonly byDay = computed(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of [...this.agenda.items()].sort((x, y) => x.startsAt.localeCompare(y.startsAt))) {
      const k = isoDay(a.startsAt);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  });
  protected readonly cells = computed<Cell[]>(() => {
    const start = this.gridStart(), today = todayIso(), mo = this.month().slice(0, 7);
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(start, i);
      const count = (this.byDay().get(date) ?? []).filter((a) => a.status !== 'cancelled').length;
      return { date, day: Number(date.slice(8)), inMonth: date.startsWith(mo), isToday: date === today, count };
    });
  });
  protected readonly dayItems = computed(() => this.byDay().get(this.selected()) ?? []);
  protected readonly dayTitle = computed(() => (this.selected() === todayIso() ? 'Hoy · ' : '') + longDate(this.selected()));
  protected readonly patientOptions = computed(() =>
    this.patients.all().filter((p) => p.status !== 'inactive').map((p) => ({ id: p.id, name: this.patients.fullName(p) })).sort((a, b) => a.name.localeCompare(b.name)));

  protected readonly form = this.fb.nonNullable.group({
    patientId: ['', Validators.required],
    date: [todayIso(), Validators.required],
    time: ['09:00', Validators.required],
    minutes: [45, [Validators.required, Validators.min(5), Validators.max(480)]],
    kind: ['follow_up'],
    mode: ['in_person'],
    status: ['scheduled'],
    place: [''],
    notes: [''],
  });

  constructor() {
    this.patients.loadAll().subscribe({ error: () => undefined });
    // Se recargan las consultas al cambiar de mes; solo depende del mes visible.
    effect(() => {
      const from = parseIsoDate(this.gridStart());
      const to = parseIsoDate(addDays(this.gridStart(), 42));
      untracked(() => this.agenda.loadRange(from, to).subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar la agenda.') }));
    });
    if (this.agenda.apiMode) this.agenda.feedUrl().subscribe({ next: (u) => this.feed.set(u), error: () => undefined });
    let opened = false;
    effect(() => {
      const id = this.paciente();
      if (id && !opened) { opened = true; untracked(() => this.openNew(id)); }
    });
  }

  protected label(c: Cell): string {
    const d = parseIsoDate(c.date);
    return `${d.getDate()} de ${MONTHS[d.getMonth()]}: ${c.count ? c.count + (c.count === 1 ? ' consulta' : ' consultas') : 'sin consultas'}`;
  }

  protected shift(n: number): void {
    const d = parseIsoDate(this.month());
    d.setMonth(d.getMonth() + n, 1);
    this.month.set(toIsoDate(d));
    this.selected.set(toIsoDate(d) === todayIso().slice(0, 8) + '01' ? todayIso() : toIsoDate(d));
  }

  protected goToday(): void { this.month.set(todayIso().slice(0, 8) + '01'); this.selected.set(todayIso()); }

  protected openNew(patientId = ''): void {
    this.editing.set(null);
    this.form.reset({ patientId, date: this.selected(), time: '09:00', minutes: 45, kind: 'follow_up', mode: 'in_person', status: 'scheduled', place: '', notes: '' });
    this.open.set(true);
  }

  protected openEdit(a: Appointment): void {
    this.editing.set(a);
    const s = new Date(a.startsAt);
    this.form.reset({
      patientId: a.patientId, date: toIsoDate(s), time: timeLabel(a.startsAt), minutes: Math.round((Date.parse(a.endsAt) - s.getTime()) / 60000),
      kind: a.kind, mode: a.mode, status: a.status, place: a.place, notes: a.notes,
    });
    this.open.set(true);
  }

  protected save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const start = new Date(`${v.date}T${v.time}`);
    if (Number.isNaN(start.getTime())) { this.form.controls.date.setErrors({ invalid: true }); return; }
    const input: AppointmentInput = {
      patientId: v.patientId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + v.minutes * 60000).toISOString(),
      kind: v.kind as AppointmentInput['kind'], mode: v.mode as AppointmentInput['mode'], place: v.place.trim(), notes: v.notes.trim(),
      status: (this.editing() ? v.status : 'scheduled') as AppointmentStatus,
    };
    const cur = this.editing();
    this.saving.set(true);
    (cur ? this.agenda.update(cur.id, input) : this.agenda.create(input)).subscribe({
      next: (a) => {
        this.saving.set(false);
        this.open.set(false);
        this.toast.ok(cur ? 'Consulta actualizada.' : 'Consulta agendada.');
        this.selected.set(isoDay(a.startsAt));
        const first = this.month().slice(0, 7);
        if (!isoDay(a.startsAt).startsWith(first)) this.month.set(isoDay(a.startsAt).slice(0, 8) + '01');
        else this.agenda.loadRange(parseIsoDate(this.gridStart()), parseIsoDate(addDays(this.gridStart(), 42))).subscribe({ error: () => undefined });
      },
      error: (e: unknown) => { this.saving.set(false); this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar la consulta.'); },
    });
  }

  protected async copy(url: string): Promise<void> {
    try { await navigator.clipboard.writeText(url); this.toast.ok('Enlace copiado.'); } catch { this.toast.info('Selecciona el enlace y cópialo manualmente.'); }
  }

  protected async rotate(): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Regenerar enlace', message: 'El enlace actual dejará de funcionar y tendrás que volver a suscribirte con el nuevo en tu calendario.', confirmLabel: 'Regenerar', tone: 'danger' });
    if (!ok) return;
    this.agenda.rotateFeed().subscribe({ next: (u) => { this.feed.set(u); this.toast.ok('Enlace regenerado.'); }, error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo regenerar.') });
  }
}
