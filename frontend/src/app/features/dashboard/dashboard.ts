import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { InsightsService } from '../../core/services/insights.service';
import { PatientsService } from '../../core/services/patients.service';
import { ActionMenu, MenuItem } from '../../shared/components/action-menu';
import { Badge, EmptyState } from '../../shared/components/ui';
import { AlertRow } from '../../shared/components/ui';
import { Icon } from '../../shared/components/icon';
import { PageHeader } from '../../shared/components/page-header';
import { NutriAlert } from '../../shared/models/domain';
import { TodayAppointments } from '../agenda/agenda-widgets';
import { GettingStarted } from './getting-started';
import { formatDate, longDate, relativeTime, shortDate, todayIso } from '../../shared/utils/format';

interface AlertLine { level: NutriAlert['level']; title: string; reason: string; planId?: string; firstDate?: string; dates: string }
interface AlertGroup { patientId: string; name: string; critical: number; warning: number; lines: AlertLine[] }

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, Icon, Badge, EmptyState, AlertRow, TodayAppointments, GettingStarted, PageHeader, ActionMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .cols { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
    @media (max-width: 64rem) { .cols { grid-template-columns: minmax(0, 1fr); } }
    .strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr)); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-m); overflow: hidden; }
    .strip a { display: grid; gap: .125rem; align-content: start; padding: var(--space-4) var(--space-5); color: inherit; text-decoration: none; border-inline-end: 1px solid var(--line); }
    .strip a:last-child { border-inline-end: 0; }
    .strip a:hover { background: color-mix(in srgb, var(--nutri-lavanda) 35%, var(--surface)); }
    .strip .v { font-size: 1.75rem; font-weight: 600; line-height: 1.15; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .strip .l { font-size: .875rem; font-weight: 500; }
    .strip .n { font-size: .8125rem; color: var(--muted); }
    .strip .n.crit { color: var(--danger); font-weight: 600; }
    @media (max-width: 40rem) { .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } .strip a:nth-child(2n) { border-inline-end: 0; } .strip a:nth-child(-n + 2) { border-block-end: 1px solid var(--line); } }
    .who { display: grid; gap: .125rem; min-inline-size: 0; flex: 1; }
    .who a { color: inherit; font-weight: 600; text-decoration: none; } .who a:hover { text-decoration: underline; }
    .pct { font-variant-numeric: tabular-nums; font-weight: 700; min-inline-size: 3rem; text-align: end; }
    .grow-meter { flex: 1; min-inline-size: 5rem; }
    .act-icon { display: grid; place-items: center; inline-size: 2.25rem; block-size: 2.25rem; border-radius: 50%; flex: none; }
    details.grp { border-block-end: 1px solid var(--line); }
    details.grp:last-of-type { border-block-end: 0; }
    details.grp > summary { display: flex; align-items: center; gap: var(--space-3); min-block-size: 3.25rem; padding: 0 var(--space-5); cursor: pointer; list-style: none; }
    details.grp > summary::-webkit-details-marker { display: none; }
    details.grp > summary:hover { background: color-mix(in srgb, var(--nutri-marfil) 70%, var(--surface)); }
    details.grp > summary .chev { margin-inline-start: auto; transition: rotate .15s ease; color: var(--muted); }
    details.grp[open] > summary .chev { rotate: 180deg; }
    details.grp .body { padding: 0 var(--space-5) var(--space-3); display: grid; }
    details.grp .body > :not(:last-child) { border-block-end: 1px solid var(--line); }
    .review-text { margin: 0; color: var(--muted); font-size: .875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
  template: `
    <div class="page">
      <app-page-header [title]="greeting() + ', ' + firstName()" [sub]="today() + ' · Esto es lo que necesita tu atención hoy.'">
        <app-action-menu [primary]="true" text="Nuevo" icon="plus" label="Crear nuevo" [items]="newItems" align="end" />
      </app-page-header>

      <app-getting-started [state]="onboarding()" />

      @if (pending()) {
        <div class="grid grid--4" role="status" aria-busy="true" aria-label="Cargando resumen">
          @for (i of tiles; track i) { <span class="skeleton" style="block-size: 6.5rem; border-radius: var(--radius-m)"></span> }
        </div>
      } @else {
        <section aria-label="Resumen" class="strip">
          <a routerLink="/pacientes"><span class="v">{{ s().patients.active }}</span><span class="l">Pacientes activos</span><span class="n">{{ s().patients.invited }} con invitación pendiente</span></a>
          <a routerLink="/planes" [queryParams]="{ estado: 'published' }"><span class="v">{{ s().plans.published }}</span><span class="l">Planes publicados</span><span class="n">{{ s().plans.draft }} en borrador</span></a>
          <a routerLink="/reportes"><span class="v">{{ s().compliance.pct ?? '—' }}@if (s().compliance.pct !== null) { <small>%</small> }</span><span class="l">Cumplimiento, 7 días</span><span class="n">Comidas realizadas ÷ programadas</span></a>
          <a href="#alertas"><span class="v">{{ s().alerts.critical.length + s().alerts.warning.length }}</span><span class="l">Alertas activas</span>
            <span class="n" [class.crit]="s().alerts.critical.length > 0">@if (s().alerts.critical.length > 0) { <app-icon name="alert" [size]="12" /> }{{ s().alerts.critical.length }} críticas · {{ s().alerts.warning.length }} advertencias</span></a>
        </section>
      }

      <div class="cols">
        <div class="stack">
          <section class="panel panel--flush" aria-labelledby="h-rev">
            <div class="panel-head"><h2 id="h-rev">Por revisar</h2><a class="small" routerLink="/seguimiento">Ver seguimiento@if (s().toReview) { ({{ s().toReview }}) }</a></div>
            <ul class="list-plain list-rows">
              @for (e of toReview(); track e.id) {
                <li>
                  <span class="act-icon" [class]="e.status === 'done' ? 'tone-salvia' : 'tone-mantequilla'"><app-icon [name]="e.photos.length ? 'camera' : e.patientComment ? 'message' : e.status === 'done' ? 'check' : 'skip'" [size]="16" /></span>
                  <div class="who">
                    <span><a [routerLink]="['/pacientes', e.patientId]">{{ patientName(e.patientId) }}</a> · {{ e.status === 'done' ? 'realizó' : 'no realizó' }} {{ e.slotName.toLowerCase() }}</span>
                    <span class="review-text">{{ e.dishName }} · {{ rel(e.recordedAt) }}@if (e.patientComment) { · «{{ e.patientComment }}» }</span>
                  </div>
                  <a class="small" routerLink="/seguimiento">Revisar</a>
                </li>
              } @empty { <li><span class="muted"><app-icon name="check-circle" [size]="16" /> Todo al día: no hay registros pendientes de revisar.</span></li> }
            </ul>
          </section>

          <section class="panel panel--flush" id="alertas" aria-labelledby="h-alertas">
            <div class="panel-head"><h2 id="h-alertas">Alertas nutricionales</h2><span class="small muted">Apoyan tu revisión; no bloquean la publicación.</span></div>
            @for (g of alertGroups(); track g.patientId; let first = $first) {
              <details class="grp" [open]="first && g.critical > 0">
                <summary>
                  <span class="avatar" aria-hidden="true">{{ g.name[0] }}</span>
                  <span class="who"><strong>{{ g.name }}</strong><span class="small muted">{{ g.lines.length }} {{ g.lines.length === 1 ? 'alerta por atender' : 'alertas por atender' }}</span></span>
                  @if (g.critical) { <app-badge tone="crit" icon="alert">{{ g.critical }} {{ g.critical === 1 ? 'crítica' : 'críticas' }}</app-badge> }
                  @if (g.warning) { <app-badge tone="warn" icon="alert-circle">{{ g.warning }}</app-badge> }
                  <app-icon class="chev" name="chevron-down" [size]="18" />
                </summary>
                <div class="body">
                  @for (l of g.lines; track $index) { <app-alert-row [level]="l.level" [title]="l.title" [reason]="l.reason" [dates]="l.dates" [planId]="l.planId" [firstDate]="l.firstDate" /> }
                  <p class="small"><a [routerLink]="['/pacientes', g.patientId]">Abrir expediente</a></p>
                </div>
              </details>
            } @empty {
              <app-empty icon="check-circle" title="Sin alertas por ahora" text="Los planes vigentes están dentro de tus reglas y umbrales." />
            }
            @if (hiddenPatients() > 0) { <p class="small muted p-3-5">Hay alertas en {{ hiddenPatients() }} paciente(s) más. Revisa cada plan para verlas.</p> }
          </section>
        </div>

        <div class="stack">
          <app-today-appointments />

          @if (s().plans.endingSoon.length || s().patients.consentPending) {
            <section class="panel" aria-labelledby="h-dec">
              <div class="panel-head"><h2 id="h-dec">Requiere una decisión</h2></div>
              @for (p of s().plans.endingSoon; track p.id) {
                <div class="callout callout--warn"><app-icon name="clock" /><div class="callout-body"><p><a [routerLink]="['/planes', p.id]">{{ p.name }}</a></p><p class="small">Termina el {{ fd(p.endDate) }}. Decide si crear el siguiente plan.</p></div></div>
              }
              @if (s().patients.consentPending) {
                <div class="callout callout--warn"><app-icon name="lock" /><div class="callout-body"><p><strong>{{ s().patients.consentPending }} paciente(s)</strong> sin consentimiento completo.</p><a class="small" routerLink="/pacientes">Revisar pacientes</a></div></div>
              }
            </section>
          }

          <section class="panel panel--flush" aria-labelledby="h-comp">
            <div class="panel-head"><h2 id="h-comp">Cumplimiento por paciente</h2><a class="small" routerLink="/reportes">Ver reportes</a></div>
            <ul class="list-plain list-rows">
              @for (r of s().compliance.perPatient; track r.patient.id) {
                <li>
                  <div class="who"><a [routerLink]="['/pacientes', r.patient.id]">{{ r.name }}</a><span class="small muted">{{ r.result.done }} de {{ r.result.planned }} comidas</span></div>
                  <div class="meter grow-meter" role="img" [attr.aria-label]="'Cumplimiento ' + (r.result.pct ?? 0) + '%'"><span [style.inline-size.%]="r.result.pct ?? 0"></span></div>
                  <span class="pct">{{ r.result.pct ?? '—' }}%</span>
                  @if ((r.result.pct ?? 100) < 60) { <app-badge tone="warn" icon="alert-circle">Bajo</app-badge> }
                </li>
              } @empty { <li><span class="muted">Aún no hay planes publicados con seguimiento.</span></li> }
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

  protected readonly newItems: MenuItem[] = [
    { label: 'Paciente', icon: 'user-plus', link: '/pacientes/nuevo' },
    { label: 'Plan alimentario', icon: 'calendar', link: '/planes/nuevo' },
    { label: 'Platillo', icon: 'dish', link: '/platillos/nuevo' },
  ];

  protected readonly pending = this.insights.dashboardPending;
  protected readonly tiles = [1, 2, 3, 4];
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

  protected readonly toReview = computed(() => this.s().activity.filter((e) => e.needsReview).slice(0, 5));

  /**
   * Alertas por paciente, sin repeticiones: la misma alerta en varios días del plan se junta en una sola línea
   * con la lista de fechas. Los pacientes con críticas van primero.
   */
  private readonly allGroups = computed<AlertGroup[]>(() => {
    const byPatient = new Map<string, Map<string, NutriAlert[]>>();
    for (const a of this.s().alerts.all) {
      const key = `${a.level}|${a.kind}|${a.title}`;
      const m = byPatient.get(a.patientId) ?? new Map<string, NutriAlert[]>();
      m.set(key, [...(m.get(key) ?? []), a]);
      byPatient.set(a.patientId, m);
    }
    const groups: AlertGroup[] = [];
    for (const [patientId, m] of byPatient) {
      const lines: AlertLine[] = [...m.values()].map((list) => {
        const dates = [...new Set(list.map((x) => x.date).filter((d): d is string => !!d))].sort();
        const shown = dates.slice(0, 3).map((d) => shortDate(d)).join(', ');
        return {
          level: list[0].level, title: list[0].title, reason: list[0].reason, planId: list[0].planId, firstDate: dates[0],
          dates: dates.length ? (dates.length > 3 ? `${shown} y ${dates.length - 3} día(s) más` : shown) : '',
        };
      });
      const rank = { critical: 0, warning: 1, info: 2 } as const;
      lines.sort((a, b) => rank[a.level] - rank[b.level]);
      // El tablero cuenta críticas y advertencias; las informativas se ven dentro del plan.
      const relevant = lines.filter((l) => l.level !== 'info');
      if (!relevant.length) continue;
      groups.push({ patientId, name: this.patientName(patientId), critical: relevant.filter((l) => l.level === 'critical').length, warning: relevant.filter((l) => l.level === 'warning').length, lines: relevant });
    }
    return groups.sort((a, b) => b.critical - a.critical || b.warning - a.warning || a.name.localeCompare(b.name, 'es'));
  });
  protected readonly alertGroups = computed(() => this.allGroups().slice(0, 5));
  protected readonly hiddenPatients = computed(() => Math.max(0, this.allGroups().length - 5));

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
