import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input } from '@angular/core';
import { Meta, MetaDefinition } from '@angular/platform-browser';
import { LandingContent } from './landing.content';
import { LandingContentService } from './landing-content.service';
import { LandingHeader } from './landing-header';
import { LpCta } from './sections/cta';
import { LpFaq } from './sections/faq';
import { LpFeatures } from './sections/features';
import { LpFooter } from './sections/footer';
import { LpHero } from './sections/hero';
import { LpIntro } from './sections/intro';
import { LpPreview } from './sections/preview';
import { LpPrinciples } from './sections/principles';
import { LpSteps } from './sections/steps';

/**
 * Página pública. Dibuja, en el orden de `LANDING_SECTIONS`, cada sección activa con su componente; el menú superior
 * se arma con las que tienen `nav`. Para agregar una sección nueva: un componente en `sections/`, un tipo en el
 * contenido y un caso en este `@switch`.
 */
@Component({
  selector: 'app-landing',
  imports: [LandingHeader, LpHero, LpIntro, LpFeatures, LpSteps, LpPreview, LpPrinciples, LpFaq, LpCta, LpFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lp">
      <a class="lp-skip" href="#contenido-landing" (click)="skip($event)">Saltar al contenido</a>
      <app-lp-header [links]="nav()" />
      <main id="contenido-landing" tabindex="-1">
        @for (s of sections(); track s.id) {
          @switch (s.type) {
            @case ('hero') { <app-lp-hero [s]="s" /> }
            @case ('intro') { <app-lp-intro [s]="s" /> }
            @case ('features') { <app-lp-features [s]="s" /> }
            @case ('steps') { <app-lp-steps [s]="s" /> }
            @case ('preview') { <app-lp-preview [s]="s" /> }
            @case ('principles') { <app-lp-principles [s]="s" /> }
            @case ('faq') { <app-lp-faq [s]="s" /> }
            @case ('cta') { <app-lp-cta [s]="s" /> }
          }
        }
      </main>
      <app-lp-footer [f]="footer()" />
    </div>
  `,
  styles: `
    .lp-skip { position: absolute; inset-inline-start: var(--space-3); inset-block-start: -4rem; z-index: 30; padding: var(--space-3) var(--space-4); border-radius: var(--radius-m); background: var(--brand-ink); color: var(--surface, #fff); }
    .lp-skip:focus { inset-block-start: var(--space-3); }
    main:focus { outline: none; }
  `,
})
export class Landing {
  private readonly meta = inject(Meta);
  private readonly content = inject(LandingContentService);
  /** Vista previa del CRM: dibuja este contenido (un borrador) en lugar del publicado. */
  readonly preview = input<LandingContent | null>(null);
  private readonly data = computed(() => this.preview() ?? this.content.content());
  protected readonly sections = computed(() => this.data().sections.filter((s) => s.enabled !== false));
  protected readonly nav = computed(() => this.sections().filter((s) => s.nav).map((s) => ({ id: s.id, label: s.nav as string })));
  protected readonly footer = computed(() => this.data().footer);

  constructor() {
    this.content.load();
    const selectors = ["name='description'", "property='og:title'", "property='og:description'", "property='og:type'"];
    // La vista previa no toca las etiquetas de la página (no es la página pública).
    effect(() => {
      if (this.preview()) return;
      const m = this.data().meta;
      const defs: MetaDefinition[] = [
        { name: 'description', content: m.description },
        { property: 'og:title', content: m.title },
        { property: 'og:description', content: m.description },
        { property: 'og:type', content: 'website' },
      ];
      defs.forEach((d, i) => this.meta.updateTag(d, selectors[i]));
    });
    inject(DestroyRef).onDestroy(() => selectors.forEach((s) => this.meta.removeTag(s)));
  }

  protected skip(e: Event): void {
    e.preventDefault();
    document.getElementById('contenido-landing')?.focus();
  }
}
