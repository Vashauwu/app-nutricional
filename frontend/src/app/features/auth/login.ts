import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthError, AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { showDemoAccounts } from '../../core/api/api-client';
import { SettingsService } from '../../core/services/settings.service';
import { FieldError } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { GoogleButton } from '../../shared/components/google-button';
import { ThemeToggle } from '../../shared/components/theme-toggle';
import { AuthArt } from './auth-art';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, TuiButton, Icon, FieldError, ThemeToggle, GoogleButton, AuthArt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <div class="auth">
      <section class="hero" aria-label="Presentación">
        <span class="mark">
          @if (brand().logoDataUrl) { <img class="logo" [src]="brand().logoDataUrl" alt="" /> } @else { <img class="logo" src="icons/icon-96x96.png" alt="" width="40" height="40" /> }
          {{ brand().businessName }}
        </span>
        <div class="lead">
          <h1>Tu plan, claro y a tu ritmo.</h1>
          <p class="sub">{{ brand().tagline }}</p>
        </div>
        <app-auth-art />
        <p class="foot">Plataforma de gestión nutricional</p>
      </section>

      <main class="panel-wrap" id="contenido">
        <div class="u-corner-tr"><app-theme-toggle /></div>
        <div class="form-box">
          @if (signup()?.enabled) {
            <nav class="switch" aria-label="Ingresar o crear cuenta">
              <a routerLink="/ingresar" aria-current="page">Ingresar</a>
              <a routerLink="/registro">Crear cuenta</a>
            </nav>
          }
          <h2>Ingresar</h2>

          @if (error()) {
            <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body">{{ error() }}</div></div>
          }

          @if (signup()?.googleClientId; as gid) {
            <app-google-button [clientId]="gid" text="signin_with" (credential)="google($event)" />
            <p class="or"><span>o con tu correo</span></p>
          }

          <form [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
            <div class="field">
              <label for="email">Correo electrónico</label>
              <input id="email" class="input" type="email" formControlName="email" autocomplete="username" inputmode="email" aria-describedby="email-err" />
              <app-field-error id="email-err" [control]="form.controls.email" />
            </div>
            <div class="field">
              <label for="password">Contraseña</label>
              <div class="pw">
                <input id="password" class="input" [type]="show() ? 'text' : 'password'" formControlName="password" autocomplete="current-password" aria-describedby="pw-err" />
                <button type="button" class="icon-btn" [attr.aria-label]="show() ? 'Ocultar contraseña' : 'Mostrar contraseña'" [attr.aria-pressed]="show()" (click)="show.set(!show())">
                  <app-icon [name]="show() ? 'eye-off' : 'eye'" />
                </button>
              </div>
              <app-field-error id="pw-err" [control]="form.controls.password" />
            </div>
            <button tuiButton type="submit" size="l" [disabled]="loading()">{{ loading() ? 'Ingresando…' : 'Ingresar' }}</button>
            <a routerLink="/recuperar" class="small">¿Olvidaste tu contraseña?</a>
          </form>

          @if (demo) {
          <div class="demo" role="group" aria-label="Cuentas de demostración">
            <p class="small"><strong>Modo demostración</strong> · contraseña <code>demo1234</code>. Los datos son de ejemplo.</p>
            <div class="row">
              <button tuiButton type="button" size="s" appearance="secondary" (click)="fill('nutri@demo.mx')">Nutrióloga</button>
              <button tuiButton type="button" size="s" appearance="secondary" (click)="fill('ana@demo.mx')">Paciente Ana</button>
              <button tuiButton type="button" size="s" appearance="secondary" (click)="fill('daniela@demo.mx')">Daniela (consentimiento pendiente)</button>
            </div>
          </div>
          }
          <p class="fine"><a routerLink="/privacidad">Aviso de privacidad</a> · <a routerLink="/terminos">Términos de uso</a></p>
        </div>
      </main>
    </div>
  `,
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(DbService);
  protected readonly brand = computed(() => this.data.db().settings.brand);
  // Modo API: nombre y colores públicos de la consulta para la pantalla de ingreso.
  private readonly publicBrand = inject(SettingsService).loadPublicBrand().subscribe({ error: () => undefined });
  protected readonly demo = showDemoAccounts();
  protected readonly signup = toSignal(this.auth.signupOptions());
  protected readonly show = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  protected fill(email: string): void {
    this.form.setValue({ email, password: 'demo1234' });
    this.error.set('');
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set('');
    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: (user) => this.enter(user.role),
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(e instanceof Error ? e.message : 'No se pudo iniciar sesión.');
        this.form.controls.password.reset('');
      },
    });
  }

  private enter(role: string): void {
    const back = this.route.snapshot.queryParamMap.get('volver');
    const safe = back && back.startsWith('/') && !back.startsWith('//') ? back : null;
    void this.router.navigateByUrl(safe && (role === 'patient') === safe.startsWith('/paciente') ? safe : role === 'patient' ? '/paciente' : '/');
  }

  protected google(credential: string): void {
    this.loading.set(true);
    this.error.set('');
    // Sin aceptar términos aquí: si la cuenta no existe, se pasa a Registro, donde se acepta de forma explícita.
    this.auth.googleLogin(credential, false).subscribe({
      next: (user) => this.enter(user.role),
      error: (e: unknown) => {
        this.loading.set(false);
        if (e instanceof AuthError && e.code === 'terms_required') {
          void this.router.navigate(['/registro'], { queryParams: { google: '1' } });
          return;
        }
        this.error.set(e instanceof Error ? e.message : 'No se pudo ingresar con Google.');
      },
    });
  }
}
