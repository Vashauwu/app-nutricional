import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';

interface TurnstileApi {
  render(host: HTMLElement, o: { sitekey: string; theme: string; language: string; callback: (t: string) => void; 'expired-callback': () => void; 'error-callback': () => void }): string;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let api: Promise<TurnstileApi> | null = null;
/** Carga una sola vez la biblioteca de Cloudflare Turnstile. */
function load(): Promise<TurnstileApi> {
  api ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => { api = null; reject(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return api;
}

/**
 * Verificación anti robots (Cloudflare Turnstile). Entrega un token que el servidor valida; sin él no se abre la cuenta.
 * Si la biblioteca no carga (red, bloqueador) se avisa en lugar de dejar el formulario sin respuesta.
 */
@Component({
  selector: 'app-captcha',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .host { min-block-size: 4rem; display: grid; justify-items: start; }
    .fail { margin: 0; font-size: 0.8125rem; color: var(--danger); }
  `,
  template: `
    <div #host class="host" aria-label="Verificación anti robots"></div>
    @if (failed()) { <p class="fail" role="alert">No se pudo cargar la verificación anti robots. Revisa tu conexión o desactiva el bloqueador de contenido para esta página.</p> }
  `,
})
export class Captcha {
  readonly siteKey = input.required<string>();
  /** Token válido, o cadena vacía cuando expira o falla. */
  readonly token = output<string>();
  /** Pide un desafío nuevo (p. ej. tras un intento fallido: el token es de un solo uso). */
  readonly reset = input(0);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly theme = inject(ThemeService);
  protected readonly failed = signal(false);

  constructor() {
    effect((onCleanup) => {
      const key = this.siteKey();
      const dark = this.theme.dark();
      this.reset(); // dependencia: cambiarlo vuelve a dibujar el desafío
      const el = this.host().nativeElement;
      let live = true;
      let id: string | null = null;
      let t: TurnstileApi | null = null;
      onCleanup(() => { live = false; if (id && t) { try { t.remove(id); } catch { /* ya no existe */ } } });
      load().then(
        (ts) => {
          if (!live) return;
          t = ts;
          this.failed.set(false);
          this.token.emit('');
          el.replaceChildren();
          id = ts.render(el, { sitekey: key, theme: dark ? 'dark' : 'light', language: 'es', callback: (v) => this.token.emit(v), 'expired-callback': () => this.token.emit(''), 'error-callback': () => this.token.emit('') });
        },
        () => { if (live) this.failed.set(true); },
      );
    });
  }
}
