import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/services/ui.services';
import { Icon } from '../../shared/components/icon';

@Component({
  selector: 'app-patient-consent',
  imports: [TuiButton, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .doc { max-block-size: 14rem; overflow: auto; padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-s); background: var(--nutri-marfil); white-space: pre-wrap; font-size: .9375rem; }
  `,
  template: `
    <div class="stack" style="padding-block-start: var(--space-3)">
      <header><h1 style="font-size: 1.75rem">Antes de empezar</h1><p class="muted">Para proteger tu información, necesitamos tu aceptación. Hasta entonces tu expediente y tu plan permanecen cerrados.</p></header>
      @for (d of pending(); track d.id) {
        <section class="panel" [attr.aria-labelledby]="'c-' + d.id">
          <h2 [id]="'c-' + d.id" class="panel-head" style="font-size: 1.125rem">{{ d.title }} <span class="small muted">· versión {{ d.version }}</span></h2>
          <div class="doc" tabindex="0" role="region" [attr.aria-label]="'Texto de ' + d.title">{{ d.content }}</div>
          <label class="check"><input type="checkbox" [checked]="accepted().includes(d.id)" (change)="toggle(d.id)" /> <span>He leído y acepto el {{ d.title.toLowerCase() }}.</span></label>
        </section>
      }
      <div class="callout"><app-icon name="info" /><div class="callout-body">Puedes revocar tu consentimiento o ejercer tus derechos ARCO escribiendo a tu nutrióloga. Se registra la fecha, la versión y el dispositivo desde el que aceptas.</div></div>
      <div class="form-actions"><button tuiButton type="button" appearance="secondary" size="m" (click)="exit()">Salir</button><button tuiButton type="button" size="l" [disabled]="accepted().length !== pending().length" (click)="accept()">Aceptar y continuar</button></div>
    </div>
  `,
})
export class PatientConsent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly pending = computed(() => this.auth.pendingConsents(this.auth.patientId()));
  protected readonly accepted = signal<string[]>([]);

  protected toggle(id: string): void { this.accepted.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); }

  protected accept(): void {
    const pid = this.auth.patientId();
    if (!pid) return;
    this.auth.acceptConsents(pid, this.accepted()).subscribe({
      next: () => {
        this.toast.ok('Gracias. Tu expediente ya está habilitado.');
        void this.router.navigate(['/paciente']);
      },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar la aceptación.'),
    });
  }

  protected exit(): void {
    this.auth.logout();
    void this.router.navigate(['/ingresar']);
  }
}
