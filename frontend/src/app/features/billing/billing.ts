import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { BillingApi, BillingPeriod, BillingSummary, PaymentInfo, PlanCode, PlanInfo } from '../../core/api/billing-api';
import { CardInput, CardTokenizer, cardErrors } from '../../core/services/card-tokenizer';
import { ApiClient } from '../../core/api/api-client';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { Modal } from '../../shared/components/modal';
import { Icon } from '../../shared/components/icon';
import { PageHeader } from '../../shared/components/page-header';
import { EmptyState } from '../../shared/components/ui';
import { formatBytes, formatDate, formatDateTime } from '../../shared/utils/format';
import { Entitlements } from '../../core/services/entitlements.service';

const RANK: Record<PlanCode, number> = { free: 0, standard: 1, pro: 2 };
const mxn = (n: number): string => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);

/** Facturación: plan actual, uso frente a los límites y comparativa de planes. El cobro en línea llega en una siguiente etapa. */
@Component({
  selector: 'app-billing',
  imports: [TuiButton, Icon, PageHeader, EmptyState, Modal],
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
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
    .card-line { display: flex; align-items: center; gap: 0.5rem; font-variant-numeric: tabular-nums; }
    .hint-box { padding: var(--space-3); border: 1px dashed var(--line); border-radius: var(--radius-s); font-size: 0.8125rem; color: var(--muted); }
    .pay-grid { display: grid; gap: var(--space-3); grid-template-columns: 1fr 1fr; }
    .pay-grid .wide { grid-column: 1 / -1; }
    .st-paid { color: var(--nutri-texto-fuerte); } .st-failed, .st-chargeback { color: var(--danger); font-weight: 600; }
    @media (max-width: 62rem) { .cur, .plans { grid-template-columns: minmax(0, 1fr); } .pay-grid { grid-template-columns: minmax(0, 1fr); } }
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
            @if (s.paymentsReady && info(); as i) {
              @if (i.card) { <p class="card-line small m-0"><app-icon name="gem" [size]="16" /> {{ brandName(i.card.brand) }} terminada en {{ i.card.last4 }} · vence {{ i.card.expMonth }}/{{ i.card.expYear }}</p> }
              @if (i.hasSubscription && !s.comped && s.state !== 'expired' && s.state !== 'free') {
                <div class="actions">
                  <button tuiButton type="button" size="s" appearance="secondary" (click)="openCard()">Cambiar tarjeta</button>
                  @if (s.state !== 'canceled') { <button tuiButton type="button" size="s" appearance="flat" (click)="cancel()">Cancelar suscripción</button> }
                </div>
              }
              @if (s.pendingPlan) { <p class="small muted m-0">Pasarás al plan {{ planName(s.pendingPlan) }} al terminar tu periodo actual.</p> }
            }
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
                @if (p.code === s.plan.code && s.state !== 'expired') {
                  <button tuiButton type="button" size="m" appearance="secondary" disabled>Plan actual</button>
                } @else if (s.paymentsReady) {
                  @if (s.comped && s.plan.code !== 'free') {
                    <p class="small muted m-0">Tu plan se concedió sin cobro. Escríbenos para cambiarlo.</p>
                  } @else if (p.code === 'free') {
                    <p class="small muted m-0">{{ s.plan.code === 'free' ? 'Es tu plan actual.' : 'Pasas a este plan al cancelar tu suscripción.' }}</p>
                  } @else if (!info()?.hasSubscription || s.state === 'expired' || s.state === 'free') {
                    <button tuiButton type="button" size="m" (click)="openCheckout(p)">{{ info()?.trialAvailable ? 'Probar ' + (info()?.trialDays ?? 14) + ' días gratis' : 'Contratar' }}</button>
                  } @else if (rank(p.code) > rank(s.plan.code)) {
                    <button tuiButton type="button" size="m" [disabled]="sending() === p.code" (click)="change(p, true)">Subir a este plan</button>
                  } @else {
                    <button tuiButton type="button" size="m" appearance="secondary" [disabled]="sending() === p.code" (click)="change(p, false)">Bajar a este plan</button>
                  }
                } @else if (rank(p.code) > rank(s.plan.code)) {
                  <button tuiButton type="button" size="m" [disabled]="sending() === p.code" (click)="want(p)">{{ sending() === p.code ? 'Enviando…' : 'Quiero este plan' }}</button>
                } @else {
                  <p class="small muted m-0">Incluido en tu plan actual.</p>
                }
              </article>
            }
          </div>

          @if (!s.paymentsReady) {
            <div class="callout" role="note">
              <app-icon name="info" />
              <div class="callout-body">
                <p><strong>El cobro en línea aún no está disponible.</strong></p>
                <p class="small">Mientras lo habilitamos, usa tu plan actual con normalidad. Si eliges «Quiero este plan», anotamos tu interés y te avisamos en cuanto puedas contratarlo, con factura (CFDI).</p>
              </div>
            </div>
          } @else if (info()?.provider === 'sim') {
            <div class="callout" role="note"><app-icon name="info" /><div class="callout-body"><p><strong>Pasarela de pruebas.</strong> Aquí no se cobra nada: sirve para probar contratar, la prueba gratuita, un cobro fallido y la cancelación.</p></div></div>
          }
        </section>

        @if (s.paymentsReady && info(); as i) {
          <section class="stack" aria-labelledby="b-hist">
            <h2 class="u-h2-ui m-0" id="b-hist">Historial de cobros</h2>
            @if (i.payments.length) {
              <div class="table-wrap"><table class="table"><caption class="visually-hidden">Cobros de tu suscripción</caption>
                <thead><tr><th scope="col">Fecha</th><th scope="col">Plan</th><th scope="col" class="num">Importe</th><th scope="col">Estado</th></tr></thead>
                <tbody>@for (r of i.payments; track r.id) {
                  <tr><td>{{ fdt(r.occurredAt.toISOString()) }}</td><td>{{ planName(r.plan) }} · {{ r.period === 'annual' ? 'anual' : 'mensual' }}</td><td class="num">{{ money(r.amountMxn) }}</td>
                    <td [class]="'st-' + r.status">{{ statusLabel(r.status) }}@if (r.failureReason) { <span class="small muted"> · {{ r.failureReason }}</span> }</td></tr>
                }</tbody></table></div>
            } @else { <p class="muted small m-0">Aún no hay cobros. Durante la prueba gratuita no se cobra nada.</p> }
          </section>
        }
      } @else {
        <p class="muted" role="status">Cargando…</p>
      }
    </div>

    <app-modal [open]="!!checkoutPlan() || cardOnly()" (closed)="closeModal()" [title]="cardOnly() ? 'Cambiar tarjeta' : 'Contratar plan ' + (checkoutPlan()?.name ?? '')" size="narrow">
      @if (checkoutPlan(); as p) {
        <p class="small">{{ info()?.trialAvailable ? 'Tienes ' + (info()?.trialDays ?? 14) + ' días gratis. No se te cobra hasta que termine la prueba y puedes cancelar antes sin cargo. Después: ' : 'Se cobrará ahora y cada periodo: ' }}<strong>{{ money(period() === 'annual' ? p.annualMxn : p.monthlyMxn) }}</strong> {{ period() === 'annual' ? 'al año' : 'al mes' }}, IVA incluido.</p>
      }
      <form id="pay-form" class="stack" (submit)="$event.preventDefault(); pay()" novalidate>
        <div class="pay-grid">
          <div class="field wide"><label for="pc-num">Número de tarjeta</label><input id="pc-num" class="input" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" [value]="card().number" (input)="setCard('number', $event)" />@if (errs().number) { <p class="error" role="alert">{{ errs().number }}</p> }</div>
          <div class="field wide"><label for="pc-name">Nombre en la tarjeta</label><input id="pc-name" class="input" autocomplete="cc-name" [value]="card().name" (input)="setCard('name', $event)" />@if (errs().name) { <p class="error" role="alert">{{ errs().name }}</p> }</div>
          <div class="field"><label for="pc-exp">Vigencia</label><input id="pc-exp" class="input" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA" [value]="card().expiry" (input)="setCard('expiry', $event)" />@if (errs().expiry) { <p class="error" role="alert">{{ errs().expiry }}</p> }</div>
          <div class="field"><label for="pc-cvc">Código de seguridad</label><input id="pc-cvc" class="input" inputmode="numeric" autocomplete="cc-csc" maxlength="4" [value]="card().cvc" (input)="setCard('cvc', $event)" />@if (errs().cvc) { <p class="error" role="alert">{{ errs().cvc }}</p> }</div>
        </div>
        <p class="small muted m-0">El número de tu tarjeta no pasa por nuestros servidores: se envía directo al proveedor de pago.</p>
        @if (info()?.provider === 'sim') { <div class="hint-box">Tarjetas de prueba: <b>4242 4242 4242 4242</b> aprobada · <b>4000 0000 0000 0002</b> rechazada · <b>4000 0000 0000 9995</b> el primer cobro falla. Cualquier vigencia futura y código.</div> }
        @if (payError()) { <p class="error" role="alert">{{ payError() }}</p> }
      </form>
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="closeModal()">Cancelar</button><button tuiButton type="submit" form="pay-form" size="m" [disabled]="paying()">{{ paying() ? 'Procesando…' : cardOnly() ? 'Guardar tarjeta' : info()?.trialAvailable ? 'Empezar prueba gratuita' : 'Pagar y contratar' }}</button></ng-container>
    </app-modal>
  `,
})
export class BillingPage {
  private readonly billing = inject(BillingApi);
  private readonly toast = inject(ToastService);
  protected readonly enabled = inject(ApiClient).enabled;
  protected readonly error = signal(false);
  protected readonly period = signal<BillingPeriod>('annual');
  protected readonly sending = signal<PlanCode | null>(null);

  protected readonly summary = signal<BillingSummary | null>(null);
  protected readonly info = signal<PaymentInfo | null>(null);
  private readonly confirm = inject(ConfirmService);
  private readonly tokenizer = inject(CardTokenizer);

  constructor() { this.load(); }

  /** Vuelve a leer el plan y, si hay cobro en línea, el método de pago y el historial. */
  protected load(): void {
    this.billing.summary().subscribe({
      next: (s) => {
        this.summary.set(s);
        this.ent.load(true);
        if (s.paymentsReady) this.billing.paymentInfo().subscribe({ next: (i) => this.info.set(i), error: () => undefined });
      },
      error: () => this.error.set(true),
    });
  }

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

  protected readonly fdt = formatDateTime;
  protected readonly money = mxn;
  protected readonly checkoutPlan = signal<PlanInfo | null>(null);
  protected readonly cardOnly = signal(false);
  protected readonly card = signal<CardInput>({ number: '', name: '', expiry: '', cvc: '' });
  protected readonly errs = signal<Partial<Record<keyof CardInput, string>>>({});
  protected readonly paying = signal(false);
  protected readonly payError = signal('');
  protected planName = (c: PlanCode | string): string => this.summary()?.catalog.find((p) => p.code === c)?.name ?? String(c);
  protected brandName = (b: string): string => (b === 'visa' ? 'Visa' : b === 'mastercard' ? 'Mastercard' : b);
  protected statusLabel = (s: string): string => ({ paid: 'Pagado', failed: 'Fallido', refunded: 'Reembolsado', chargeback: 'Contracargo' } as Record<string, string>)[s] ?? s;

  protected openCheckout(p: PlanInfo): void { this.resetCard(); this.checkoutPlan.set(p); }
  protected openCard(): void { this.resetCard(); this.cardOnly.set(true); }
  protected closeModal(): void { this.checkoutPlan.set(null); this.cardOnly.set(false); this.resetCard(); }
  private resetCard(): void { this.card.set({ number: '', name: '', expiry: '', cvc: '' }); this.errs.set({}); this.payError.set(''); this.paying.set(false); }
  protected setCard(k: keyof CardInput, e: Event): void { this.card.update((c) => ({ ...c, [k]: (e.target as HTMLInputElement).value })); }

  /** Contrata el plan elegido o cambia la tarjeta: tokeniza en el navegador y manda solo el token. */
  protected async pay(): Promise<void> {
    const errors = cardErrors(this.card());
    this.errs.set(errors);
    if (Object.keys(errors).length) return;
    const i = this.info();
    if (!i) return;
    this.paying.set(true);
    this.payError.set('');
    try {
      const token = await this.tokenizer.tokenize(this.card(), i);
      const p = this.checkoutPlan();
      if (p) {
        await firstValueFrom(this.billing.checkout(p.code, this.period(), token));
        this.toast.ok(i.trialAvailable ? `Empezó tu prueba gratuita del plan ${p.name}.` : `Contrataste el plan ${p.name}.`);
      } else {
        await firstValueFrom(this.billing.updateCard(token));
        this.toast.ok('Actualizamos tu tarjeta.');
      }
      this.closeModal();
      this.load();
    } catch (e) {
      this.paying.set(false);
      this.payError.set(e instanceof ApiError || e instanceof Error ? e.message : 'No se pudo completar el pago.');
    }
  }

  protected async change(p: PlanInfo, up: boolean): Promise<void> {
    const ok = await this.confirm.ask(up
      ? { title: `Subir al plan ${p.name}`, message: `El cambio es inmediato y se cobra ${mxn(this.period() === 'annual' ? p.annualMxn : p.monthlyMxn)} ${this.period() === 'annual' ? 'al año' : 'al mes'} con tu tarjeta registrada.`, confirmLabel: 'Subir de plan' }
      : { title: `Bajar al plan ${p.name}`, message: 'Conservas tu plan actual hasta que termine el periodo pagado. Después pasas a este plan y no se borra nada: si tienes más de lo que incluye, no podrás agregar más hasta ajustarte.', confirmLabel: 'Programar el cambio' });
    if (!ok) return;
    this.sending.set(p.code);
    this.billing.changePlan(p.code, this.period()).subscribe({
      next: () => { this.sending.set(null); this.toast.ok(up ? `Ya estás en el plan ${p.name}.` : `Pasarás al plan ${p.name} al terminar tu periodo.`); this.load(); },
      error: (e: unknown) => { this.sending.set(null); this.toast.error(e instanceof Error ? e.message : 'No se pudo cambiar de plan.'); },
    });
  }

  protected async cancel(): Promise<void> {
    const s = this.summary();
    const ok = await this.confirm.ask({ title: 'Cancelar suscripción', message: `Conservas el plan ${s?.plan.name ?? ''} hasta ${s?.endsAt ? formatDate(s.endsAt.toISOString()) : 'el fin del periodo'}. Después pasas al plan Gratuito y no se borra nada.`, confirmLabel: 'Cancelar suscripción', tone: 'danger' });
    if (!ok) return;
    this.billing.cancel().subscribe({
      next: () => { this.toast.ok('Cancelamos tu suscripción.'); this.load(); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo cancelar.'),
    });
  }
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
