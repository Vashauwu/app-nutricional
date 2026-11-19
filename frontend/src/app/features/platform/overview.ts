import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiSkeleton } from '@taiga-ui/kit/directives/skeleton';
import { Overview, PlanCode, PlatformApi, SubState } from '../../core/api/platform-api';
import { formatBytes } from '../../shared/utils/format';
import { Icon } from '../../shared/components/icon';
import { PfBars } from './bars';
import { PfHead } from './head';
import { PAYMENT_LABEL, PAYMENT_TONE, PLAN_LABEL, STATE_LABEL, STATE_TONE, TONE_VAR, Tone, fd, fdt, mxn, nf, pct, when } from './labels';

const STATES: SubState[] = ['active', 'trialing', 'past_due', 'canceled', 'expired', 'free'];
const PLANS: PlanCode[] = ['free', 'standard', 'pro'];

interface Todo { tone: Tone; title: string; why: string; link: unknown[]; query?: Record<string, string>; cta: string }

@Component({
  selector: 'app-platform-overview',
  imports: [RouterLink, TuiAppearance, TuiBadge, TuiButton, TuiSkeleton, Icon, PfBars, PfHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-pf-head title="Resumen" [sub]="updated()">
      <button tuiButton appearance="secondary" size="s" type="button" (click)="load()" [disabled]="loading()"><app-icon name="refresh" [size]="16" /> Actualizar</button>
    </app-pf-head>

    @if (error()) {
      <div class="callout callout--crit" role="alert">
        <app-icon name="alert-circle" />
        <div class="callout-body"><strong>No se pudo cargar el resumen.</strong><span>{{ error() }}</span><span><button tuiButton appearance="secondary" size="s" type="button" (click)="load()">Reintentar</button></span></div>
      </div>
    }

    <div class="pf-cols">
      <section class="pf-sec" aria-labelledby="h-todo">
        <h2 id="h-todo">Necesita atención</h2>
        @if (!o()) {
          <ul class="pf-todo" aria-hidden="true">@for (i of [1, 2, 3]; track i) { <li><span class="pf-dot"></span><strong [tuiSkeleton]="true">Cuenta de ejemplo</strong><span class="why" [tuiSkeleton]="true">Detalle del pendiente</span></li> }</ul>
        } @else if (todos().length) {
          <ul class="pf-todo">
            @for (t of todos(); track t.title) {
              <li>
                <span class="pf-dot" [style.--tone]="tone(t.tone)" aria-hidden="true"></span>
                <strong>{{ t.title }}</strong>
                <span class="why">{{ t.why }}</span>
                <a class="go" [routerLink]="t.link" [queryParams]="t.query">{{ t.cta }} <app-icon name="arrow-right" [size]="14" /></a>
              </li>
            }
          </ul>
        } @else {
          <p class="pf-empty">Todo en orden: no hay cobros fallidos, pruebas por vencer ni solicitudes pendientes.</p>
        }
      </section>

      <section class="pf-sec" aria-labelledby="h-ing">
        <h2 id="h-ing">Ingresos <small>precio de lista</small></h2>
        <dl class="pf-ledger">
          <div class="lead"><dt>Ingreso mensual estimado</dt><dd [tuiSkeleton]="!o()">{{ o() ? money(o()!.mrr_mxn) : '$0,000' }}</dd></div>
          <div><dt>Cuentas que pagan</dt><dd [tuiSkeleton]="!o()">{{ o()?.paying_accounts ?? 0 }}</dd></div>
          <div><dt>Cobrado en 30 días</dt><dd [tuiSkeleton]="!o()">{{ o() ? money(o()!.payments_30d.paid_mxn) : '$00,000' }}</dd></div>
          @if (o() && o()!.payments_30d.returned_mxn > 0) { <div><dt>Devuelto en 30 días</dt><dd>{{ money(o()!.payments_30d.returned_mxn) }}</dd></div> }
          <div><dt>Cobros fallidos en 30 días</dt><dd [tuiSkeleton]="!o()">{{ o()?.payments_30d?.failed_count ?? 0 }}</dd></div>
        </dl>
        <p class="pf-note">Estimación: anual ÷ 12, sin cortesías ni pruebas.</p>
      </section>
    </div>

    @if (o(); as d) {
      <div class="pf-cols pf-cols--even">
        <section class="pf-sec" aria-labelledby="h-est">
          <h2 id="h-est">Estado de las suscripciones <small>{{ nf(d.accounts) }} cuentas</small></h2>
          <div class="pf-seg" role="img" [attr.aria-label]="segLabel()">
            @for (s of states(); track s.code) { @if (s.n > 0) { <span [style.--tone]="tone(s.tone)" [style.--n]="s.n"></span> } }
          </div>
          <div class="pf-table-wrap">
            <table class="pf-table pf-legend">
              <caption class="pf-sr">Cuentas por estado de la suscripción</caption>
              <thead class="pf-sr"><tr><th>Color</th><th>Estado</th><th>Cuentas</th><th>Parte</th></tr></thead>
              <tbody>
                @for (s of states(); track s.code) {
                  <tr><td><span class="pf-dot" [style.--tone]="tone(s.tone)" aria-hidden="true"></span></td><td>{{ s.label }}</td><td class="num">{{ s.n }}</td><td class="num pf-muted">{{ s.pct }}%</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="pf-sec" aria-labelledby="h-plan">
          <h2 id="h-plan">Por plan</h2>
          <div class="pf-table-wrap">
            <table class="pf-table">
              <thead><tr><th scope="col">Plan vigente</th><th scope="col" class="num">Cuentas</th><th scope="col" class="num">Ingreso mensual est.</th></tr></thead>
              <tbody>
                @for (p of plans(); track p.code) {
                  <tr><td>{{ p.label }}</td><td class="num">{{ p.n }} <span class="pf-muted">· {{ p.pct }}%</span></td><td class="num">{{ p.mrr ? money(p.mrr) : '—' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
          <p class="pf-note">{{ nf(d.usage.active_patients) }} pacientes activos · {{ nf(d.usage.users) }} usuarios · {{ bytes(d.usage.storage_bytes) }} en archivos.</p>
        </section>
      </div>

      <section class="pf-sec" aria-labelledby="h-altas">
        <h2 id="h-altas">Altas de cuentas <small>últimos 30 días, hora de la Ciudad de México</small></h2>
        <app-pf-bars [data]="d.signups_daily" label="Altas de cuentas por día, últimos 30 días" />
        <p class="pf-note">{{ d.signups_30d }} altas en los últimos 30 días; {{ d.signups_prev_30d }} en los 30 anteriores.</p>
      </section>

      <section class="pf-sec" aria-labelledby="h-cob">
        <h2 id="h-cob">Cobros recientes</h2>
        @if (d.recent_payments.length) {
          <div class="pf-table-wrap">
            <table class="pf-table pf-table--cards">
              <thead><tr><th scope="col">Cuenta</th><th scope="col">Fecha</th><th scope="col">Plan</th><th scope="col" class="num">Importe</th><th scope="col">Estado</th></tr></thead>
              <tbody>
                @for (p of d.recent_payments; track p.id) {
                  <tr>
                    <td class="main"><a class="rowlink" [routerLink]="['/plataforma/cuentas', p.practice_id]">{{ p.practice_name }}</a></td>
                    <td data-label="Fecha" class="pf-muted">{{ fdt(p.occurred_at) }}</td>
                    <td data-label="Plan">{{ planLabel[p.plan] }}</td>
                    <td data-label="Importe" class="num">{{ money(p.amount_mxn) }}</td>
                    <td data-label="Estado"><span tuiBadge [tuiAppearance]="payTone[p.status]" size="m">{{ payLabel[p.status] }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else { <p class="pf-empty">Todavía no hay cobros.</p> }
      </section>
    }
  `,
})
export class PlatformOverview {
  private readonly api = inject(PlatformApi);
  protected readonly o = signal<Overview | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly planLabel = PLAN_LABEL;
  protected readonly payLabel = PAYMENT_LABEL;
  protected readonly payTone = PAYMENT_TONE;
  protected readonly money = mxn;
  protected readonly bytes = formatBytes;
  protected readonly nf = nf;
  protected readonly fdt = fdt;
  protected readonly tone = (t: Tone): string => TONE_VAR[t];

  protected readonly updated = computed(() => {
    const d = this.o();
    return d ? `Actualizado a las ${new Date(d.generated_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Estado de la plataforma';
  });

  /** Lo que pide a una persona, en orden de urgencia: solicitudes, cobros fallidos, pruebas por vencer, suspendidas. */
  protected readonly todos = computed<Todo[]>(() => {
    const d = this.o();
    if (!d) return [];
    const out: Todo[] = [];
    if (d.pending_actions > 0) out.push({ tone: 'warning', title: `${d.pending_actions} solicitud${d.pending_actions === 1 ? '' : 'es'} por aprobar`, why: 'Cuestan dinero: las aprueba una persona distinta a quien las pidió.', link: ['/plataforma/aprobaciones'], cta: 'Revisar' });
    const rank = (a: Overview['attention'][number]) => (a.reason === 'past_due' ? 0 : 1);
    for (const a of [...d.attention].sort((x, y) => rank(x) - rank(y))) {
      const w = when(a.ends_at);
      out.push({ tone: a.reason === 'past_due' ? 'negative' : 'warning', title: a.name, why: a.reason === 'past_due' ? `Cobro fallido · el plan completo termina ${w.text} (${fd(a.ends_at)})` : `La prueba termina ${w.text} (${fd(a.ends_at)})`, link: ['/plataforma/cuentas', a.id], cta: 'Abrir' });
    }
    if (d.suspended > 0) out.push({ tone: 'neutral', title: `${d.suspended} cuenta${d.suspended === 1 ? '' : 's'} suspendida${d.suspended === 1 ? '' : 's'}`, why: 'No pueden iniciar sesión hasta que alguien las reactive.', link: ['/plataforma/cuentas'], query: { acceso: 'suspended' }, cta: 'Ver' });
    return out;
  });

  protected readonly states = computed(() => {
    const d = this.o();
    return STATES.map((code) => ({ code, label: STATE_LABEL[code], tone: STATE_TONE[code], n: d?.by_state[code] ?? 0, pct: pct(d?.by_state[code] ?? 0, d?.accounts ?? 0) }));
  });
  protected readonly segLabel = computed(() => this.states().filter((s) => s.n > 0).map((s) => `${s.label}: ${s.n}`).join(', '));
  protected readonly plans = computed(() => {
    const d = this.o();
    return PLANS.map((code) => ({ code, label: PLAN_LABEL[code], n: d?.by_plan[code] ?? 0, pct: pct(d?.by_plan[code] ?? 0, d?.accounts ?? 0), mrr: d?.mrr_by_plan?.[code] ?? 0 }));
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
