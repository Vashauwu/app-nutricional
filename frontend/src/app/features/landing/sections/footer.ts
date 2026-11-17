import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LandingFooter } from '../landing.content';

@Component({
  selector: 'app-lp-footer',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; border-block-start: 1px solid var(--line); }
    .in { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-4) var(--space-6); padding-block: var(--space-6); }
    .brand { display: inline-flex; align-items: center; gap: .625rem; font-weight: 600; color: var(--nutri-texto-fuerte); }
    nav ul { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); margin: 0; padding: 0; list-style: none; }
    nav a { display: inline-flex; align-items: center; min-block-size: var(--tap, 2.75rem); }
    .legal { flex-basis: 100%; margin: 0; font-size: .875rem; color: var(--muted); }
  `,
  template: `
    <footer class="lp-wrap in">
      <span class="brand"><img src="icons/icon-96x96.png" alt="" width="32" height="32" />Nutrición Integral</span>
      <nav aria-label="Enlaces del pie de página"><ul>@for (l of f().links; track l.to) { <li><a [routerLink]="l.to">{{ l.label }}</a></li> }</ul></nav>
      <p class="legal">{{ f().legal }} © {{ year }} Nutrición Integral.</p>
    </footer>
  `,
})
export class LpFooter {
  readonly f = input.required<LandingFooter>();
  protected readonly year = new Date().getFullYear();
}
