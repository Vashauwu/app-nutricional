import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiChevron } from '@taiga-ui/kit/directives/chevron';
import { TuiDataListWrapper } from '@taiga-ui/kit/components/data-list-wrapper';
import { TuiInputNumber } from '@taiga-ui/kit/components/input-number';
import { TuiProgressBar } from '@taiga-ui/kit/components/progress';
import { TuiSelect } from '@taiga-ui/kit/components/select';
import { TuiTextarea } from '@taiga-ui/kit/components/textarea';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiDialog } from '@taiga-ui/core/portals/dialog';
import { TuiLoader } from '@taiga-ui/core/components/loader';
import { AccountDetail, ActionKind, ActionRow, PaymentRow, PlanCode, PlatformApi } from '../../core/api/platform-api';
import { formatBytes } from '../../shared/utils/format';
import { Icon } from '../../shared/components/icon';
import { ACTION_LABEL, ACTION_TONE, AUDIT_LABEL, KIND_LABEL, PAYMENT_LABEL, PAYMENT_TONE, PLAN_LABEL, STATE_LABEL, STATE_TONE, mxn, fd, fdt, nf } from './labels';

type Dialog = '' | 'comp' | 'trial' | 'refund' | 'suspend' | 'reactivate';
const UNLIMITED = (n: number | undefined) => n === undefined || n < 0;

@Component({
  selector: 'app-platform-account',
  imports: [FormsModule, RouterLink, TuiAppearance, TuiBadge, TuiButton, TuiChevron, TuiDataListWrapper, TuiDialog, TuiInputNumber, TuiLoader, TuiProgressBar, TuiSelect, TuiTextarea, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="pf-back" routerLink="/plataforma/cuentas"><app-icon name="arrow-left" [size]="16" /> Cuentas</a>
    @if (error() && !d()) { <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>No se pudo cargar la cuenta.</strong><span>{{ error() }}</span></div></div> }

    <tui-loader [loading]="!d() && !error()" [overlay]="true">
      @if (d(); as a) {
        <header class="page-header">
          <div class="heading">
            <h1>{{ a.name }}</h1>
            <p class="sub">{{ a.owner_email || 'Sin titular' }} · alta {{ fd(a.created_at) }}</p>
            <p class="pf-actions">
              <span tuiBadge [tuiAppearance]="tone[a.state]" size="l">{{ states[a.state] }}</span>
              <span tuiBadge tuiAppearance="neutral" size="l">{{ plans[a.effective_plan] }}</span>
              @if (a.comped) { <span tuiBadge tuiAppearance="info" size="l">Cortesía</span> }
              @if (a.status === 'suspended') { <span tuiBadge tuiAppearance="negative" size="l">Suspendida</span> }
            </p>
          </div>
          <div class="actions">
            <button tuiButton appearance="primary" size="m" type="button" (click)="show('comp')">Plan de cortesía</button>
            @if (a.state === 'trialing') { <button tuiButton appearance="secondary" size="m" type="button" (click)="show('trial')">Prorrogar prueba</button> }
            @if (paid().length) { <button tuiButton appearance="secondary" size="m" type="button" (click)="show('refund')">Reembolsar</button> }
            @if (a.status === 'suspended') { <button tuiButton appearance="secondary" size="m" type="button" (click)="show('reactivate')">Reactivar</button> }
            @else { <button tuiButton appearance="secondary-destructive" size="m" type="button" (click)="show('suspend')">Suspender</button> }
          </div>
        </header>

        @if (a.status === 'suspended') {
          <div class="callout callout--crit" role="status"><app-icon name="ban" /><div class="callout-body"><strong>Esta cuenta no puede iniciar sesión.</strong><span>{{ a.suspended_reason || 'Suspendida por la plataforma.' }} No se borró nada.</span></div></div>
        }
        @if (notice()) { <div class="callout callout--ok" role="status"><app-icon name="check-circle" /><div class="callout-body"><strong>{{ notice() }}</strong></div></div> }

        <section class="pf-grid pf-two">
          <article class="pf-card">
            <div class="head"><h2>Plan y suscripción</h2></div>
            <dl class="pf-detail">
              <div><dt>Plan contratado</dt><dd>{{ plans[a.plan] }}{{ a.billing_period ? ' · ' + (a.billing_period === 'annual' ? 'anual' : 'mensual') : '' }}</dd></div>
              <div><dt>Plan vigente</dt><dd>{{ plans[a.effective_plan] }}</dd></div>
              <div><dt>{{ endsLabel() }}</dt><dd>{{ a.ends_at ? fd(a.ends_at) : '—' }}</dd></div>
              <div><dt>Tarjeta</dt><dd>{{ a.card || '—' }}</dd></div>
              <div><dt>Pasarela</dt><dd>{{ a.provider || '—' }}</dd></div>
              <div><dt>Prueba usada</dt><dd>{{ a.trial_used ? 'Sí' : 'No' }}</dd></div>
              @if (a.cancel_at_period_end) { <div><dt>Cancelación</dt><dd>Al terminar el periodo</dd></div> }
              @if (a.comp_reason) { <div><dt>Motivo de la cortesía</dt><dd>{{ a.comp_reason }}</dd></div> }
            </dl>
          </article>
          <article class="pf-card">
            <div class="head"><h2>Uso</h2><span class="sub">Frente a los límites del plan vigente</span></div>
            <ul class="pf-rows">
              <li class="pf-row">
                <span>Pacientes</span>
                <progress tuiProgressBar size="m" [value]="a.active_patients" [max]="patientMax()"></progress>
                <span class="n">{{ a.active_patients }} / {{ limitPatients() }}</span>
              </li>
              <li class="pf-row">
                <span>Archivos</span>
                <progress tuiProgressBar size="m" [value]="a.storage_bytes" [max]="storageMax()"></progress>
                <span class="n">{{ bytes(a.storage_bytes) }}</span>
              </li>
            </ul>
            <p class="sub">{{ a.users }} usuario{{ a.users === 1 ? '' : 's' }} en la consulta · almacenamiento: {{ limitStorage() }}</p>
          </article>
        </section>

        <section class="pf-grid pf-even">
          <article class="pf-card">
            <div class="head"><h2>Cobros</h2></div>
            @if (a.payments.length) {
              <ul class="pf-list">
                @for (p of a.payments; track p.id) {
                  <li>
                    <span class="who"><strong>{{ money(p.amount_mxn) }} · {{ plans[p.plan] }}</strong><small>{{ fdt(p.occurred_at) }}{{ p.failure_reason ? ' · ' + p.failure_reason : '' }}</small></span>
                    <span tuiBadge [tuiAppearance]="payTone[p.status]" size="m">{{ payLabel[p.status] }}</span>
                  </li>
                }
              </ul>
            } @else { <p class="pf-empty">Sin cobros registrados.</p> }
          </article>

          <article class="pf-card">
            <div class="head"><h2>Solicitudes de esta cuenta</h2></div>
            @if (a.actions.length) {
              <ul class="pf-list">
                @for (r of a.actions; track r.id) {
                  <li>
                    <span class="who"><strong>{{ kinds[r.kind] }}</strong><small>{{ r.reason }} · pidió {{ r.requested_by_email }}</small></span>
                    <span tuiBadge [tuiAppearance]="actTone[r.status]" size="m">{{ actLabel[r.status] }}</span>
                  </li>
                }
              </ul>
            } @else { <p class="pf-empty">Sin solicitudes.</p> }
          </article>
        </section>

        <section class="pf-card">
          <div class="head"><h2>Actividad reciente</h2><span class="sub">Bitácora de la cuenta</span></div>
          @if (a.audit.length) {
            <ol class="pf-timeline">
              @for (e of a.audit; track $index) {
                <li><time>{{ fdt(e.occurred_at) }}</time><span>{{ auditLabel[e.action] ?? e.action }}<small>{{ e.actor || 'Sistema' }}</small></span></li>
              }
            </ol>
          } @else { <p class="pf-empty">Sin actividad.</p> }
        </section>
      }
    </tui-loader>

    <ng-template [tuiDialog]="dialog() !== ''" [tuiDialogOptions]="{ label: title(), size: 's', dismissible: !busy() }" (tuiDialogChange)="$event || close()">
      <form class="pf-form" (ngSubmit)="submit()" #f="ngForm">
        @switch (dialog()) {
          @case ('comp') {
            <p class="sub">La cuenta usará este plan sin cobro hasta la fecha indicada. Otra persona debe aprobarlo.</p>
            <tui-textfield tuiChevron>
              <label tuiLabel for="d-plan">Plan</label>
              <input id="d-plan" tuiSelect name="plan" [(ngModel)]="planLabel" required />
              <tui-data-list-wrapper *tuiDropdown new [items]="planItems" />
            </tui-textfield>
            <tui-textfield><label tuiLabel for="d-days">Días (1 a 366)</label><input id="d-days" tuiInputNumber name="days" [min]="1" [max]="366" [step]="1" required [(ngModel)]="days" /></tui-textfield>
          }
          @case ('trial') {
            <p class="sub">Agrega días a la prueba en curso. Otra persona debe aprobarlo.</p>
            <tui-textfield><label tuiLabel for="d-days">Días extra (1 a 30)</label><input id="d-days" tuiInputNumber name="days" [min]="1" [max]="30" [step]="1" required [(ngModel)]="days" /></tui-textfield>
          }
          @case ('refund') {
            <p class="sub">Devuelve un cobro pagado. Otra persona debe aprobarlo.</p>
            <tui-textfield tuiChevron>
              <label tuiLabel for="d-pay">Cobro</label>
              <input id="d-pay" tuiSelect name="payment" [(ngModel)]="paymentLabel" required />
              <tui-data-list-wrapper *tuiDropdown new [items]="paymentItems()" />
            </tui-textfield>
          }
          @case ('suspend') { <p class="sub">La cuenta no podrá iniciar sesión ni usar la API y se cerrarán sus sesiones. No se borra nada. Es inmediato.</p> }
          @case ('reactivate') { <p class="sub">La cuenta vuelve a poder iniciar sesión.</p> }
        }
        @if (dialog() !== 'reactivate') {
          <tui-textfield>
            <label tuiLabel for="d-reason">Motivo (mínimo 10 caracteres)</label>
            <textarea id="d-reason" tuiTextarea name="reason" rows="3" required minlength="10" [(ngModel)]="reason"></textarea>
          </tui-textfield>
        }
        @if (formError()) { <p class="pf-error" role="alert">{{ formError() }}</p> }
        <div class="pf-actions">
          <button tuiButton type="submit" [appearance]="dialog() === 'suspend' ? 'primary-destructive' : 'primary'" size="m" [disabled]="busy() || f.invalid">{{ submitLabel() }}</button>
          <button tuiButton type="button" appearance="secondary" size="m" (click)="close()" [disabled]="busy()">Cancelar</button>
        </div>
      </form>
    </ng-template>
  `,
})
export class PlatformAccountPage {
  protected readonly fd = fd; protected readonly fdt = fdt; protected readonly nf = nf;
  private readonly api = inject(PlatformApi);
  readonly id = input.required<string>();
  protected readonly d = signal<AccountDetail | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly dialog = signal<Dialog>('');
  protected readonly busy = signal(false);
  protected readonly formError = signal('');

  protected planLabel = 'Pro';
  protected readonly planItems = ['Estándar', 'Pro'];
  protected days: number | null = 30;
  protected paymentLabel = '';
  protected reason = '';

  protected readonly plans = PLAN_LABEL;
  protected readonly states = STATE_LABEL;
  protected readonly tone = STATE_TONE;
  protected readonly kinds = KIND_LABEL;
  protected readonly actLabel = ACTION_LABEL;
  protected readonly actTone = ACTION_TONE;
  protected readonly payLabel = PAYMENT_LABEL;
  protected readonly payTone = PAYMENT_TONE;
  protected readonly auditLabel = AUDIT_LABEL;
  protected readonly money = mxn;
  protected readonly bytes = formatBytes;

  protected readonly paid = computed<PaymentRow[]>(() => (this.d()?.payments ?? []).filter((p) => p.status === 'paid'));
  private readonly payText = (p: PaymentRow) => `${mxn(p.amount_mxn)} · ${new Date(p.occurred_at).toLocaleDateString('es-MX')}`;
  protected readonly paymentItems = computed(() => this.paid().map(this.payText));
  protected readonly endsLabel = computed(() => ({ trialing: 'Fin de la prueba', past_due: 'Fin de la gracia', active: 'Próxima renovación', canceled: 'Acceso hasta' })[this.d()?.state as string] ?? 'Vigente hasta');
  protected readonly limitPatients = computed(() => (UNLIMITED(this.d()?.limits.active_patients as number) ? 'sin tope' : String(this.d()?.limits.active_patients)));
  protected readonly limitStorage = computed(() => (UNLIMITED(this.d()?.limits.storage_bytes as number) ? 'sin tope' : formatBytes(this.d()?.limits.storage_bytes as number)));
  protected readonly patientMax = computed(() => (UNLIMITED(this.d()?.limits.active_patients as number) ? Math.max(1, this.d()?.active_patients ?? 1) * 4 : (this.d()?.limits.active_patients as number)));
  protected readonly storageMax = computed(() => (UNLIMITED(this.d()?.limits.storage_bytes as number) ? Math.max(1, this.d()?.storage_bytes ?? 1) * 4 : (this.d()?.limits.storage_bytes as number)));
  protected readonly title = computed(() => ({ comp: 'Plan de cortesía', trial: 'Prorrogar prueba', refund: 'Reembolsar un cobro', suspend: 'Suspender cuenta', reactivate: 'Reactivar cuenta', '': '' })[this.dialog()]);
  protected readonly submitLabel = computed(() => ({ comp: 'Pedir aprobación', trial: 'Pedir aprobación', refund: 'Pedir aprobación', suspend: 'Suspender ahora', reactivate: 'Reactivar', '': '' })[this.dialog()]);

  constructor() {
    // El id llega por la ruta; al cambiar de cuenta se vuelve a cargar.
    effect(() => { this.id(); this.d.set(null); this.error.set(''); this.load(); });
  }

  private load(): void {
    this.api.account(this.id()).subscribe({ next: (a) => this.d.set(a), error: (e: Error) => this.error.set(e.message) });
  }

  protected show(k: Dialog): void {
    this.dialog.set(k); this.formError.set(''); this.notice.set('');
    this.reason = ''; this.days = k === 'trial' ? 7 : 30; this.planLabel = 'Pro';
    this.paymentLabel = this.paid()[0] ? this.payText(this.paid()[0]) : '';
  }
  protected close(): void { if (!this.busy()) this.dialog.set(''); }

  protected submit(): void {
    const k = this.dialog();
    const id = this.id();
    this.busy.set(true); this.formError.set('');
    const done = (msg: string) => () => { this.busy.set(false); this.dialog.set(''); this.notice.set(msg); this.load(); this.api.overview().subscribe({ error: () => undefined }); };
    const fail = (e: Error) => { this.busy.set(false); this.formError.set(e.message); };
    if (k === 'suspend') { this.api.suspend(id, this.reason).subscribe({ next: done('Cuenta suspendida.'), error: fail }); return; }
    if (k === 'reactivate') { this.api.reactivate(id).subscribe({ next: done('Cuenta reactivada.'), error: fail }); return; }
    const kind: ActionKind = k === 'comp' ? 'comp_plan' : k === 'trial' ? 'extend_trial' : 'refund';
    const plan: PlanCode = this.planLabel === 'Estándar' ? 'standard' : 'pro';
    const payment = this.paid().find((p) => this.payText(p) === this.paymentLabel);
    const params: ActionRow['params'] = k === 'comp' ? { plan, days: Number(this.days) } : k === 'trial' ? { days: Number(this.days) } : { payment_id: payment?.id };
    this.api.request(id, kind, params, this.reason).subscribe({ next: done('Solicitud creada. Otra persona debe aprobarla en Aprobaciones.'), error: fail });
  }
}
