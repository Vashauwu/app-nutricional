import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CtaSection } from '../landing.content';
import { LpAction } from './action-link';

@Component({
  selector: 'app-lp-cta',
  imports: [LpAction],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .box { display: grid; gap: var(--space-5); justify-items: start; padding: clamp(2rem, 6vw, 4rem); border-radius: var(--radius-l, 1.25rem); background: var(--brand-secondary, var(--nutri-lavanda)); }
    h2 { max-inline-size: 20ch; }
    .note { margin: 0; font-size: .9375rem; color: var(--nutri-texto-fuerte); }
  `,
  template: `
    <section [id]="s().id" class="lp-sec lp-wrap" [attr.aria-labelledby]="s().id + '-h'">
      <div class="box">
        <h2 [id]="s().id + '-h'" class="lp-h2">{{ s().title }}</h2>
        <p class="lp-lead">{{ s().text }}</p>
        <app-lp-action [action]="s().action" />
        <p class="note">{{ s().note }}</p>
      </div>
    </section>
  `,
})
export class LpCta {
  readonly s = input.required<CtaSection>();
}
