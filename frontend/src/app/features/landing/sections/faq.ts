import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../../../shared/components/icon';
import { FaqSection } from '../landing.content';

/** Preguntas con `<details>` nativo: se abren y cierran con teclado y lector de pantalla sin código adicional. */
@Component({
  selector: 'app-lp-faq',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .in { display: grid; gap: clamp(1.5rem, 4vw, 3rem); grid-template-columns: minmax(0, 1fr); align-items: start; }
    @media (min-width: 62rem) { .in { grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.3fr); } }
    details { border-block-end: 1px solid var(--line); }
    details:first-child { border-block-start: 1px solid var(--line); }
    summary { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); min-block-size: 3.5rem; padding-block: var(--space-3); cursor: pointer; font-weight: 600; color: var(--nutri-texto-fuerte); list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary app-icon { flex: none; transition: transform .2s ease; }
    details[open] summary app-icon { transform: rotate(180deg); }
    details p { margin: 0 0 var(--space-4); line-height: 1.65; max-inline-size: 62ch; }
    @media (prefers-reduced-motion: reduce) { summary app-icon { transition: none; } }
  `,
  template: `
    <section [id]="s().id" class="lp-sec lp-wrap" [attr.aria-labelledby]="s().id + '-h'">
      <div class="in">
        <h2 [id]="s().id + '-h'" class="lp-h2">{{ s().title }}</h2>
        <div>@for (i of s().items; track i.q) { <details><summary>{{ i.q }}<app-icon name="chevron-down" [size]="20" /></summary><p>{{ i.a }}</p></details> }</div>
      </div>
    </section>
  `,
})
export class LpFaq {
  readonly s = input.required<FaqSection>();
}
