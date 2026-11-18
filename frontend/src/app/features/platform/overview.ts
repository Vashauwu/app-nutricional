import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiProgressBar } from '@taiga-ui/kit/components/progress';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiLoader } from '@taiga-ui/core/components/loader';
import { Overview, PlatformApi, SubState } from '../../core/api/platform-api';
import { formatBytes } from '../../shared/utils/format';
import { Icon } from '../../shared/components/icon';
import { LineChart, LineSeries } from '../../shared/components/charts';
import { PageHeader } from '../../shared/components/page-header';
import { PAYMENT_LABEL, PAYMENT_TONE, PLAN_LABEL, STATE_LABEL, STATE_TONE, delta, mxn, pct, fd, fdt, nf } from './labels';

const STATES: SubState[] = ['active', 'trialing', 'past_due', 'canceled', 'expired', 'free'];

@Component({
  selector: 'app-platform-overview',
  imports: [RouterLink, TuiAppearance, TuiBadge, TuiButton, TuiLoader, TuiProgressBar, Icon, LineChart, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Resumen" [sub]="updated()">
      <button tuiButton appearance="secondary" size="m" type="button" (click)="load()" [disabled]="loading()"><app-icon name="refresh" [size]="16" /> Actualizar</button>
    </app-page-header>

    @if (error()) {
      <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>No se pudo cargar el resumen.</strong><span>{{ error() }}</span></div></div>
    }

    <tui-loader [loading]="loading() && !o()" [overlay]="true">
      @if (o(); as d) {
        <section class="pf-grid pf-kpis" aria-label="Indicadores">
          <article class="pf-card pf-kpi">
            <span class="label">Cuentas</span>
            <span class="value">{{ nf(d.accounts) }}</span>
            <span class="note">{{ d.suspended }} suspendida{{ d.suspended === 1 ? '' : 's' }} · {{ d.comped }} con cortesía</span>
          </article>
          <article class="pf-card pf-kpi">
            <span class="label">Ingreso mensual estimado</span>
            <span class="value">{{ money(d.mrr_mxn) }}</span>
            <span class="note">{{ d.paying_accounts }} cuenta{{ d.paying_accounts === 1 ? '' : 's' }} que pagan · precio de lista</span>
          </article>
          <article class="pf-card pf-kpi">
            <span class="label">Altas (30 días)</span>
            <span class="value">{{ nf(d.signups_30d) }}</span>
            <span class="note">{{ dlt(d.signups_30d, d.signups_prev_30d) }}</span>
          </article>
          <article class="pf-card pf-kpi" [class.warn]="d.trials_ending_soon > 0">
            <span class="label">Pruebas activas</span>
            <span class="value">{{ d.by_state.trialing ?? 0 }}</span>
            <span class="note">{{ d.trials_ending_soon }} termina{{ d.trials_ending_soon === 1 ? '' : 'n' }} en 7 días</span>
          </article>
          <article class="pf-card pf-kpi" [class.crit]="(d.by_state.past_due ?? 0) > 0">
            <span class="label">Cobros fallidos</span>
            <span class="value">{{ d.by_state.past_due ?? 0 }}</span>
            <span class="note">cuentas en gracia · {{ d.payments_30d.failed_count }} intento{{ d.payments_30d.failed_count === 1 ? '' : 's' }} fallido{{ d.payments_30d.failed_count === 1 ? '' : 's' }} en 30 días</span>
          </article>
          <article class="pf-card pf-kpi" [class.warn]="d.pending_actions > 0">
            <span class="label">Por aprobar</span>
            <span class="value">{{ d.pending_actions }}</span>
            <span class="note"><a routerLink="/plataforma/aprobaciones">Ver solicitudes</a></span>
          </article>
        </section>

        <section class="pf-grid pf-two">
          <article class="pf-card">
            <div class="head"><h2>Altas por día</h2><span class="sub">Últimos 30 días · hora de la Ciudad de México</span></div>
            <app-line-chart [series]="signups()" [yMin]="0" [yMax]="signupsMax()" title="Altas de cuentas por día" />
          </article>
          <article class="pf-card">
            <div class="head"><h2>Cuentas por plan</h2><span class="sub">Plan vigente</span></div>
            <ul class="pf-rows">
              @for (p of plans(); track p.code) {
                <li class="pf-row">
                  <span>{{ p.label }}</span>
                  <progress tuiProgressBar size="m" [value]="p.n" [max]="d.accounts || 1"></progress>
                  <span class="n">{{ p.n }} · {{ p.pct }}%</span>
                </li>
              }
            </ul>
            <h2>Suscripciones por estado</h2>
            <ul class="pf-rows">
              @for (s of states(); track s.code) {
                <li class="pf-row">
                  <span><span tuiBadge [tuiAppearance]="s.tone" size="s">{{ s.label }}</span></span>
                  <progress tuiProgressBar size="s" [value]="s.n" [max]="d.accounts || 1"></progress>
                  <span class="n">{{ s.n }}</span>
                </li>
              }
            </ul>
          </article>
        </section>

        <section class="pf-grid pf-even">
          <article class="pf-card">
            <div class="head"><h2>Requieren atención</h2><span class="sub">Cobro fallido o prueba por vencer</span></div>
            @if (d.attention.length) {
              <ul class="pf-list">
                @for (a of d.attention; track a.id) {
                  <li>
                    <span class="who">
                      <a [routerLink]="['/plataforma/cuentas', a.id]">{{ a.name }}</a>
                      <small>{{ a.owner_email }}</small>
                    </span>
                    <span class="who" style="text-align:end">
                      <span tuiBadge [tuiAppearance]="a.reason === 'past_due' ? 'negative' : 'warning'" size="m">{{ a.reason === 'past_due' ? 'Cobro fallido' : 'Prueba por vencer' }}</span>
                      @if (a.ends_at) { <small>hasta {{ fd(a.ends_at) }}</small> }
                    </span>
                  </li>
                }
              </ul>
            } @else { <p class="pf-empty">Nada pendiente por ahora.</p> }
          </article>

          <article class="pf-card">
            <div class="head"><h2>Cobros recientes</h2><span class="sub">{{ money(d.payments_30d.paid_mxn) }} cobrados en 30 días</span></div>
            @if (d.recent_payments.length) {
              <ul class="pf-list">
                @for (p of d.recent_payments; track p.id) {
                  <li>
                    <span class="who">
                      <a [routerLink]="['/plataforma/cuentas', p.practice_id]">{{ p.practice_name }}</a>
                      <small>{{ planLabel[p.plan] }} · {{ fdt(p.occurred_at) }}</small>
                    </span>
                    <span class="who" style="text-align:end">
                      <strong>{{ money(p.amount_mxn) }}</strong>
                      <span tuiBadge [tuiAppearance]="payTone[p.status]" size="s">{{ payLabel[p.status] }}</span>
                    </span>
                  </li>
                }
              </ul>
            } @else { <p class="pf-empty">Todavía no hay cobros.</p> }
            @if (d.payments_30d.returned_mxn > 0) { <p class="sub">Devuelto en 30 días: {{ money(d.payments_30d.returned_mxn) }}</p> }
          </article>

          <article class="pf-card">
            <div class="head"><h2>Uso de la plataforma</h2></div>
            <dl class="pf-detail">
              <div><dt>Pacientes activos</dt><dd>{{ nf(d.usage.active_patients) }}</dd></div>
              <div><dt>Usuarios</dt><dd>{{ nf(d.usage.users) }}</dd></div>
              <div><dt>Archivos</dt><dd>{{ bytes(d.usage.storage_bytes) }}</dd></div>
            </dl>
            <p class="sub">El ingreso mensual es una estimación con el precio de lista (anual ÷ 12). No incluye cortesías ni pruebas.</p>
          </article>
        </section>
      }
    </tui-loader>
  `,
})
export class PlatformOverview {
  protected readonly fd = fd; protected readonly fdt = fdt; protected readonly nf = nf;
  private readonly api = inject(PlatformApi);
  protected readonly o = signal<Overview | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly planLabel = PLAN_LABEL;
  protected readonly payLabel = PAYMENT_LABEL;
  protected readonly payTone = PAYMENT_TONE;
  protected readonly money = mxn;
  protected readonly dlt = delta;
  protected readonly bytes = formatBytes;

  protected readonly updated = computed(() => {
    const d = this.o();
    return d ? `Actualizado ${new Date(d.generated_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Estado de la plataforma';
  });
  protected readonly signups = computed<LineSeries[]>(() => [{ label: 'Altas', points: (this.o()?.signups_daily ?? []).map((d) => ({ date: d.day, value: d.total })) }]);
  /** Tope del eje Y: múltiplo de 4 (mínimo 4) para que las marcas queden en números enteros. */
  protected readonly signupsMax = computed(() => Math.max(4, Math.ceil(Math.max(0, ...(this.o()?.signups_daily ?? []).map((d) => d.total)) / 4) * 4));
  protected readonly plans = computed(() => {
    const d = this.o();
    return (['free', 'standard', 'pro'] as const).map((code) => ({ code, label: PLAN_LABEL[code], n: d?.by_plan[code] ?? 0, pct: pct(d?.by_plan[code] ?? 0, d?.accounts ?? 0) }));
  });
  protected readonly states = computed(() => {
    const d = this.o();
    return STATES.map((code) => ({ code, label: STATE_LABEL[code], tone: STATE_TONE[code], n: d?.by_state[code] ?? 0 }));
  });

  constructor() { this.load(); }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.overview().subscribe({
      next: (d) => { this.o.set(d); this.loading.set(false); },
      error: (e: Error) => { this.error.set(e.message); this.loading.set(false); },
    });
  }
}
