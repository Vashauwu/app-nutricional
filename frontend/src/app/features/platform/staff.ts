import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiChevron } from '@taiga-ui/kit/directives/chevron';
import { TuiDataListWrapper } from '@taiga-ui/kit/components/data-list-wrapper';
import { TuiDialog } from '@taiga-ui/core/portals/dialog';
import { TuiInput } from '@taiga-ui/core/components/input';
import { TuiSelect } from '@taiga-ui/kit/components/select';
import { TuiSkeleton } from '@taiga-ui/kit/directives/skeleton';
import { PlatformApi, StaffInvite, StaffRole, StaffRow } from '../../core/api/platform-api';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/components/icon';
import { PfHead } from './head';
import { ROLE_HELP, ROLE_LABEL, STAFF_STATUS_LABEL, STAFF_STATUS_TONE, fdt } from './labels';

const ASSIGNABLE: StaffRole[] = ['platform_owner', 'platform_support', 'platform_viewer', 'platform_content'];
const ROLE_ITEMS = ASSIGNABLE.map((r) => ROLE_LABEL[r]);
const roleOf = (label: string): StaffRole => ASSIGNABLE.find((r) => ROLE_LABEL[r] === label) ?? 'platform_viewer';

type Dialog = '' | 'invite' | 'role';

/**
 * Equipo del CRM: quién puede entrar al panel y con qué alcance. Son personas aparte de las nutriólogas (sin consulta ni acceso
 * clínico). Solo lo ve quien tiene el permiso de administrar al equipo; el servidor valida igual cada cambio y nunca deja la
 * plataforma sin una persona activa con control total.
 */
@Component({
  selector: 'app-platform-staff',
  imports: [FormsModule, TuiAppearance, TuiBadge, TuiButton, TuiChevron, TuiDataListWrapper, TuiDialog, TuiInput, TuiSelect, TuiSkeleton, Icon, PfHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-pf-head title="Equipo" sub="Quién entra al panel y qué puede hacer. Cada cambio queda en Actividad.">
      <button tuiButton appearance="primary" size="s" type="button" (click)="openInvite()"><app-icon name="user-plus" [size]="16" /> Invitar persona</button>
    </app-pf-head>

    @if (error()) {
      <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>{{ error() }}</strong></div></div>
    }
    @if (notice()) { <div class="callout callout--ok" role="status"><app-icon name="check-circle" /><div class="callout-body"><strong>{{ notice() }}</strong></div></div> }

    @if (shared(); as s) {
      <div class="callout callout--info" role="status">
        <app-icon name="alert-circle" />
        <div class="callout-body">
          <strong>{{ s.emailed ? 'Invitación enviada' : 'No hay correo configurado: comparte este enlace' }} a {{ s.staff.email }}.</strong>
          @if (s.link) {
            <span class="pf-linkbox"><code>{{ s.link }}</code> <button tuiButton appearance="secondary" size="xs" type="button" (click)="copy(s.link)">{{ copied() ? 'Copiado' : 'Copiar enlace' }}</button></span>
            <span class="pf-muted">Sirve una vez y vence en 7 días. No lo publiques.</span>
          }
          <span><button tuiButton appearance="flat" size="s" type="button" (click)="shared.set(null)">Cerrar</button></span>
        </div>
      </div>
    }

    <div class="pf-table-wrap" [attr.aria-busy]="loading()">
      <table class="pf-table pf-table--cards">
        <caption class="pf-sr">Personas del equipo del CRM</caption>
        <thead><tr><th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Último acceso</th><th scope="col"><span class="pf-sr">Acciones</span></th></tr></thead>
        <tbody>
          @if (loading() && !rows().length) {
            @for (i of [1, 2, 3]; track i) { <tr aria-hidden="true"><td colspan="5"><span [tuiSkeleton]="true">Persona de ejemplo con correo largo</span></td></tr> }
          }
          @for (p of rows(); track p.id) {
            <tr>
              <td class="main"><strong>{{ p.name || p.email }}</strong><span class="sub">{{ p.email }}{{ isMe(p) ? ' · tú' : '' }}</span></td>
              <td data-label="Rol">{{ roles[p.role] ?? p.role }}</td>
              <td data-label="Estado"><span tuiBadge [tuiAppearance]="tone[p.status]" size="m">{{ statuses[p.status] }}</span></td>
              <td data-label="Último acceso" class="pf-muted">{{ p.last_login_at ? fdt(p.last_login_at) : 'Nunca' }}</td>
              <td class="go-acts">
                @if (!isMe(p)) {
                  <div class="acts">
                  <button tuiButton appearance="secondary" size="xs" type="button" (click)="openRole(p)">Cambiar rol</button>
                  @if (p.status === 'invited') { <button tuiButton appearance="secondary" size="xs" type="button" [disabled]="busy()" (click)="resend(p)">Reenviar invitación</button> }
                  @if (p.status === 'disabled') { <button tuiButton appearance="secondary" size="xs" type="button" [disabled]="busy()" (click)="toggle(p, true)">Habilitar</button> }
                  @else { <button tuiButton appearance="secondary-destructive" size="xs" type="button" [disabled]="busy()" (click)="toggle(p, false)">Deshabilitar</button> }
                  </div>
                }
              </td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="5" class="pf-empty" style="text-align:center">Todavía no hay personas en el equipo.</td></tr> }
          }
        </tbody>
      </table>
    </div>

    <section class="pf-sec" aria-labelledby="h-roles">
      <h2 id="h-roles">Qué puede hacer cada rol</h2>
      <dl class="pf-detail">
        @for (r of assignable; track r) { <div><dt>{{ roles[r] }}</dt><dd>{{ help[r] }}</dd></div> }
      </dl>
    </section>

    <ng-template [tuiDialog]="dialog() !== ''" [tuiDialogOptions]="{ label: dialog() === 'invite' ? 'Invitar a una persona' : 'Cambiar rol', size: 's', dismissible: !busy() }" (tuiDialogChange)="$event || close()">
      <form class="pf-form" (ngSubmit)="submit()">
        @if (dialog() === 'invite') {
          <tui-textfield><label tuiLabel for="st-name">Nombre</label><input id="st-name" tuiInput name="nombre" autocomplete="off" maxlength="80" [(ngModel)]="name" required /></tui-textfield>
          <tui-textfield><label tuiLabel for="st-mail">Correo</label><input id="st-mail" tuiInput type="email" name="correo" autocomplete="off" [(ngModel)]="email" required /></tui-textfield>
          <p class="pf-hint">Recibirá un enlace para crear su contraseña. No usa la aplicación clínica: solo este panel.</p>
        } @else if (target(); as t) {
          <p class="pf-hint"><strong>{{ t.name || t.email }}</strong> · hoy: {{ roles[t.role] ?? t.role }}</p>
        }
        <tui-textfield tuiChevron [tuiTextfieldCleaner]="false">
          <label tuiLabel for="st-role">Rol</label>
          <input id="st-role" tuiSelect name="rol" [(ngModel)]="roleLabel" />
          <tui-data-list-wrapper *tuiDropdown new [items]="roleItems" />
        </tui-textfield>
        <p class="pf-hint">{{ help[pickedRole()] }}</p>
        @if (formError()) { <p class="pf-error" role="alert">{{ formError() }}</p> }
        <div class="pf-actions">
          <button tuiButton type="submit" appearance="primary" size="m" [disabled]="busy()">{{ dialog() === 'invite' ? 'Enviar invitación' : 'Guardar rol' }}</button>
          <button tuiButton type="button" appearance="secondary" size="m" (click)="close()" [disabled]="busy()">Cancelar</button>
        </div>
      </form>
    </ng-template>
  `,
})
export class PlatformStaff {
  private readonly api = inject(PlatformApi);
  private readonly auth = inject(AuthService);
  protected readonly rows = signal<StaffRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly formError = signal('');
  protected readonly copied = signal(false);
  protected readonly shared = signal<StaffInvite | null>(null);
  protected readonly dialog = signal<Dialog>('');
  protected readonly target = signal<StaffRow | null>(null);
  protected name = '';
  protected email = '';
  protected roleLabel = ROLE_LABEL['platform_support'];
  protected readonly assignable = ASSIGNABLE;
  protected readonly roleItems = ROLE_ITEMS;
  protected readonly roles = ROLE_LABEL;
  protected readonly help = ROLE_HELP;
  protected readonly statuses = STAFF_STATUS_LABEL;
  protected readonly tone = STAFF_STATUS_TONE;
  protected readonly fdt = fdt;
  protected readonly pickedRole = computed(() => roleOf(this.roleLabel));

  constructor() { this.load(); }

  protected isMe(p: StaffRow): boolean { return p.email.toLowerCase() === (this.auth.user()?.email ?? '').toLowerCase(); }

  private load(): void {
    this.loading.set(true);
    this.api.staff().subscribe({
      next: (r) => { this.rows.set(r.items); this.loading.set(false); },
      error: (e: Error) => { this.error.set(e.message); this.loading.set(false); },
    });
  }

  protected openInvite(): void { this.name = ''; this.email = ''; this.roleLabel = ROLE_LABEL['platform_support']; this.formError.set(''); this.notice.set(''); this.dialog.set('invite'); }
  protected openRole(p: StaffRow): void { this.target.set(p); this.roleLabel = ROLE_LABEL[p.role === 'platform_admin' ? 'platform_owner' : p.role]; this.formError.set(''); this.notice.set(''); this.dialog.set('role'); }
  protected close(): void { if (!this.busy()) { this.dialog.set(''); this.target.set(null); } }

  protected submit(): void {
    this.busy.set(true); this.formError.set('');
    if (this.dialog() === 'invite') {
      this.api.inviteStaff(this.email.trim(), this.name.trim(), this.pickedRole()).subscribe({
        next: (r) => { this.busy.set(false); this.dialog.set(''); this.shared.set(r); this.load(); },
        error: (e: Error) => { this.busy.set(false); this.formError.set(e.message); },
      });
      return;
    }
    const t = this.target();
    if (!t) { this.busy.set(false); return; }
    this.api.setStaffRole(t.id, this.pickedRole()).subscribe({
      next: () => { this.busy.set(false); this.dialog.set(''); this.target.set(null); this.notice.set('Rol actualizado.'); this.load(); },
      error: (e: Error) => { this.busy.set(false); this.formError.set(e.message); },
    });
  }

  protected resend(p: StaffRow): void {
    this.busy.set(true); this.error.set(''); this.notice.set('');
    this.api.resendStaffInvite(p.id).subscribe({
      next: (r) => { this.busy.set(false); this.shared.set(r); },
      error: (e: Error) => { this.busy.set(false); this.error.set(e.message); },
    });
  }

  protected toggle(p: StaffRow, enable: boolean): void {
    this.busy.set(true); this.error.set(''); this.notice.set('');
    this.api.setStaffEnabled(p.id, enable).subscribe({
      next: () => { this.busy.set(false); this.notice.set(enable ? 'Persona habilitada.' : 'Persona deshabilitada: se cerraron sus sesiones.'); this.load(); },
      error: (e: Error) => { this.busy.set(false); this.error.set(e.message); },
    });
  }

  protected copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(() => { this.copied.set(true); setTimeout(() => this.copied.set(false), 2000); }).catch(() => undefined);
  }
}
