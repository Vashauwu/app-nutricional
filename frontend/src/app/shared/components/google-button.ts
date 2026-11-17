import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';

interface GsiApi {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: string; auto_select?: boolean; cancel_on_tap_outside?: boolean }): void;
      renderButton(host: HTMLElement, o: Record<string, unknown>): void;
    };
  };
}
declare global { interface Window { google?: GsiApi } }

let gsi: Promise<GsiApi> | null = null;
/** Carga una sola vez la biblioteca oficial de Google Identity Services. */
function loadGsi(): Promise<GsiApi> {
  gsi ??= new Promise<GsiApi>((resolve, reject) => {
    if (window.google?.accounts) return resolve(window.google);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => (window.google?.accounts ? resolve(window.google) : reject(new Error('gsi')));
    s.onerror = () => { gsi = null; reject(new Error('gsi')); };
    document.head.appendChild(s);
  });
  return gsi;
}

/**
 * Botón oficial «Continuar con Google» (Google Identity Services). Devuelve el ID token (`credential`), que el servidor
 * valida: nunca se confía en nada que venga del navegador. Si Google no carga (red, bloqueador), se avisa y el resto de la
 * pantalla sigue funcionando.
 */
@Component({
  selector: 'app-google-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .wrap { position: relative; min-block-size: 2.75rem; display: grid; justify-items: center; }
    .host { inline-size: 100%; display: grid; justify-items: center; color-scheme: light; }
    .wrap.off .host { opacity: 0.55; pointer-events: none; }
    .block { position: absolute; inset: 0; border: 0; background: transparent; cursor: not-allowed; }
    .fail { margin: 0; font-size: 0.8125rem; color: var(--muted); text-align: center; }
  `,
  template: `
    <div class="wrap" [class.off]="disabled()">
      <div #host class="host"></div>
      @if (disabled()) { <button type="button" class="block" aria-label="Acepta primero los términos para continuar con Google" (click)="blocked.emit()"></button> }
      @if (failed()) { <p class="fail" role="status">No se pudo cargar el acceso con Google. Usa tu correo y contraseña.</p> }
    </div>
  `,
})
export class GoogleButton {
  readonly clientId = input.required<string>();
  readonly text = input<'continue_with' | 'signup_with' | 'signin_with'>('continue_with');
  readonly disabled = input(false);
  readonly credential = output<string>();
  /** Se intentó usar el botón mientras estaba deshabilitado. */
  readonly blocked = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly theme = inject(ThemeService);
  protected readonly failed = signal(false);

  constructor() {
    effect((onCleanup) => {
      const id = this.clientId();
      const dark = this.theme.dark();
      const text = this.text();
      const el = this.host().nativeElement;
      let live = true;
      onCleanup(() => { live = false; });
      loadGsi().then(
        (g) => {
          if (!live) return;
          g.accounts.id.initialize({ client_id: id, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true, callback: (r) => { if (r.credential) this.credential.emit(r.credential); } });
          el.replaceChildren();
          const width = Math.max(240, Math.min(400, Math.round(el.getBoundingClientRect().width || 360)));
          g.accounts.id.renderButton(el, { type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', text, shape: 'pill', logo_alignment: 'left', width, locale: 'es-419' });
          this.failed.set(false);
        },
        () => { if (live) this.failed.set(true); },
      );
    });
  }
}
