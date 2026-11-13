import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { InsightsService } from '../../core/services/insights.service';
import { PatientsService } from '../../core/services/patients.service';
import { AlertItem, Badge, EmptyState } from '../../shared/components/ui';
import { Icon } from '../../shared/components/icon';
import { TodayAppointments } from '../agenda/agenda-widgets';
import { GettingStarted } from './getting-started';
import { formatDate, longDate, relativeTime, todayIso } from '../../shared/utils/format';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, TuiButton, Icon, AlertItem, Badge, EmptyState, TodayAppointments, GettingStarted],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .cols { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
    @media (max-width: 64rem) { .cols { grid-template-columns: minmax(0, 1fr); } }
    .who { display: grid; gap: .125rem; min-inline-size: 0; flex: 1; }
    .who a { color: inherit; font-weight: 600; text-decoration: none; } .who a:hover { text-decoration: underline; }
    .pct { font-variant-numeric: tabular-nums; font-weight: 700; min-inline-size: 3rem; text-align: end; }
    .grow-meter { flex: 1; min-inline-size: 5rem; }
    .act-icon { display: grid; place-items: center; inline-size: 2.25rem; block-size: 2.25rem; border-radius: 50%; flex: none; }
  `,
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <p class="eyebrow">{{ today() }}</p>
          <h1>{{ greeting() }}, {{ firstName() }}</h1>
          <p class="sub">Esto es lo que necesita tu atención hoy.</p>
        </div>
        <div class="actions">
          <a tuiButton routerLink="/pacientes/nuevo" size="m"><app-icon name="user-plus" [size]="18" /> Crear paciente</a>
          <a tuiButton routerLink="/platillos/nuevo" size="m" appearance="secondary"><app-icon name="dish" [size]="18" /> Crear platillo</a>
          <a tuiButton routerLink="/planes/nuevo" size="m" appearance="secondary"><app-icon name="calendar" [size]="18" /> Crear plan</a>
        </div>
      </header>

      <app-getting-started [state]="onboarding()" />

      <section aria-label="Resumen" class="grid grid--4">
        <a class="stat tone-lavanda" routerLink="/pacientes"><span class="value">{{ s().patients.active }}</span><span class="label">Pacientes activos</span><span class="small">{{ s().patients.invited }} con invitación pendiente</span></a>
        <a class="stat tone-salvia" routerLink="/planes" [queryParams]="{ estado: 'published' }"><span class="value">{{ s().plans.published }}</span><span class="label">Planes publicados</span><span class="small">{{ s().plans.draft }} en borrador</span></a>
        <a class="stat tone-cielo" routerLink="/reportes"><span class="value">{{ s().compliance.pct ?? '—' }}@if (s().compliance.pct !== null) {<small>%</small>}</span><span class="label">Cumplimiento, últimos 7 días</span><span class="small">Comidas realizadas ÷ programadas</span></a>
        <a class="stat" [class]="s().alerts.critical.length ? 'stat tone-rosa' : 'stat tone-mantequilla'" href="#alertas"><span class="value">{{ s().alerts.critical.length + s().alerts.warning.length }}</span><span class="label">Alertas activas</span><span class="small">{{ s().alerts.critical.length }} críticas · {{ s().alerts.warning.length }} advertencias</span></a>
      </section>

      <div class="cols">
        <div class="stack">
          <section class="panel" id="alertas" aria-labelledby="h-alertas">
            <div class="panel-head"><h2 id="h-alertas">Alertas nutricionales</h2><span class="small muted">Apoyan tu revisión; no bloquean la publicación.</span></div>
            @for (a of topAlerts(); track a.id) {
              <app-alert-item [alert]="a" />
              <p class="small" style="margin-block-start: -.5rem"><a [routerLink]="['/pacientes', a.patientId]">{{ patientName(a.patientId) }}</a></p>
            } @empty {
              <app-empty icon="check-circle" title="Sin alertas por ahora" text="Los planes vigentes están dentro de tus reglas y umbrales." />
            }
            @if (s().alerts.all.length > 5) { <p class="small muted">Mostrando 5 de {{ s().alerts.all.length }}. Revisa cada plan para ver el resto.</p> }
          </section>

          <section class="panel panel--flush" aria-labelledby="h-comp">
            <div class="panel-head"><h2 id="h-comp">Cumplimiento por paciente</h2><a class="small" routerLink="/reportes">Ver reportes</a></div>
            <ul class="list-plain list-rows">
              @for (r of s().compliance.perPatient; track r.patient.id) {
                <li>
                  <span class="avatar" aria-hidden="true">{{ r.name[0] }}</span>
                  <div class="who"><a [routerLink]="['/pacientes', r.patient.id]">{{ r.name }}</a><span class="small muted">{{ r.result.done }} de {{ r.result.planned }} comidas</span></div>
                  <div class="meter grow-meter" role="img" [attr.aria-label]="'Cumplimiento ' + (r.result.pct ?? 0) + '%'"><span [style.inline-size.%]="r.result.pct ?? 0"></span></div>
                  <span class="pct">{{ r.result.pct ?? '—' }}%</span>
                  @if ((r.result.pct ?? 100) < 60) { <app-badge tone="warn" icon="alert-circle">Bajo</app-badge> }
                </li>
              } @empty { <li><span class="muted">Aún no hay planes publicados con seguimiento.</span></li> }
            </ul>
          </section>
        </div>

        <div class="stack">
          <app-today-appointments />
          <section class="panel" aria-labelledby="h-planes">
            <div class="panel-head"><h2 id="h-planes">Estado de planes</h2><a class="small" routerLink="/planes">Ver todos</a></div>
            <div class="row">
              <a routerLink="/planes" [queryParams]="{ estado: 'draft' }"><app-badge tone="warn">{{ s().plans.draft }} borrador</app-badge></a>
              <a routerLink="/planes" [queryParams]="{ estado: 'published' }"><app-badge tone="ok">{{ s().plans.published }} publicados</app-badge></a>
              <a routerLink="/planes" [queryParams]="{ estado: 'finished' }"><app-badge tone="info">{{ s().plans.finished }} finalizados</app-badge></a>
              <a routerLink="/planes" [queryParams]="{ estado: 'archived' }"><app-badge>{{ s().plans.archived }} archivados</app-badge></a>
            </div>
            @for (p of s().plans.endingSoon; track p.id) {
              <div class="callout callout--warn"><app-icon name="clock" /><div class="callout-body"><p><a [routerLink]="['/planes', p.id]">{{ p.name }}</a></p><p class="small">Termina el {{ fd(p.endDate) }}. Decide si crear el siguiente plan.</p></div></div>
            }
            @if (s().patients.consentPending) {
              <div class="callout callout--warn"><app-icon name="lock" /><div class="callout-body"><p><strong>{{ s().patients.consentPending }} paciente(s)</strong> sin consentimiento completo.</p><a class="small" routerLink="/pacientes">Revisar pacientes</a></div></div>
            }
          </section>

          <section class="panel panel--flush" aria-labelledby="h-act">
            <div class="panel-head">
              <h2 id="h-act">Actividad reciente</h2>
              <a class="small" routerLink="/seguimiento">Ver todo @if (s().toReview) { ({{ s().toReview }} por revisar) }</a>
            </div>
            <ul class="list-plain list-rows">
              @for (e of s().activity; track e.id) {
                <li>
                  <span class="act-icon" [class]="e.status === 'done' ? 'tone-salvia' : 'tone-mantequilla'"><app-icon [name]="e.photos.length ? 'camera' : e.patientComment ? 'message' : e.status === 'done' ? 'check' : 'skip'" [size]="16" /></span>
                  <div class="who">
                    <span><a [routerLink]="['/pacientes', e.patientId]">{{ patientName(e.patientId) }}</a> · {{ e.status === 'done' ? 'realizó' : 'omitió' }} {{ e.slotName.toLowerCase() }}</span>
                    <span class="small muted">{{ e.dishName }} · {{ rel(e.recordedAt) }}@if (e.patientComment) { · "{{ e.patientComment }}" }</span>
                  </div>
                  @if (e.needsReview) { <app-badge tone="accent">Nuevo</app-badge> }
                </li>
              } @empty { <li><span class="muted">Sin actividad todavía.</span></li> }
            </ul>
          </section>
        </div>
      </div>
    </div>
  `,
})
export class Dashboard {
  private readonly insights = inject(InsightsService);
  private readonly data = inject(DbService);
  private readonly patients = inject(PatientsService);
  protected readonly auth = inject(AuthService);

  protected readonly s = computed(() => {
    this.data.version();
    return this.insights.dashboard();
  });
  /** Guía de primeros pasos: cada paso se da por hecho con datos que ya tiene el tablero. */
  protected readonly onboarding = computed(() => {
    const b = this.data.db().settings.brand;
    const p = this.s().plans;
    return {
      profileDone: !!(b.phone?.trim() || b.email?.trim()),
      hasPatient: this.s().patients.active + this.s().patients.invited > 0,
      hasPlan: p.draft + p.published + p.finished + p.archived > 0,
    };
  });
  protected readonly topAlerts = computed(() => this.s().alerts.all.slice(0, 5));
  constructor() {
    // Modo API: el tablero se calcula en el servidor.
    this.insights.loadDashboard().subscribe({ error: () => undefined });
  }

  protected readonly firstName = computed(() => (this.auth.user()?.name ?? '').replace(/^Lic\.\s*/, '').split(' ')[0]);
  protected readonly today = computed(() => longDate(todayIso()));
  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  });
  protected readonly fd = formatDate;
  protected readonly rel = relativeTime;
  protected patientName = (id: string): string => {
    const p = this.patients.get(id);
    return p ? this.patients.fullName(p) : '—';
  };
}
