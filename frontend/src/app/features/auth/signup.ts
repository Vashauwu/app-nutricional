import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { ApiError } from '../../core/api/api-client';
import { AuthService } from '../../core/auth/auth.service';
import { FieldError, strongPassword } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { GoogleButton } from '../../shared/components/google-button';
import { Captcha } from '../../shared/components/captcha';
import { ThemeToggle } from '../../shared/components/theme-toggle';
import { AuthArt } from './auth-art';

/** Registro de una nutrióloga: abre su propia consulta con el plan gratuito. */
@Component({
  selector: 'app-signup',
  imports: [ReactiveFormsModule, RouterLink, TuiButton, Icon, FieldError, ThemeToggle, GoogleButton, Captcha, AuthArt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <div class="auth">
      <section class="hero" aria-label="Presentación">
        <span class="mark"><img class="logo" src="icons/icon-96x96.png" alt="" width="40" height="40" /> Nutrición Integral</span>
        <div class="lead">
          <h1>Empieza gratis, a tu ritmo.</h1>
          <p class="sub">Expediente, Dietocálculo, planes semanales y agenda en un solo lugar. Sin tarjeta para empezar.</p>
        </div>
        <app-auth-art />
        <p class="foot">Plan gratuito: hasta 15 pacientes activos.</p>
      </section>

      <main class="panel-wrap" id="contenido">
        <div class="u-corner-tr"><app-theme-toggle /></div>
        <div class="form-box">
          @if (options() === undefined) {
            <p class="muted" role="status">Cargando…</p>
          } @else if (!options()!.enabled) {
            <div>
              <h2>Registro no disponible</h2>
              <p class="muted">Por ahora no estamos abriendo cuentas nuevas desde aquí. Si ya tienes una, ingresa.</p>
            </div>
            <a tuiButton size="l" routerLink="/ingresar">Ingresar</a>
          } @else if (done()) {
            <div class="callout callout--ok" role="status">
              <app-icon name="check-circle" />
              <div class="callout-body">
                <p><strong>Revisa tu correo</strong></p>
                <p>Si <strong>{{ form.controls.email.value }}</strong> puede abrir una cuenta, te enviamos un enlace para confirmarla. Vence en 24 horas.</p>
                <p class="small muted">¿No llega? Revisa spam o vuelve a registrarte con el mismo correo para recibir otro enlace.</p>
              </div>
            </div>
            <a tuiButton appearance="secondary" size="m" routerLink="/ingresar">Ya confirmé: ingresar</a>
          } @else {
            <nav class="switch" aria-label="Ingresar o crear cuenta">
              <a routerLink="/ingresar">Ingresar</a>
              <a routerLink="/registro" aria-current="page">Crear cuenta</a>
            </nav>
            <h2>Crear cuenta gratuita</h2>
            @if (error()) {
              <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body">{{ error() }}</div></div>
            } @else if (fromGoogle) {
              <div class="callout callout--info" role="status"><app-icon name="info" /><div class="callout-body">Aún no tienes cuenta con ese correo de Google. Continúa con Google para crearla gratis.</div></div>
            }
            @if (options()!.googleClientId; as gid) {
              <app-google-button [clientId]="gid" text="signup_with" (credential)="google($event)" />
              <p class="fine">Al continuar con Google aceptas los <a routerLink="/terminos" target="_blank">términos de uso</a> y el <a routerLink="/privacidad" target="_blank">aviso de privacidad</a>.</p>
              <p class="or"><span>o con tu correo</span></p>
            }
            <form [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
              <div class="field">
                <label for="su-name">Tu nombre</label>
                <input id="su-name" class="input" type="text" formControlName="name" autocomplete="name" aria-describedby="su-name-err" />
                <app-field-error id="su-name-err" [control]="form.controls.name" />
                @if (fields()['name']) { <p class="error" role="alert">{{ fields()['name'] }}</p> }
              </div>
              <div class="field">
                <label for="su-email">Correo electrónico</label>
                <input id="su-email" class="input" type="email" formControlName="email" autocomplete="email" inputmode="email" aria-describedby="su-email-err" />
                <app-field-error id="su-email-err" [control]="form.controls.email" />
                @if (fields()['email']) { <p class="error" role="alert">{{ fields()['email'] }}</p> }
              </div>
              <div class="field">
                <label for="su-pw">Contraseña</label>
                <div class="pw">
                  <input id="su-pw" class="input" [type]="show() ? 'text' : 'password'" formControlName="password" autocomplete="new-password" aria-describedby="su-pw-hint su-pw-err" />
                  <button type="button" class="icon-btn" [attr.aria-label]="show() ? 'Ocultar contraseña' : 'Mostrar contraseña'" [attr.aria-pressed]="show()" (click)="show.set(!show())">
                    <app-icon [name]="show() ? 'eye-off' : 'eye'" />
                  </button>
                </div>
                <span class="hint" id="su-pw-hint">Mínimo 8 caracteres, con una letra y un número.</span>
                <app-field-error id="su-pw-err" [control]="form.controls.password" />
                @if (fields()['password']) { <p class="error" role="alert">{{ fields()['password'] }}</p> }
              </div>
              <div class="field">
                <label class="check" for="su-terms">
                  <input id="su-terms" type="checkbox" formControlName="terms" aria-describedby="su-terms-err" />
                  <span>Acepto los <a routerLink="/terminos" target="_blank">términos de uso</a> y el <a routerLink="/privacidad" target="_blank">aviso de privacidad</a>.</span>
                </label>
                @if ((form.controls.terms.touched && form.controls.terms.invalid) || fields()['accept_terms']) {
                  <p class="error" id="su-terms-err" role="alert">Debes aceptar los términos y el aviso de privacidad.</p>
                }
              </div>
              @if (options()!.captchaSiteKey; as ck) {
                <app-captcha [siteKey]="ck" [reset]="captchaReset()" (token)="captcha.set($event)" />
                @if (fields()['captcha']) { <p class="error" role="alert">{{ fields()['captcha'] }}</p> }
              }
              <button tuiButton type="submit" size="l" [disabled]="loading() || (!!options()!.captchaSiteKey && !captcha())">{{ loading() ? 'Creando cuenta…' : 'Crear cuenta gratis' }}</button>
            </form>
          }
        </div>
      </main>
    </div>
  `,
})
export class Signup {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Llegó desde «Continuar con Google» en el ingreso sin tener cuenta. */
  protected readonly fromGoogle = inject(ActivatedRoute).snapshot.queryParamMap.get('google') === '1';
  protected readonly options = toSignal(this.auth.signupOptions());
  protected readonly show = signal(false);
  protected readonly loading = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal('');
  protected readonly fields = signal<Record<string, string>>({});
  /** Token anti robots vigente (vacío = aún sin resolver) y contador para pedir un desafío nuevo tras un intento fallido. */
  protected readonly captcha = signal('');
  protected readonly captchaReset = signal(0);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, strongPassword]],
    terms: [false, [Validators.requiredTrue]],
  });

  /** Crea la cuenta con Google: pulsar el botón junto al aviso de términos es la aceptación. */
  protected google(credential: string): void {
    this.error.set('');
    this.auth.googleLogin(credential, true).subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (e: unknown) => this.error.set(e instanceof Error ? e.message : 'No se pudo continuar con Google.'),
    });
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set('');
    this.fields.set({});
    const v = this.form.getRawValue();
    this.auth.signup({ name: v.name.trim(), email: v.email, password: v.password, acceptTerms: v.terms, captcha: this.captcha() }).subscribe({
      next: (r) => {
        if (!r.verified) {
          this.loading.set(false);
          this.done.set(true);
          return;
        }
        // Sin confirmación de correo (ambientes de prueba): entra directo.
        this.auth.login(v.email, v.password).subscribe({
          next: () => void this.router.navigateByUrl('/'),
          error: () => void this.router.navigateByUrl('/ingresar'),
        });
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.captchaReset.update((n) => n + 1); // el token es de un solo uso
        if (e instanceof ApiError) {
          this.fields.set(e.fields);
          this.error.set(e.code === 'validation_failed' ? 'Revisa los datos marcados.' : e.message);
        } else this.error.set('No se pudo crear la cuenta.');
      },
    });
  }
}

/** Destino del enlace del correo: confirma la cuenta. */
@Component({
  selector: 'app-verify-email',
  imports: [RouterLink, TuiButton, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <main class="panel-wrap min-h-page" id="contenido">
      <div class="card">
        @switch (state()) {
          @case ('working') { <p class="muted" role="status">Confirmando tu correo…</p> }
          @case ('ok') {
            <div class="callout callout--ok" role="status"><app-icon name="check-circle" /><div class="callout-body"><p><strong>Correo confirmado</strong></p><p>Tu cuenta gratuita está lista. Ingresa para configurar tu consulta.</p></div></div>
            <a tuiButton size="l" routerLink="/ingresar">Ingresar</a>
          }
          @default {
            <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><p><strong>Enlace no válido o vencido.</strong></p><p class="small">Los enlaces duran 24 horas y solo funcionan una vez. Si ya confirmaste tu correo, ingresa.</p></div></div>
            <div class="row"><a tuiButton size="m" routerLink="/ingresar">Ingresar</a><a tuiButton appearance="secondary" size="m" routerLink="/registro">Registrarme de nuevo</a></div>
          }
        }
      </div>
    </main>
  `,
})
export class VerifyEmail {
  private readonly auth = inject(AuthService);
  protected readonly state = signal<'working' | 'ok' | 'bad'>('working');

  constructor() {
    const token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';
    this.auth.verifyEmail(token).subscribe({ next: () => this.state.set('ok'), error: () => this.state.set('bad') });
  }
}
