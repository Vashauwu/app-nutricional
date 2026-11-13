import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { Icon } from '../../shared/components/icon';

/** Página 404: cualquier ruta que no existe. Los guards llevan a «Inicio» según el rol de la persona. */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TuiButton, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; place-items: center; min-block-size: 100dvh; padding: var(--space-5); background: var(--nutri-marfil); }
    .box { display: grid; gap: var(--space-3); justify-items: center; text-align: center; max-inline-size: 28rem; }
    .code { display: grid; place-items: center; inline-size: 5rem; block-size: 5rem; border-radius: 50%; background: var(--nutri-lavanda); color: var(--nutri-texto-fuerte); }
    h1 { font-size: 1.75rem; } p { margin: 0; }
  `,
  template: `
    <main class="box" id="contenido">
      <span class="code" aria-hidden="true"><app-icon name="search" [size]="36" /></span>
      <p class="eyebrow">Error 404</p>
      <h1>No encontramos esta página</h1>
      <p class="muted">Puede que el enlace esté incompleto o que la página ya no exista.</p>
      <div class="row" style="justify-content: center">
        <a tuiButton routerLink="/" size="m">Ir al inicio</a>
        <button tuiButton type="button" size="m" appearance="secondary" (click)="back()">Volver</button>
      </div>
    </main>
  `,
})
export class NotFound {
  private readonly location = inject(Location);
  protected back(): void { this.location.back(); }
}
