import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HeroSection } from '../landing.content';
import { LpAction } from './action-link';
import { LpMockWeek } from './mock-week';

@Component({
  selector: 'app-lp-hero',
  imports: [LpAction, LpMockWeek],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    section { padding-block: clamp(2.5rem, 7vw, 5.5rem) clamp(3rem, 7vw, 5rem); }
    .in { display: grid; gap: clamp(2rem, 5vw, 4rem); align-items: center; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 62rem) { .in { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); } }
    h1 { font-family: var(--nutri-font-display); font-weight: 600; font-size: clamp(2.125rem, 1.4rem + 3.2vw, 3.75rem); line-height: 1.08; letter-spacing: -0.02em; color: var(--brand-ink); text-wrap: balance; margin-block-end: var(--space-4); }
    .copy { display: grid; gap: var(--space-5); justify-items: start; }
    .note { font-size: .875rem; color: var(--muted); margin: 0; }
    .vis { min-inline-size: 0; }
  `,
  template: `
    <section [id]="s().id" class="lp-wrap" [attr.aria-labelledby]="s().id + '-h'">
      <div class="in">
        <div class="copy lp-rise">
          <h1 [id]="s().id + '-h'">{{ s().title }}</h1>
          <p class="lp-lead">{{ s().text }}</p>
          <div class="lp-actions">@for (a of s().actions; track a.label) { <app-lp-action [action]="a" /> }</div>
          <p class="note">{{ s().note }}</p>
        </div>
        <figure class="vis lp-rise m-0">
          <app-lp-mock-week />
          <figcaption class="lp-sr">Ilustración de un plan semanal con datos ficticios.</figcaption>
        </figure>
      </div>
    </section>
  `,
})
export class LpHero {
  readonly s = input.required<HeroSection>();
}
