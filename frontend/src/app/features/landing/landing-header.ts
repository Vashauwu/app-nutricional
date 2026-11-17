import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/components/icon';
import { ThemeToggle } from '../../shared/components/theme-toggle';
import { scrollToAnchor } from './scroll';

export interface NavLink { id: string; label: string }

/** Menú superior: única parte de la landing que no sale del archivo de contenido (se arma con las secciones que tienen `nav`). */
@Component({
  selector: 'app-lp-header',
  imports: [RouterLink, Icon, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'open.set(false)' },
  styles: `
    :host { display: block; position: sticky; inset-block-start: 0; z-index: 20; background: var(--nutri-marfil); border-block-end: 1px solid var(--line); }
    .bar { display: flex; align-items: center; gap: var(--space-4); min-block-size: 4rem; }
    .brand { display: inline-flex; align-items: center; gap: .625rem; font-weight: 700; color: var(--brand-ink); text-decoration: none; margin-inline-end: auto; }
    nav.main { display: none; }
    nav ul { display: flex; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
    nav a.l { display: inline-flex; align-items: center; min-block-size: var(--tap, 2.75rem); padding-inline: var(--space-3); border-radius: 999px; color: var(--nutri-texto-fuerte); text-decoration: none; font-weight: 500; }
    nav a.l:hover { background: color-mix(in srgb, var(--brand-secondary, var(--nutri-lavanda)) 55%, transparent); }
    .cta { display: none; }
    .burger { display: inline-grid; place-items: center; inline-size: var(--tap, 2.75rem); block-size: var(--tap, 2.75rem); border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); color: var(--nutri-texto-fuerte); cursor: pointer; }
    .drawer { border-block-start: 1px solid var(--line); padding-block: var(--space-3) var(--space-4); }
    .drawer ul { flex-direction: column; }
    .drawer a.l { inline-size: 100%; border-radius: var(--radius-m); }
    .drawer .lp-btn { inline-size: 100%; margin-block-start: var(--space-3); }
    @media (min-width: 56rem) {
      nav.main { display: block; margin-inline-end: var(--space-4); }
      .cta { display: inline-flex; }
      .burger, .drawer { display: none; }
    }
  `,
  template: `
    <div class="lp-wrap bar">
      <a class="brand" routerLink="/inicio" aria-label="Nutrición Integral, ir al inicio" (click)="top($event)"><img src="icons/icon-96x96.png" alt="" width="36" height="36" />Nutrición Integral</a>
      <nav class="main" aria-label="Secciones de la página"><ul>@for (l of links(); track l.id) { <li><a class="l" [href]="'#' + l.id" (click)="go($event, l.id)">{{ l.label }}</a></li> }</ul></nav>
      <app-theme-toggle />
      <a class="lp-btn cta" routerLink="/ingresar">Ingresar</a>
      <button type="button" class="burger" aria-controls="lp-drawer" [attr.aria-expanded]="open()" [attr.aria-label]="open() ? 'Cerrar el menú' : 'Abrir el menú'" (click)="open.set(!open())"><app-icon [name]="open() ? 'x' : 'menu'" /></button>
    </div>
    @if (open()) {
      <div id="lp-drawer" class="drawer lp-wrap">
        <nav aria-label="Secciones de la página"><ul>@for (l of links(); track l.id) { <li><a class="l" [href]="'#' + l.id" (click)="go($event, l.id)">{{ l.label }}</a></li> }</ul></nav>
        <a class="lp-btn" routerLink="/ingresar">Ingresar</a>
      </div>
    }
  `,
})
export class LandingHeader {
  readonly links = input.required<NavLink[]>();
  protected readonly open = signal(false);

  protected go(e: Event, id: string): void {
    e.preventDefault();
    this.open.set(false);
    scrollToAnchor(id);
  }
  protected top(e: Event): void {
    e.preventDefault();
    this.open.set(false);
    window.scrollTo({ top: 0 });
  }
}
