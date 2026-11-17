import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../../../shared/components/icon';
import { FeaturesSection } from '../landing.content';

@Component({
  selector: 'app-lp-features',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .in { display: grid; gap: clamp(2rem, 5vw, 4rem); grid-template-columns: minmax(0, 1fr); align-items: start; }
    @media (min-width: 62rem) { .in { grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); } .head { position: sticky; inset-block-start: 6rem; } }
    .head { display: grid; gap: var(--space-4); }
    ul { margin: 0; padding: 0; list-style: none; display: grid; }
    li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-4); padding-block: var(--space-5); border-block-end: 1px solid var(--line); }
    li:first-child { padding-block-start: 0; }
    .ic { display: grid; place-items: center; inline-size: 2.75rem; block-size: 2.75rem; border-radius: var(--radius-m); background: var(--brand-secondary, var(--nutri-lavanda)); color: var(--nutri-texto-fuerte); }
    h3 { font-family: var(--nutri-font-ui); font-size: 1.1875rem; font-weight: 600; color: var(--nutri-texto-fuerte); margin-block-end: .25rem; }
    p { margin: 0; line-height: 1.6; max-inline-size: 58ch; }
  `,
  template: `
    <section [id]="s().id" class="lp-sec lp-sec--soft" [attr.aria-labelledby]="s().id + '-h'">
      <div class="lp-wrap in">
        <div class="head"><h2 [id]="s().id + '-h'" class="lp-h2">{{ s().title }}</h2><p class="lp-lead">{{ s().text }}</p></div>
        <ul>@for (i of s().items; track i.title) { <li><span class="ic"><app-icon [name]="i.icon" [size]="22" /></span><div><h3>{{ i.title }}</h3><p>{{ i.text }}</p></div></li> }</ul>
      </div>
    </section>
  `,
})
export class LpFeatures {
  readonly s = input.required<FeaturesSection>();
}
