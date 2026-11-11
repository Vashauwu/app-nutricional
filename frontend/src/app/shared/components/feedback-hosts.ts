import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { Icon } from './icon';
import { Modal } from './modal';

@Component({
  selector: 'app-toast-host',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { position: fixed; inset-inline: 0; inset-block-end: 1rem; z-index: 200; display: grid; justify-items: center; gap: .5rem; pointer-events: none; padding-inline: 1rem; }
    .toast { pointer-events: auto; display: flex; align-items: center; gap: .75rem; max-inline-size: 34rem; padding: .75rem 1rem; border-radius: var(--radius-s);
      background: var(--nutri-texto-fuerte); color: var(--nutri-marfil); box-shadow: var(--shadow-m); }
    .toast.error { background: var(--danger); }
    button { color: inherit; }
    @media (prefers-reduced-motion: no-preference) { .toast { animation: up .2s ease-out; } @keyframes up { from { opacity: 0; transform: translateY(10px); } } }
  `,
  template: `
    <div role="status" aria-live="polite" style="display: contents">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class.error]="t.kind === 'error'">
          <app-icon [name]="t.kind === 'error' ? 'alert-circle' : t.kind === 'ok' ? 'check-circle' : 'info'" />
          <span>{{ t.message }}</span>
          <button type="button" class="icon-btn icon-btn--s" aria-label="Cerrar aviso" (click)="toasts.dismiss(t.id)"><app-icon name="x" [size]="16" /></button>
        </div>
      }
    </div>
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);
}

@Component({
  selector: 'app-confirm-host',
  imports: [Modal, TuiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (req(); as r) {
      <app-modal [open]="true" [title]="r.title" size="narrow" (closed)="r.resolve(false)">
        <p>{{ r.message }}</p>
        <ng-container modalFooter>
          <button tuiButton type="button" appearance="secondary" size="m" (click)="r.resolve(false)">Cancelar</button>
          <button tuiButton type="button" [appearance]="r.tone === 'danger' ? 'primary-destructive' : 'primary'" size="m" (click)="r.resolve(true)">{{ r.confirmLabel }}</button>
        </ng-container>
      </app-modal>
    }
  `,
})
export class ConfirmHost {
  private readonly confirm = inject(ConfirmService);
  protected readonly req = computed(() => this.confirm.request());
}
