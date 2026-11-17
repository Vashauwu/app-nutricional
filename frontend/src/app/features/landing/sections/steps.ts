import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { StepsSection } from '../landing.content';

@Component({
  selector: 'app-lp-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    h2 { margin-block-end: clamp(2rem, 5vw, 3.5rem); }
    ol { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-6); grid-template-columns: minmax(0, 1fr); counter-reset: paso; }
    @media (min-width: 48rem) { ol { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (min-width: 75rem) { ol { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    li { counter-increment: paso; display: grid; gap: var(--space-2); align-content: start; }
    li::before { content: counter(paso); display: grid; place-items: center; inline-size: 2.5rem; block-size: 2.5rem; border-radius: 50%; background: var(--brand-ink); color: var(--surface, #fff); font-weight: 700; font-variant-numeric: tabular-nums; margin-block-end: var(--space-2); }
    h3 { font-family: var(--nutri-font-ui); font-size: 1.1875rem; font-weight: 600; color: var(--nutri-texto-fuerte); }
    p { margin: 0; line-height: 1.6; }
  `,
  template: `
    <section [id]="s().id" class="lp-sec lp-wrap" [attr.aria-labelledby]="s().id + '-h'">
      <h2 [id]="s().id + '-h'" class="lp-h2">{{ s().title }}</h2>
      <ol>@for (i of s().items; track i.title) { <li><h3>{{ i.title }}</h3><p>{{ i.text }}</p></li> }</ol>
    </section>
  `,
})
export class LpSteps {
  readonly s = input.required<StepsSection>();
}
