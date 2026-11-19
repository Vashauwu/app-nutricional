import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiChevron } from '@taiga-ui/kit/directives/chevron';
import { TuiDataListWrapper } from '@taiga-ui/kit/components/data-list-wrapper';
import { TuiDialog } from '@taiga-ui/core/portals/dialog';
import { TuiInput } from '@taiga-ui/core/components/input';
import { TuiInputNumber } from '@taiga-ui/kit/components/input-number';
import { TuiProgressBar } from '@taiga-ui/kit/components/progress';
import { TuiSelect } from '@taiga-ui/kit/components/select';
import { TuiSkeleton } from '@taiga-ui/kit/directives/skeleton';
import { TuiTextarea } from '@taiga-ui/kit/components/textarea';
import { AccountDetail, ActionKind, ActionRow, PaymentRow, PlanCode, PlatformApi } from '../../core/api/platform-api';
import { formatBytes } from '../../shared/utils/format';
import { Icon } from '../../shared/components/icon';
import { PfHead } from './head';
import { AUDIT_LABEL, KIND_LABEL, PAYMENT_LABEL, PAYMENT_TONE, PLAN_LABEL, STATE_LABEL, STATE_TONE, fd, fdt, mxn, when } from './labels';

type Dialog = '' | 'comp' | 'trial' | 'refund' | 'suspend' | 'reactivate';
const MIN_REASON = 10;
const TIMELINE_SHOWN = 6;
const limited = (n: number | undefined): n is number => n !== undefined && n >= 0;

@Component({
  selector: 'app-platform-account',
  imports: [FormsModule, RouterLink, TuiAppearance, TuiBadge, TuiButton, TuiChevron, TuiDataListWrapper, TuiDialog, TuiInput, TuiInputNumber, TuiProgressBar, TuiSelect, TuiSkeleton, TuiTextarea, Icon, PfHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="pf-back" routerLink="/plataforma/cuentas"><app-icon name="arrow-left" [size]="16" /> Cuentas</a>

    @if (error() && !d()) {
      <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>No se pudo cargar la cuenta.</strong><span>{{ error() }}</span><span><button tuiButton appearance="secondary" size="s" type="button" (click)="retry()">Reintentar</button></span></div></div>
    } @else if (!d()) {
      <app-pf-head title="Cargando cuenta" sub=" " />
      <p [tuiSkeleton]="true" aria-hidden="true">Detalle de la cuenta que se está cargando para mostrarse aquí</p>
    }

    @if (d(); as a) {
      <app-pf-head [title]="a.name">
        <p meta class="pf-actions" style="margin:.5rem 0 0">
          <span class="pf-muted">{{ a.owner_email || 'Sin titular registrado' }}</span>
          @if (a.owner_email) { <button tuiButton appearance="flat" size="xs" type="button" (click)="copy(a.owner_email)" [attr.aria-label]="copied() ? 'Correo copiado' : 'Copiar correo'"><app-icon [name]="copied() ? 'check' : 'copy'" [size]="14" /></button> }
          <span class="pf-muted">· alta {{ fd(a.created_at) }}</span>
        </p>
        <p meta class="pf-actions" style="margin:.5rem 0 0">
          <span tuiBadge [tuiAppearance]="tone[a.state]" size="m">{{ states[a.state] }}</span>
          <span tuiBadge tuiAppearance="neutral" size="m">{{ plans[a.effective_plan] }}</span>
          @if (a.comped) { <span tuiBadge tuiAppearance="info" size="m">Cortesía</span> }
          @if (a.status === 'suspended') { <span tuiBadge tuiAppearance="negative" size="m">Suspendida</span> }
        </p>
        <button tuiButton appearance="secondary" size="s" type="button" (click)="show('comp')">Plan de cortesía</button>
        @if (a.state === 'trialing') { <button tuiButton appearance="secondary" size="s" type="button" (click)="show('trial')">Prorrogar prueba</button> }
        @if (paid().length) { <button tuiButton appearance="secondary" size="s" type="button" (click)="show('refund')">Reembolsar</button> }
      </app-pf-head>

      @if (a.status === 'suspended') {
        <div class="callout callout--crit" role="status"><app-icon name="ban" /><div class="callout-body"><strong>Esta cuenta no puede iniciar sesión.</strong><span>{{ a.suspended_reason || 'Suspendida por la plataforma.' }} No se borró nada.</span></div></div>
      }
      @if (notice()) { <div class="callout callout--ok" role="status"><app-icon name="check-circle" /><div class="callout-body"><strong>{{ notice() }}</strong></div></div> }

      <div class="pf-cols">
        <div>
          <section class="pf-sec" aria-labelledby="h-plan">
            <h2 id="h-plan">Plan y suscripción</h2>
            <dl class="pf-detail">
              <div><dt>Contratado</dt><dd>{{ plans[a.plan] }}{{ a.billing_period ? ' · ' + (a.billing_period === 'annual' ? 'anual' : 'mensual') : '' }}</dd></div>
              <div><dt>Vigente</dt><dd>{{ plans[a.effective_plan] }}</dd></div>
              <div><dt>{{ endsLabel() }}</dt><dd>{{ a.ends_at ? fd(a.ends_at) + ' · ' + vence().text : '—' }}</dd></div>
              <div><dt>Tarjeta</dt><dd>{{ a.card || '—' }}</dd></div>
              <div><dt>Pasarela</dt><dd>{{ a.provider || '—' }}</dd></div>
              <div><dt>Prueba gratuita</dt><dd>{{ a.trial_used ? 'ya usada' : 'disponible' }}</dd></div>
              @if (a.cancel_at_period_end) { <div><dt>Cancelación</dt><dd>al terminar el periodo</dd></div> }
              @if (a.comp_reason) { <div><dt>Motivo de la cortesía</dt><dd>{{ a.comp_reason }}</dd></div> }
            </dl>
          </section>

          <section class="pf-sec" aria-labelledby="h-cob">
            <h2 id="h-cob">Cobros</h2>
            @if (a.payments.length) {
              <div class="pf-table-wrap">
                <table class="pf-table">
                  <thead><tr><th scope="col">Fecha</th><th scope="col">Plan</th><th scope="col" class="num">Importe</th><th scope="col">Estado</th></tr></thead>
                  <tbody>
                    @for (p of a.payments; track p.id) {
                      <tr>
                        <td>{{ fdt(p.occurred_at) }}@if (p.failure_reason) { <span class="sub">{{ p.failure_reason }}</span> }</td>
                        <td>{{ plans[p.plan] }}</td>
                        <td class="num">{{ money(p.amount_mxn) }}</td>
                        <td><span tuiBadge [tuiAppearance]="payTone[p.status]" size="m">{{ payLabel[p.status] }}</span></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else { <p class="pf-empty">Sin cobros registrados.</p> }
          </section>

          <section class="pf-sec" aria-labelledby="h-act">
            <h2 id="h-act">Actividad <small>bitácora de la cuenta</small></h2>
            @if (a.audit.length) {
              <ol class="pf-timeline">
                @for (e of timeline(); track $index) {
                  <li><time>{{ fdt(e.occurred_at) }}</time><span>{{ auditLabel[e.action] ?? e.action }}<small>{{ e.actor || 'Sistema' }}</small></span></li>
                }
              </ol>
              @if (a.audit.length > shown) {
                <button tuiButton appearance="flat" size="s" type="button" (click)="allAudit.set(!allAudit())">{{ allAudit() ? 'Ver menos' : 'Ver las ' + (a.audit.length - shown) + ' anteriores' }}</button>
              }
            } @else { <p class="pf-empty">Sin actividad registrada.</p> }
            <p class="pf-more"><a class="pf-link" routerLink="/plataforma/actividad" [queryParams]="{ cuenta: a.id }">Ver en la bitácora global (accesos, cobros y operación)</a></p>
          </section>
        </div>

        <div>
          <section class="pf-sec" aria-labelledby="h-uso">
            <h2 id="h-uso">Uso</h2>
            <ul class="pf-use">
              <li>
                <div class="line"><span>Pacientes activos</span><strong>{{ a.active_patients }}{{ limitedPatients() ? ' de ' + a.limits.active_patients : '' }}</strong></div>
                @if (limitedPatients()) { <progress tuiProgressBar size="s" [value]="a.active_patients" [max]="a.limits.active_patients" aria-label="Pacientes activos frente al límite del plan"></progress> }
                @else { <span class="pf-muted">Sin tope en este plan</span> }
              </li>
              <li>
                <div class="line"><span>Archivos</span><strong>{{ bytes(a.storage_bytes) }}{{ limitedStorage() ? ' de ' + bytes(a.limits.storage_bytes) : '' }}</strong></div>
                @if (limitedStorage()) { <progress tuiProgressBar size="s" [value]="a.storage_bytes" [max]="a.limits.storage_bytes" aria-label="Almacenamiento frente al límite del plan"></progress> }
                @else { <span class="pf-muted">Sin tope en este plan</span> }
              </li>
              <li><div class="line"><span>Usuarios</span><strong>{{ a.users }}</strong></div></li>
            </ul>
          </section>

          <section class="pf-sec" aria-labelledby="h-curso">
            <h2 id="h-curso">Solicitudes en curso</h2>
            @if (pending().length) {
              <ul class="pf-todo">
                @for (r of pending(); track r.id) {
                  <li>
                    <span class="pf-dot" style="--tone: var(--nutri-mantequilla)" aria-hidden="true"></span>
                    <strong>{{ kinds[r.kind] }}</strong>
                    <span class="why">«{{ r.reason }}» · pidió {{ r.requested_by_email }}</span>
                    <a class="go" routerLink="/plataforma/aprobaciones">Aprobaciones <app-icon name="arrow-right" [size]="14" /></a>
                  </li>
                }
              </ul>
            } @else { <p class="pf-empty">No hay solicitudes pendientes para esta cuenta.</p> }
          </section>

          <section class="pf-danger" aria-labelledby="h-peligro">
            @if (a.status === 'suspended') {
              <h2 id="h-peligro">Acceso suspendido</h2>
              <p>Reactivarla le devuelve el inicio de sesión de inmediato.</p>
              <div><button tuiButton appearance="secondary" size="s" type="button" (click)="show('reactivate')">Reactivar cuenta</button></div>
            } @else {
              <h2 id="h-peligro">Suspender el acceso</h2>
              <p>La cuenta no podrá iniciar sesión ni usar la API y se cerrarán sus sesiones. No se borra nada y se puede revertir.</p>
              <div><button tuiButton appearance="secondary-destructive" size="s" type="button" (click)="show('suspend')">Suspender cuenta…</button></div>
            }
          </section>
        </div>
      </div>
    }

    <ng-template [tuiDialog]="dialog() !== ''" [tuiDialogOptions]="{ label: title(), size: 's', dismissible: !busy() }" (tuiDialogChange)="$event || close()">
      <form class="pf-form" (ngSubmit)="submit()" #f="ngForm">
        @switch (dialog()) {
          @case ('comp') {
            <p class="pf-hint">La cuenta usa este plan sin cobro. Otra persona debe aprobarlo antes de que surta efecto.</p>
            <tui-textfield tuiChevron>
              <label tuiLabel for="d-plan">Plan</label>
              <input id="d-plan" tuiSelect name="plan" [(ngModel)]="planLabel" required />
              <tui-data-list-wrapper *tuiDropdown new [items]="planItems" />
            </tui-textfield>
            <tui-textfield><label tuiLabel for="d-days">Duración en días (1 a 366)</label><input id="d-days" tuiInputNumber name="days" [min]="1" [max]="366" [step]="1" required [(ngModel)]="days" /></tui-textfield>
            @if (days) { <p class="pf-hint">Si se aprueba hoy: plan {{ planLabel }} sin cobro hasta el {{ until() }}.</p> }
          }
          @case ('trial') {
            <p class="pf-hint">Agrega días a la prueba en curso. Otra persona debe aprobarlo.</p>
            <tui-textfield><label tuiLabel for="d-days">Días extra (1 a 30)</label><input id="d-days" tuiInputNumber name="days" [min]="1" [max]="30" [step]="1" required [(ngModel)]="days" /></tui-textfield>
          }
          @case ('refund') {
            <p class="pf-hint">Devuelve un cobro pagado. Otra persona debe aprobarlo.</p>
            <fieldset class="pf-radios">
              <legend>Cobro a devolver</legend>
              @for (p of paid(); track p.id) {
                <label><input type="radio" name="payment" [value]="p.id" [(ngModel)]="paymentId" required /> <span>{{ money(p.amount_mxn) }} · {{ plans[p.plan] }} · {{ fdt(p.occurred_at) }}</span></label>
              }
            </fieldset>
          }
          @case ('suspend') {
            <p class="pf-hint">Es inmediato: la cuenta pierde el acceso y sus sesiones se cierran. No se borra nada.</p>
            <tui-textfield><label tuiLabel for="d-confirm">Escribe «{{ d()?.name }}» para confirmar</label><input id="d-confirm" tuiInput name="confirm" autocomplete="off" [(ngModel)]="confirm" /></tui-textfield>
          }
          @case ('reactivate') { <p class="pf-hint">La cuenta vuelve a poder iniciar sesión.</p> }
        }
        @if (dialog() !== 'reactivate') {
          <tui-textfield>
            <label tuiLabel for="d-reason">Motivo</label>
            <textarea id="d-reason" tuiTextarea name="reason" rows="3" required [minlength]="minReason" [(ngModel)]="reason"></textarea>
          </tui-textfield>
          <p class="pf-hint" aria-live="polite">{{ reason.trim().length >= minReason ? 'Queda en la bitácora de la cuenta.' : 'Escribe al menos ' + minReason + ' caracteres (faltan ' + (minReason - reason.trim().length) + ').' }}</p>
        }
        @if (formError()) { <p class="pf-error" role="alert">{{ formError() }}</p> }
        <div class="pf-actions">
          <button tuiButton type="submit" [appearance]="dialog() === 'suspend' ? 'primary-destructive' : 'primary'" size="m" [disabled]="busy() || !valid()">{{ submitLabel() }}</button>
          <button tuiButton type="button" appearance="secondary" size="m" (click)="close()" [disabled]="busy()">Cancelar</button>
        </div>
      </form>
    </ng-template>
  `,
})
export class PlatformAccountPage {
  private readonly api = inject(PlatformApi);
  readonly id = input.required<string>();
  protected readonly d = signal<AccountDetail | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly dialog = signal<Dialog>('');
  protected readonly busy = signal(false);
  protected readonly formError = signal('');
  protected readonly copied = signal(false);
  protected readonly allAudit = signal(false);

  protected planLabel = 'Pro';
  protected readonly planItems = ['Estándar', 'Pro'];
  protected days: number | null = 30;
  protected reason = '';
  protected paymentId = '';
  protected confirm = '';
  protected readonly minReason = MIN_REASON;
  protected readonly shown = TIMELINE_SHOWN;

  protected readonly plans = PLAN_LABEL;
  protected readonly states = STATE_LABEL;
  protected readonly tone = STATE_TONE;
  protected readonly kinds = KIND_LABEL;
  protected readonly payLabel = PAYMENT_LABEL;
  protected readonly payTone = PAYMENT_TONE;
  protected readonly auditLabel = AUDIT_LABEL;
  protected readonly money = mxn;
  protected readonly bytes = formatBytes;
  protected readonly fd = fd;
  protected readonly fdt = fdt;

  protected readonly paid = computed<PaymentRow[]>(() => (this.d()?.payments ?? []).filter((p) => p.status === 'paid'));
  protected readonly pending = computed<ActionRow[]>(() => (this.d()?.actions ?? []).filter((r) => r.status === 'pending'));
  protected readonly timeline = computed(() => (this.allAudit() ? this.d()?.audit : this.d()?.audit.slice(0, TIMELINE_SHOWN)) ?? []);
  protected readonly vence = computed(() => when(this.d()?.ends_at));
  protected readonly endsLabel = computed(() => ({ trialing: 'Termina la prueba', past_due: 'Termina la gracia', active: 'Próxima renovación', canceled: 'Acceso hasta' })[this.d()?.state as string] ?? 'Vigente hasta');
  protected readonly limitedPatients = computed(() => limited(this.d()?.limits.active_patients));
  protected readonly limitedStorage = computed(() => limited(this.d()?.limits.storage_bytes));
  protected readonly title = computed(() => ({ comp: 'Plan de cortesía', trial: 'Prorrogar prueba', refund: 'Reembolsar un cobro', suspend: 'Suspender cuenta', reactivate: 'Reactivar cuenta', '': '' })[this.dialog()]);
  protected readonly submitLabel = computed(() => ({ comp: 'Pedir aprobación', trial: 'Pedir aprobación', refund: 'Pedir aprobación', suspend: 'Suspender ahora', reactivate: 'Reactivar', '': '' })[this.dialog()]);

  constructor() {
    // El id llega por la ruta; al cambiar de cuenta se vuelve a cargar.
    effect(() => { this.id(); this.d.set(null); this.error.set(''); this.load(); });
  }

  protected until(): string {
    const t = new Date(); t.setDate(t.getDate() + Number(this.days ?? 0));
    return t.toLocaleDateString('es-MX');
  }

  /** ¿El formulario del diálogo abierto está completo? (el botón explica lo que falta en el texto de ayuda). */
  protected valid(): boolean {
    const k = this.dialog();
    const reasonOk = this.reason.trim().length >= MIN_REASON;
    if (k === 'reactivate') return true;
    if (k === 'suspend') return reasonOk && this.confirm.trim() === this.d()?.name;
    if (k === 'refund') return reasonOk && !!this.paymentId;
    const n = Number(this.days);
    return reasonOk && Number.isInteger(n) && n >= 1 && n <= (k === 'comp' ? 366 : 30);
  }

  protected retry(): void { this.error.set(''); this.load(); }
  private load(): void {
    this.api.account(this.id()).subscribe({ next: (a) => this.d.set(a), error: (e: Error) => this.error.set(e.message) });
  }

  protected copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(() => { this.copied.set(true); setTimeout(() => this.copied.set(false), 2000); }).catch(() => undefined);
  }

  protected show(k: Dialog): void {
    this.dialog.set(k); this.formError.set(''); this.notice.set('');
    this.reason = ''; this.confirm = ''; this.days = k === 'trial' ? 7 : 30; this.planLabel = 'Pro';
    this.paymentId = this.paid()[0]?.id ?? '';
  }
  protected close(): void { if (!this.busy()) this.dialog.set(''); }

  protected submit(): void {
    if (!this.valid()) return;
    const k = this.dialog();
    const id = this.id();
    this.busy.set(true); this.formError.set('');
    const done = (msg: string) => () => { this.busy.set(false); this.dialog.set(''); this.notice.set(msg); this.load(); this.api.overview().subscribe({ error: () => undefined }); };
    const fail = (e: Error) => { this.busy.set(false); this.formError.set(e.message); };
    if (k === 'suspend') { this.api.suspend(id, this.reason.trim()).subscribe({ next: done('Cuenta suspendida.'), error: fail }); return; }
    if (k === 'reactivate') { this.api.reactivate(id).subscribe({ next: done('Cuenta reactivada.'), error: fail }); return; }
    const kind: ActionKind = k === 'comp' ? 'comp_plan' : k === 'trial' ? 'extend_trial' : 'refund';
    const plan: PlanCode = this.planLabel === 'Estándar' ? 'standard' : 'pro';
    const params: ActionRow['params'] = k === 'comp' ? { plan, days: Number(this.days) } : k === 'trial' ? { days: Number(this.days) } : { payment_id: this.paymentId };
    this.api.request(id, kind, params, this.reason.trim()).subscribe({ next: done('Solicitud creada. Otra persona debe aprobarla en Aprobaciones.'), error: fail });
  }
}
