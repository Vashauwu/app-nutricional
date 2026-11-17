import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../../../shared/components/icon';
import { PreviewSection } from '../landing.content';
import { LpMockDay } from './mock-day';

@Component({
  selector: 'app-lp-preview',
  imports: [Icon, LpMockDay],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .in { display: grid; gap: clamp(2rem, 5vw, 4rem); grid-template-columns: minmax(0, 1fr); align-items: center; }
    @media (min-width: 62rem) { .in { grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); } }
    .copy { display: grid; gap: var(--space-4); }
    ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-3); }
    li { display: flex; gap: var(--space-3); align-items: flex-start; }
    li app-icon { color: var(--brand-ink); margin-block-start: .125rem; }
    figure { margin: 0; min-inline-size: 0; display: grid; gap: var(--space-2); }
    figcaption { font-size: .8125rem; color: var(--muted); }
  `,
  template: `
    <section [id]="s().id" class="lp-sec lp-wrap" [attr.aria-labelledby]="s().id + '-h'">
      <div class="in">
        <figure><app-lp-mock-day /><figcaption>{{ s().caption }}</figcaption></figure>
        <div class="copy">
          <h2 [id]="s().id + '-h'" class="lp-h2">{{ s().title }}</h2>
          <p class="lp-lead">{{ s().text }}</p>
          <ul>@for (b of s().bullets; track b) { <li><app-icon name="check-circle" [size]="20" /><span>{{ b }}</span></li> }</ul>
        </div>
      </div>
    </section>
  `,
})
export class LpPreview {
  readonly s = input.required<PreviewSection>();
}
