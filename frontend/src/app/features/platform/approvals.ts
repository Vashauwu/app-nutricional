import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiSegmented } from '@taiga-ui/kit/components/segmented';
import { TuiTextarea } from '@taiga-ui/kit/components/textarea';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiDialog } from '@taiga-ui/core/portals/dialog';
import { TuiLoader } from '@taiga-ui/core/components/loader';
import { ActionRow, PlatformApi } from '../../core/api/platform-api';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/components/icon';
import { PageHeader } from '../../shared/components/page-header';
import { ACTION_LABEL, ACTION_TONE, KIND_LABEL, PLAN_LABEL, fd, fdt, nf } from './labels';

@Component({
  selector: 'app-platform-approvals',
  imports: [FormsModule, RouterLink, TuiAppearance, TuiBadge, TuiButton, TuiDialog, TuiLoader, TuiSegmented, TuiTextarea, Icon, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Aprobaciones" sub="Lo que cuesta dinero lo pide una persona y lo aprueba otra" />

    <tui-segmented class="seg" [activeItemIndex]="tab()" (activeItemIndexChange)="setTab($event)" aria-label="Filtrar solicitudes">
      <button type="button">Pendientes@if (pendingCount() > 0) { ({{ pendingCount() }}) }</button>
      <button type="button">Historial</button>
    </tui-segmented>

    @if (error()) { <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>No se pudo cargar.</strong><span>{{ error() }}</span></div></div> }
    @if (notice()) { <div class="callout callout--ok" role="status"><app-icon name="check-circle" /><div class="callout-body"><strong>{{ notice() }}</strong></div></div> }

    <section class="pf-card" style="margin-block-start: 1rem" aria-label="Solicitudes">
      <tui-loader [loading]="loading()" [overlay]="true">
        @if (shown().length) {
          <ul class="pf-list">
            @for (r of shown(); track r.id) {
              <li>
                <span class="who">
                  <strong>{{ kinds[r.kind] }} · <a [routerLink]="['/plataforma/cuentas', r.practice_id]">{{ r.practice_name }}</a></strong>
                  <small>{{ detail(r) }}</small>
                  <small>«{{ r.reason }}» · pidió {{ r.requested_by_email }} el {{ fdt(r.requested_at) }}</small>
                  @if (r.decision_note) { <small>Nota: {{ r.decision_note }}</small> }
                  @if (r.error) { <small class="pf-error">Error: {{ r.error }}</small> }
                </span>
                @if (r.status === 'pending') {
                  <span class="pf-actions">
                    <button tuiButton appearance="primary" size="s" type="button" (click)="ask(r, true)">Aprobar</button>
                    <button tuiButton appearance="secondary" size="s" type="button" (click)="ask(r, false)">Rechazar</button>
                  </span>
                } @else { <span tuiBadge [tuiAppearance]="tone[r.status]" size="m">{{ labels[r.status] }}</span> }
              </li>
            }
          </ul>
        } @else if (!loading()) {
          <p class="pf-empty">{{ tab() === 0 ? 'No hay solicitudes pendientes.' : 'Todavía no hay solicitudes resueltas.' }}</p>
        }
      </tui-loader>
    </section>

    <ng-template [tuiDialog]="current() !== null" [tuiDialogOptions]="{ label: approve() ? 'Aprobar y ejecutar' : 'Rechazar solicitud', size: 's', dismissible: !busy() }" (tuiDialogChange)="$event || close()">
      @if (current(); as r) {
        <form class="pf-form" (ngSubmit)="submit()">
          <p class="sub"><strong>{{ kinds[r.kind] }}</strong> · {{ r.practice_name }}<br />{{ detail(r) }}</p>
          @if (approve() && isMine(r)) { <div class="callout callout--warn" role="status"><app-icon name="alert" /><div class="callout-body"><strong>Tú pediste esto.</strong><span>Solo otra persona puede aprobarlo.</span></div></div> }
          <tui-textfield><label tuiLabel for="a-note">Nota (opcional)</label><textarea id="a-note" tuiTextarea name="note" rows="2" [(ngModel)]="note"></textarea></tui-textfield>
          @if (formError()) { <p class="pf-error" role="alert">{{ formError() }}</p> }
          <div class="pf-actions">
            <button tuiButton type="submit" [appearance]="approve() ? 'primary' : 'primary-destructive'" size="m" [disabled]="busy()">{{ approve() ? 'Aprobar y ejecutar' : 'Rechazar' }}</button>
            <button tuiButton type="button" appearance="secondary" size="m" (click)="close()" [disabled]="busy()">Cancelar</button>
          </div>
        </form>
      }
    </ng-template>
  `,
})
export class PlatformApprovals {
  protected readonly fd = fd; protected readonly fdt = fdt; protected readonly nf = nf;
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

  protected readonly pendingCount = computed(() => this.all().filter((r) => r.status === 'pending').length);
  protected readonly shown = computed(() => this.all().filter((r) => (this.tab() === 0 ? r.status === 'pending' : r.status !== 'pending')));

  constructor() { this.load(); }

  private load(): void {
    this.loading.set(true);
    this.api.actions().subscribe({
      next: (r) => { this.all.set(r.items); this.api.setPending(r.items.filter((x) => x.status === 'pending').length); this.loading.set(false); },
      error: (e: Error) => { this.error.set(e.message); this.loading.set(false); },
    });
  }

  protected setTab(i: number): void { this.tab.set(i); }
  protected isMine(r: ActionRow): boolean { return r.requested_by_email === this.auth.user()?.email; }

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
        this.notice.set(res.status === 'failed' ? `Se aprobó, pero no se pudo ejecutar: ${res.error}` : this.approve() ? 'Solicitud aprobada y ejecutada.' : 'Solicitud rechazada.');
        this.load();
      },
      error: (e: Error) => { this.busy.set(false); this.formError.set(e.message); },
    });
  }
}
