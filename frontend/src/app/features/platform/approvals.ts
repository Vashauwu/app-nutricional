import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiDialog } from '@taiga-ui/core/portals/dialog';
import { TuiSkeleton } from '@taiga-ui/kit/directives/skeleton';
import { TuiTabs } from '@taiga-ui/kit/components/tabs';
import { TuiTextarea } from '@taiga-ui/kit/components/textarea';
import { ActionRow, PlatformApi } from '../../core/api/platform-api';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/components/icon';
import { PfHead } from './head';
import { ACTION_LABEL, ACTION_TONE, KIND_LABEL, PLAN_LABEL, TONE_VAR, fdt } from './labels';

@Component({
  selector: 'app-platform-approvals',
  imports: [FormsModule, RouterLink, TuiAppearance, TuiBadge, TuiButton, TuiDialog, TuiSkeleton, TuiTabs, TuiTextarea, Icon, PfHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-pf-head title="Aprobaciones" sub="Lo que cuesta dinero lo pide una persona y lo aprueba otra" />

    <tui-tabs class="pf-tabs" [activeItemIndex]="tab()" (activeItemIndexChange)="tab.set($event)">
      <button tuiTab type="button">Pendientes{{ pendingCount() ? ' (' + pendingCount() + ')' : '' }}</button>
      <button tuiTab type="button">Historial</button>
    </tui-tabs>

    @if (error()) {
      <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>No se pudo cargar.</strong><span>{{ error() }}</span><span><button tuiButton appearance="secondary" size="s" type="button" (click)="load()">Reintentar</button></span></div></div>
    }
    @if (notice()) { <div class="callout callout--ok" role="status"><app-icon name="check-circle" /><div class="callout-body"><strong>{{ notice() }}</strong></div></div> }

    @if (loading() && !all().length) {
      <ul class="pf-todo" aria-hidden="true"><li><span class="pf-dot"></span><strong [tuiSkeleton]="true">Plan de cortesía · Cuenta</strong><span class="why" [tuiSkeleton]="true">Motivo de la solicitud y quién la pidió</span></li></ul>
    } @else if (shown().length) {
      <ul class="pf-todo">
        @for (r of shown(); track r.id) {
          <li>
            <span class="pf-dot" [style.--tone]="dot(r)" aria-hidden="true"></span>
            <strong>{{ kinds[r.kind] }} · <a [routerLink]="['/plataforma/cuentas', r.practice_id]" style="color:inherit">{{ r.practice_name }}</a></strong>
            <span class="why">{{ detail(r) }}</span>
            <span class="why">«{{ r.reason }}» · pidió {{ isMine(r) ? 'tú' : r.requested_by_email }} el {{ fdt(r.requested_at) }}</span>
            @if (r.status !== 'pending' && r.decided_by_email) { <span class="why">{{ labels[r.status] }} por {{ r.decided_by_email }}{{ r.decided_at ? ' el ' + fdt(r.decided_at) : '' }}{{ r.decision_note ? ' · «' + r.decision_note + '»' : '' }}</span> }
            @if (r.error) { <span class="why pf-error">No se pudo ejecutar: {{ r.error }}</span> }
            @if (r.status === 'pending') {
              <span class="pf-actions" style="grid-column: 3; grid-row: 1 / span 4; align-self: center">
                @if (isMine(r)) {
                  <span class="pf-muted" style="font-size:.8125rem">Espera a otra persona</span>
                  <button tuiButton appearance="secondary" size="s" type="button" (click)="ask(r, false)">Retirar</button>
                } @else {
                  <button tuiButton appearance="primary" size="s" type="button" (click)="ask(r, true)">Aprobar</button>
                  <button tuiButton appearance="secondary" size="s" type="button" (click)="ask(r, false)">Rechazar</button>
                }
              </span>
            } @else { <span tuiBadge [tuiAppearance]="tone[r.status]" size="m" style="grid-column: 3; grid-row: 1">{{ labels[r.status] }}</span> }
          </li>
        }
      </ul>
    } @else {
      <p class="pf-empty">{{ tab() === 0 ? 'No hay solicitudes pendientes. Las cortesías, prórrogas y reembolsos que alguien pida aparecerán aquí.' : 'Todavía no hay solicitudes resueltas.' }}</p>
    }

    <ng-template [tuiDialog]="current() !== null" [tuiDialogOptions]="{ label: approve() ? 'Aprobar y ejecutar' : (current() && isMine(current()!) ? 'Retirar solicitud' : 'Rechazar solicitud'), size: 's', dismissible: !busy() }" (tuiDialogChange)="$event || close()">
      @if (current(); as r) {
        <form class="pf-form" (ngSubmit)="submit()">
          <p class="pf-hint"><strong>{{ kinds[r.kind] }}</strong> · {{ r.practice_name }}<br />{{ detail(r) }}</p>
          @if (approve()) { <p class="pf-hint">Se ejecuta en el acto y queda en la bitácora de la cuenta con tu nombre.</p> }
          <tui-textfield><label tuiLabel for="a-note">Nota (opcional)</label><textarea id="a-note" tuiTextarea name="note" rows="2" [(ngModel)]="note"></textarea></tui-textfield>
          @if (formError()) { <p class="pf-error" role="alert">{{ formError() }}</p> }
          <div class="pf-actions">
            <button tuiButton type="submit" [appearance]="approve() ? 'primary' : 'primary-destructive'" size="m" [disabled]="busy()">{{ approve() ? 'Aprobar y ejecutar' : (isMine(r) ? 'Retirar' : 'Rechazar') }}</button>
            <button tuiButton type="button" appearance="secondary" size="m" (click)="close()" [disabled]="busy()">Cancelar</button>
          </div>
        </form>
      }
    </ng-template>
  `,
})
export class PlatformApprovals {
  private readonly api = inject(PlatformApi);
  private readonly auth = inject(AuthService);
  protected readonly tab = signal(0);
  protected readonly all = signal<ActionRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly current = signal<ActionRow | null>(null);
  protected readonly approve = signal(true);
  protected readonly busy = signal(false);
  protected readonly formError = signal('');
  protected note = '';
  protected readonly kinds = KIND_LABEL;
  protected readonly labels = ACTION_LABEL;
  protected readonly tone = ACTION_TONE;
  protected readonly fdt = fdt;
  protected readonly pendingCount = computed(() => this.all().filter((r) => r.status === 'pending').length);
  protected readonly shown = computed(() => this.all().filter((r) => (this.tab() === 0 ? r.status === 'pending' : r.status !== 'pending')));

  constructor() { this.load(); }

  protected load(): void {
    this.loading.set(true); this.error.set('');
    this.api.actions().subscribe({
      next: (r) => { this.all.set(r.items); this.api.setPending(r.items.filter((x) => x.status === 'pending').length); this.loading.set(false); },
      error: (e: Error) => { this.error.set(e.message); this.loading.set(false); },
    });
  }

  protected dot(r: ActionRow): string { return TONE_VAR[this.tone[r.status]]; }
  protected isMine(r: ActionRow): boolean { return !!r.requested_by_email && r.requested_by_email === this.auth.user()?.email; }

  protected detail(r: ActionRow): string {
    const p = r.params;
    if (r.kind === 'comp_plan') return `Plan ${PLAN_LABEL[p.plan ?? 'free']} sin cobro por ${p.days} días`;
    if (r.kind === 'extend_trial') return `${p.days} días más de prueba`;
    return 'Devolución de un cobro pagado';
  }

  protected ask(r: ActionRow, approve: boolean): void { this.current.set(r); this.approve.set(approve); this.note = ''; this.formError.set(''); this.notice.set(''); }
  protected close(): void { if (!this.busy()) this.current.set(null); }

  protected submit(): void {
    const r = this.current();
    if (!r) return;
    this.busy.set(true); this.formError.set('');
    this.api.decide(r.id, this.approve(), this.note).subscribe({
      next: (res) => {
        this.busy.set(false); this.current.set(null);
        this.notice.set(res.status === 'failed' ? `Se aprobó, pero no se pudo ejecutar: ${res.error}` : this.approve() ? 'Solicitud aprobada y ejecutada.' : this.isMine(r) ? 'Solicitud retirada.' : 'Solicitud rechazada.');
        this.load();
      },
      error: (e: Error) => { this.busy.set(false); this.formError.set(e.message); },
    });
  }
}
