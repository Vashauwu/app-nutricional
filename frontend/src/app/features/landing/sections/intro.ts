import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IntroSection } from '../landing.content';

@Component({
  selector: 'app-lp-intro',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .head { display: grid; gap: var(--space-4); margin-block-end: clamp(2rem, 5vw, 3.5rem); }
    .pts { display: grid; gap: var(--space-6); grid-template-columns: minmax(0, 1fr); margin: 0; padding: 0; list-style: none; }
    @media (min-width: 48rem) { .pts { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-7); } }
    li { padding-block-start: var(--space-4); border-block-start: 2px solid var(--brand-ink); }
    h3 { font-family: var(--nutri-font-ui); font-size: 1.1875rem; font-weight: 600; color: var(--nutri-texto-fuerte); margin-block-end: var(--space-2); }
    p { margin: 0; line-height: 1.6; }
  `,
  template: `
    <section [id]="s().id" class="lp-sec lp-wrap" [attr.aria-labelledby]="s().id + '-h'">
      <div class="head"><h2 [id]="s().id + '-h'" class="lp-h2">{{ s().title }}</h2><p class="lp-lead">{{ s().text }}</p></div>
      <ul class="pts">@for (p of s().points; track p.title) { <li><h3>{{ p.title }}</h3><p>{{ p.text }}</p></li> }</ul>
    </section>
  `,
})
export class LpIntro {
  readonly s = input.required<IntroSection>();
}
