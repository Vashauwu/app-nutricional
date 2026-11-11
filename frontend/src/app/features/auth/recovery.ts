import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/services/ui.services';
import { FieldError, matchField, strongPassword } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink, TuiButton, Icon, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <main class="panel-wrap" id="contenido" style="min-block-size: 100dvh">
      <div class="card">
        <a routerLink="/ingresar" class="small"><app-icon name="arrow-left" [size]="14" /> Volver a ingresar</a>
        <div>
          <h2>Recuperar contraseña</h2>
          <p class="muted">Te enviaremos un enlace al correo registrado. Vence en 30 minutos y solo se puede usar una vez.</p>
        </div>

        @if (sent()) {
          <div class="callout callout--ok" role="status">
            <app-icon name="check-circle" />
            <div class="callout-body">
              <p>Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.</p>
              <p class="small muted">Por seguridad, no confirmamos si una cuenta existe.</p>
            </div>
          </div>
          @if (demoLink()) {
            <div class="demo"><p class="small"><strong>Modo demostración:</strong> aún no hay proveedor de correo. Usa este enlace:</p><a [routerLink]="demoLink()" class="small">Abrir enlace de restablecimiento</a></div>
          }
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
            <div class="field">
              <label for="fp-email">Correo electrónico</label>
              <input id="fp-email" class="input" type="email" formControlName="email" autocomplete="email" inputmode="email" aria-describedby="fp-err" />
              <app-field-error id="fp-err" [control]="form.controls.email" />
            </div>
            <button tuiButton type="submit" size="l" [disabled]="loading()">{{ loading() ? 'Enviando…' : 'Enviar enlace' }}</button>
          </form>
        }
      </div>
    </main>
  `,
})
export class ForgotPassword {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  protected readonly loading = signal(false);
  protected readonly sent = signal(false);
  protected readonly demoLink = signal<string | null>(null);
  protected readonly form = this.fb.nonNullable.group({ email: ['', [Validators.required, Validators.email]] });

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.loading.set(true);
    this.auth.requestPasswordReset(this.form.getRawValue().email).subscribe((r) => {
      this.loading.set(false);
      this.sent.set(true);
      this.demoLink.set(r.demoLink);
    });
  }
}

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink, TuiButton, Icon, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <main class="panel-wrap" id="contenido" style="min-block-size: 100dvh">
      <div class="card">
        @if (!valid()) {
          <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><p><strong>Enlace no válido o vencido.</strong></p><p class="small">Los enlaces duran 30 minutos y solo funcionan una vez.</p></div></div>
          <a tuiButton appearance="secondary" size="m" routerLink="/recuperar">Solicitar un enlace nuevo</a>
        } @else {
          <div><h2>Crea tu nueva contraseña</h2><p class="muted">Al guardarla se cerrarán tus sesiones abiertas.</p></div>
          @if (error()) { <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body">{{ error() }}</div></div> }
          <form [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
            <div class="field">
              <label for="np">Contraseña nueva</label>
              <input id="np" class="input" type="password" formControlName="password" autocomplete="new-password" aria-describedby="np-hint np-err" />
              <span class="hint" id="np-hint">Mínimo 8 caracteres, con una letra y un número.</span>
              <app-field-error id="np-err" [control]="form.controls.password" />
            </div>
            <div class="field">
              <label for="np2">Repite la contraseña</label>
              <input id="np2" class="input" type="password" formControlName="confirm" autocomplete="new-password" aria-describedby="np2-err" />
              <app-field-error id="np2-err" [control]="form.controls.confirm" />
            </div>
            <button tuiButton type="submit" size="l" [disabled]="loading()">{{ loading() ? 'Guardando…' : 'Guardar contraseña' }}</button>
          </form>
        }
      </div>
    </main>
  `,
})
export class ResetPassword {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';
  protected readonly valid = signal(this.auth.isResetTokenValid(this.token));
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly form = this.fb.nonNullable.group({
    password: ['', [Validators.required, strongPassword]],
    confirm: ['', [Validators.required, matchField('password')]],
  });

  constructor() {
    this.form.controls.password.valueChanges.subscribe(() => this.form.controls.confirm.updateValueAndValidity());
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.loading.set(true);
    this.auth.resetPassword(this.token, this.form.getRawValue().password).subscribe({
      next: () => {
        this.toast.ok('Contraseña actualizada. Ya puedes ingresar.');
        void this.router.navigate(['/ingresar']);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(e instanceof Error ? e.message : 'No se pudo cambiar la contraseña.');
      },
    });
  }
}
