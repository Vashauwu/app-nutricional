import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { Icon } from './icon';
import { Modal } from './modal';

/**
 * Enlace de invitación para compartir a mano (cuando el servidor no tiene correo configurado).
 * El enlace es una credencial de un solo uso: quien lo abre define la contraseña de la paciente.
 */
@Component({
  selector: 'app-invite-link',
  imports: [TuiButton, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="!!link()" (closed)="closed.emit()" title="Enlace de invitación">
      <p>No hay correo configurado, así que comparte este enlace con <strong>{{ who() }}</strong> por un medio que solo ella use (por ejemplo, WhatsApp).</p>
      <div class="field"><label for="inv-link">Enlace (válido 7 días, un solo uso)</label><input id="inv-link" class="input" readonly [value]="link()" (focus)="$any($event.target).select()" /></div>
      <div class="callout callout--warn"><app-icon name="alert" /><div class="callout-body"><p>Quien abra el enlace crea la contraseña de la cuenta. No lo uses tú: el registro de consentimientos debe hacerlo la paciente. Que hayas visto este enlace queda registrado en auditoría.</p></div></div>
      <ng-container modalFooter>
        <button tuiButton type="button" appearance="secondary" size="m" (click)="closed.emit()">Cerrar</button>
        <button tuiButton type="button" size="m" (click)="copy()"><app-icon name="copy" [size]="16" /> {{ copied() ? 'Copiado' : 'Copiar enlace' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class InviteLink {
  readonly link = input<string | null>(null);
  readonly who = input('la paciente');
  readonly closed = output<void>();
  protected readonly copied = signal(false);

  protected async copy(): Promise<void> {
    const l = this.link();
    if (!l) return;
    try {
      await navigator.clipboard.writeText(l);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      (document.getElementById('inv-link') as HTMLInputElement | null)?.select();
    }
  }
}
