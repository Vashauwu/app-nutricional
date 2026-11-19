import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlatformApi } from '../../core/api/platform-api';
import { LandingContent } from '../landing/landing.content';
import { normalizeLanding } from '../landing/landing-content.service';
import { Landing } from '../landing/landing';

/**
 * Vista previa del borrador: la landing real dibujada con el contenido del borrador (no con lo publicado). Solo la ve quien tiene
 * permiso sobre la landing y siempre lleva una franja que lo dice, para no confundirla con la página pública.
 */
@Component({
  selector: 'app-platform-landing-preview',
  imports: [Landing, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar { position: sticky; inset-block-start: 0; z-index: 40; display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; justify-content: center; padding: .5rem 1rem; background: var(--brand-ink); color: var(--surface, #fff); font-size: .875rem; }
    .bar a { color: inherit; font-weight: 600; text-underline-offset: 3px; }
    .msg { padding: 3rem 1rem; text-align: center; color: var(--nutri-texto-suave); }
  `,
  template: `
    <div class="bar" role="status">
      <strong>Vista previa del borrador</strong><span>No es la página pública: así se verá si se publica.</span>
      <a routerLink="/plataforma/landing">Volver al editor</a>
    </div>
    @if (content(); as c) { <app-landing [preview]="c" /> }
    @else if (error()) { <p class="msg" role="alert">{{ error() }}</p> }
    @else { <p class="msg">Cargando el borrador…</p> }
  `,
})
export class PlatformLandingPreview {
  protected readonly content = signal<LandingContent | null>(null);
  protected readonly error = signal('');

  constructor() {
    inject(PlatformApi).landing().subscribe({
      next: (s) => (s.draft ? this.content.set(normalizeLanding(s.draft.content)) : this.error.set('Todavía no hay un borrador. Crea uno en el editor para verlo aquí.')),
      error: (e: Error) => this.error.set(e.message),
    });
  }
}
