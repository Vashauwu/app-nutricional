import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TuiButton } from '@taiga-ui/core';
import { catchError, of, tap } from 'rxjs';
import { BillingApi, BillingPeriod, BillingSummary, PlanCode, PlanInfo } from '../../core/api/billing-api';
import { ApiClient } from '../../core/api/api-client';
import { ToastService } from '../../core/services/ui.services';
import { Icon } from '../../shared/components/icon';
import { PageHeader } from '../../shared/components/page-header';
import { EmptyState } from '../../shared/components/ui';
import { formatBytes, formatDate } from '../../shared/utils/format';
import { Entitlements } from '../../core/services/entitlements.service';

const RANK: Record<PlanCode, number> = { free: 0, standard: 1, pro: 2 };
const mxn = (n: number): string => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);

/** Facturación: plan actual, uso frente a los límites y comparativa de planes. El cobro en línea llega en una siguiente etapa. */
@Component({
  selector: 'app-billing',
  imports: [TuiButton, Icon, PageHeader, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .cur { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); align-items: start; }
    .meters { display: grid; gap: var(--space-3); }
    .meter-row { display: grid; gap: 0.25rem; }
    .meter-row .top { display: flex; justify-content: space-between; gap: var(--space-2); font-size: 0.875rem; font-variant-numeric: tabular-nums; }
    .track { block-size: 0.5rem; border-radius: 999px; background: var(--line); overflow: hidden; }
    .fill { block-size: 100%; border-radius: inherit; background: var(--brand-primary); }
    .fill.warn { background: var(--warn); }
    .fill.crit { background: var(--danger); }
    .plan-name { font-family: var(--nutri-font-display); font-size: 1.75rem; font-weight: 600; margin: 0; }
    .seg { display: inline-flex; padding: 0.1875rem; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); }
    .seg button { border: 0; background: none; font: inherit; font-size: 0.875rem; padding: 0.375rem 0.875rem; border-radius: 999px; cursor: pointer; color: var(--muted); min-block-size: 2.25rem; }
    .seg button[aria-pressed='true'] { background: var(--nutri-texto-fuerte); color: var(--nutri-marfil); font-weight: 600; }
    .plans { display: grid; gap: var(--space-3); grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; }
    .plan { display: grid; gap: var(--space-3); align-content: start; padding: var(--space-4); border: 1.5px solid var(--line); border-radius: var(--radius-m); background: var(--surface); }
    .plan.now { border-color: var(--brand-primary); }
    .price { display: flex; align-items: baseline; gap: 0.375rem; flex-wrap: wrap; }
    .price b { font-size: 2rem; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .feats { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; font-size: 0.9375rem; }
    .feats li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.5rem; align-items: start; }
    .tag { display: inline-block; padding: 0 0.5rem; border-radius: 999px; background: var(--nutri-salvia); font-size: 0.75rem; font-weight: 700; }
    @media (max-width: 62rem) { .cur, .plans { grid-template-columns: minmax(0, 1fr); } }
  `,
  template: `
    <div class="page">
      <app-page-header title="Facturación" sub="Tu plan, lo que llevas usado y los planes disponibles." />

      @if (error()) {
        <app-empty icon="alert-circle" title="No se pudo cargar tu plan" text="Revisa tu conexión e inténtalo de nuevo." />
      } @else if (summary(); as s) {
        @if (notice(); as n) {
          <div class="callout" [class.callout--warn]="n.warn" [attr.role]="n.warn ? 'alert' : 'status'"><app-icon [name]="n.warn ? 'alert' : 'info'" /><div class="callout-body"><p><strong>{{ n.title }}</strong></p><p class="small">{{ n.text }}</p></div></div>
        }
        <section class="cur" aria-labelledby="b-cur">
          <div class="panel stack">
            <p class="eyebrow" id="b-cur">Tu plan actual</p>
            <p class="plan-name">{{ s.plan.name }}</p>
            <p class="muted m-0">{{ s.plan.tagline }}</p>
            @if (s.plan.code !== 'free') {
              <p class="small m-0">{{ s.comped ? 'Plan concedido sin cobro' + (s.compReason ? ' · ' + s.compReason : '') : s.period === 'annual' ? 'Facturación anual' : s.period === 'monthly' ? 'Facturación mensual' : 'Cuenta con acceso completo' }}</p>
            }
          </div>
          <div class="panel meters" role="group" aria-label="Uso del plan">
            <div class="meter-row">
              <div class="top"><span>Pacientes activos</span><span>{{ s.usage.activePatients }} de {{ limitLabel(s.plan.activePatients) }}</span></div>
              <div class="track" role="progressbar" aria-label="Pacientes activos" [attr.aria-valuenow]="s.usage.activePatients" aria-valuemin="0" [attr.aria-valuemax]="s.plan.activePatients < 0 ? null : s.plan.activePatients"><div class="fill" [class]="'fill ' + tone(patientsPct())" [style.inline-size.%]="patientsPct()"></div></div>
            </div>
            <div class="meter-row">
              <div class="top"><span>Archivos</span><span>{{ bytes(s.usage.storageBytes) }} de {{ s.plan.storageBytes < 0 ? 'sin tope' : bytes(s.plan.storageBytes) }}</span></div>
              <div class="track" role="progressbar" aria-label="Espacio de archivos" [attr.aria-valuenow]="storagePct()" aria-valuemin="0" aria-valuemax="100"><div class="fill" [class]="'fill ' + tone(storagePct())" [style.inline-size.%]="storagePct()"></div></div>
            </div>
            @for (a of usageAlerts(); track a.key) { <p class="small m-0" [class.text-danger]="a.crit" role="status"><app-icon [name]="a.crit ? 'alert-circle' : 'alert'" [size]="14" /> {{ a.text }}</p> }
            <p class="small muted m-0">Fotografías de seguimiento: {{ s.plan.trackingPhotos ? 'incluidas' : 'no incluidas en este plan' }}.</p>
          </div>
        </section>

        <section class="stack" aria-labelledby="b-plans">
          <div class="row" style="justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap">
            <h2 class="u-h2-ui m-0" id="b-plans">Planes</h2>
            <div class="seg" role="group" aria-label="Periodo de facturación">
              <button type="button" [attr.aria-pressed]="period() === 'monthly'" (click)="period.set('monthly')">Mensual</button>
              <button type="button" [attr.aria-pressed]="period() === 'annual'" (click)="period.set('annual')">Anual · ahorra 20 %</button>
            </div>
          </div>

          <div class="plans">
            @for (p of s.catalog; track p.code) {
              <article class="plan" [class.now]="p.code === s.plan.code" [attr.aria-label]="'Plan ' + p.name">
                <div>
                  <h3 class="m-0">{{ p.name }} @if (p.code === s.plan.code) { <span class="tag">Tu plan</span> }</h3>
                  <p class="muted small m-0">{{ p.tagline }}</p>
                </div>
                <div class="price">
                  @if (p.code === 'free') { <b>Gratis</b> }
                  @else if (period() === 'monthly') { <b>{{ money(p.monthlyMxn) }}</b><span class="muted">al mes</span> }
                  @else { <b>{{ money(p.annualMxn) }}</b><span class="muted">al año · {{ money(round(p.annualMxn / 12)) }} al mes</span> }
                </div>
                @if (p.code !== 'free') { <p class="small muted m-0">IVA incluido.</p> }
                <ul class="feats">
                  @for (f of p.features; track f) { <li><app-icon name="check" [size]="16" /><span>{{ f }}</span></li> }
                </ul>
                @if (p.code === s.plan.code) {
                  <button tuiButton type="button" size="m" appearance="secondary" disabled>Plan actual</button>
                } @else if (rank(p.code) > rank(s.plan.code)) {
                  <button tuiButton type="button" size="m" [disabled]="sending() === p.code" (click)="want(p)">{{ sending() === p.code ? 'Enviando…' : 'Quiero este plan' }}</button>
                } @else {
                  <p class="small muted m-0">Incluido en tu plan actual.</p>
                }
              </article>
            }
          </div>

          <div class="callout" role="note">
            <app-icon name="info" />
            <div class="callout-body">
              <p><strong>El cobro en línea aún no está disponible.</strong></p>
              <p class="small">Mientras lo habilitamos, usa tu plan actual con normalidad. Si eliges «Quiero este plan», anotamos tu interés y te avisamos en cuanto puedas contratarlo, con factura (CFDI).</p>
            </div>
          </div>
        </section>
      } @else {
        <p class="muted" role="status">Cargando…</p>
      }
    </div>
  `,
})
export class BillingPage {
  private readonly billing = inject(BillingApi);
  private readonly toast = inject(ToastService);
  protected readonly enabled = inject(ApiClient).enabled;
  protected readonly error = signal(false);
  protected readonly period = signal<BillingPeriod>('annual');
  protected readonly sending = signal<PlanCode | null>(null);

  protected readonly summary = toSignal(
    this.billing.summary().pipe(tap(() => this.ent.load(true)), catchError(() => { this.error.set(true); return of(null as BillingSummary | null); })),
    { initialValue: null as BillingSummary | null },
  );

  private readonly ent = inject(Entitlements);

  /** Aviso según el estado de la suscripción (prueba, cobro fallido, cancelada o vencida). */
  protected readonly notice = computed<{ title: string; text: string; warn: boolean } | null>(() => {
    const s = this.summary();
    if (!s) return null;
    const end = s.endsAt ? formatDate(s.endsAt.toISOString()) : '';
    switch (s.state) {
      case 'trialing': return { warn: false, title: `Prueba gratuita del plan ${s.plan.name}`, text: `Tienes acceso completo hasta el ${end}. No se hace ningún cobro durante la prueba.` };
      case 'past_due': return { warn: true, title: 'No pudimos cobrar tu plan', text: `Conservas el plan ${s.plan.name} hasta el ${end}. Si el pago no se regulariza, pasarás al plan Gratuito; no se borra nada.` };
      case 'canceled': return { warn: false, title: 'Tu suscripción está cancelada', text: `Conservas el plan ${s.plan.name} hasta el ${end}. Después pasarás al plan Gratuito; no se borra nada.` };
      case 'expired': return s.downgraded ? { warn: true, title: `Tu plan ${s.contracted.name} ya no está vigente`, text: 'Operas con el plan Gratuito: conservas todo lo que ya tienes, pero no puedes crear por encima de sus cupos hasta contratar un plan.' } : null;
      default: return null;
    }
  });

  protected readonly usageAlerts = computed(() => {
    const s = this.summary();
    if (!s) return [];
    const out: { key: string; text: string; crit: boolean }[] = [];
    const pp = s.plan.activePatients;
    if (pp >= 0 && s.usage.activePatients >= pp) out.push({ key: 'p', crit: true, text: s.usage.activePatients > pp ? `Tienes ${s.usage.activePatients} pacientes activos y tu plan incluye ${pp}: no podrás agregar más hasta archivar pacientes o cambiar de plan.` : `Llegaste al límite de ${pp} pacientes activos. Archiva pacientes o cambia de plan para agregar más.` });
    else if (this.patientsPct() >= 80) out.push({ key: 'p', crit: false, text: 'Estás cerca del límite de pacientes activos de tu plan.' });
    if (s.plan.storageBytes >= 0 && s.usage.storageBytes >= s.plan.storageBytes) out.push({ key: 's', crit: true, text: 'Ya no queda espacio de archivos en tu plan. Libera espacio o cambia de plan.' });
    else if (this.storagePct() >= 80) out.push({ key: 's', crit: false, text: 'Estás cerca del límite de espacio de archivos de tu plan.' });
    return out;
  });

  protected readonly patientsPct = computed(() => {
    const s = this.summary();
    return !s || s.plan.activePatients < 0 ? 0 : Math.min(100, Math.round((s.usage.activePatients / s.plan.activePatients) * 100));
  });
  protected readonly storagePct = computed(() => {
    const s = this.summary();
    return !s || s.plan.storageBytes < 0 ? 0 : Math.min(100, Math.round((s.usage.storageBytes / s.plan.storageBytes) * 100));
  });

  protected readonly money = mxn;
  protected readonly bytes = formatBytes;
  protected readonly round = Math.round;
  protected rank = (c: PlanCode): number => RANK[c];
  protected limitLabel = (n: number): string => (n < 0 ? 'sin tope' : String(n));
  protected tone = (pct: number): string => (pct >= 100 ? 'crit' : pct >= 80 ? 'warn' : '');

  protected want(p: PlanInfo): void {
    this.sending.set(p.code);
    this.billing.interest(p.code, this.period()).subscribe({
      next: () => { this.sending.set(null); this.toast.ok(`Anotamos tu interés en el plan ${p.name}. Te avisaremos cuando puedas contratarlo.`); },
      error: () => { this.sending.set(null); this.toast.error('No se pudo registrar. Inténtalo de nuevo.'); },
    });
  }
}
