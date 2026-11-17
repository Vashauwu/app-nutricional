import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../../../shared/components/icon';
import { PrinciplesSection } from '../landing.content';

@Component({
  selector: 'app-lp-principles',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    h2 { margin-block-end: clamp(2rem, 5vw, 3.5rem); max-inline-size: 28ch; }
    ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-6) var(--space-7); grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 48rem) { ul { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-4); align-items: start; }
    .ic { color: var(--brand-ink); margin-block-start: .125rem; }
    h3 { font-family: var(--nutri-font-ui); font-size: 1.1875rem; font-weight: 600; color: var(--nutri-texto-fuerte); margin-block-end: .25rem; }
    p { margin: 0; line-height: 1.6; }
  `,
  template: `
    <section [id]="s().id" class="lp-sec lp-wrap" [attr.aria-labelledby]="s().id + '-h'">
      <h2 [id]="s().id + '-h'" class="lp-h2">{{ s().title }}</h2>
      <ul>@for (i of s().items; track i.title) { <li><span class="ic"><app-icon [name]="i.icon" [size]="26" /></span><div><h3>{{ i.title }}</h3><p>{{ i.text }}</p></div></li> }</ul>
    </section>
  `,
})
export class LpPrinciples {
  readonly s = input.required<PrinciplesSection>();
}
