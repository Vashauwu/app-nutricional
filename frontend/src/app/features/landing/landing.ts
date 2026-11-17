import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { Meta, MetaDefinition } from '@angular/platform-browser';
import { LANDING_FOOTER, LANDING_META, LANDING_SECTIONS, LandingSection } from './landing.content';
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
      <app-lp-header [links]="nav" />
      <main id="contenido-landing" tabindex="-1">
        @for (s of sections; track s.id) {
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
      <app-lp-footer [f]="footer" />
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
  protected readonly sections: LandingSection[] = LANDING_SECTIONS.filter((s) => s.enabled !== false);
  protected readonly nav = this.sections.filter((s) => s.nav).map((s) => ({ id: s.id, label: s.nav as string }));
  protected readonly footer = LANDING_FOOTER;

  constructor() {
    const tags: { selector: string; def: MetaDefinition }[] = [
      { selector: "name='description'", def: { name: 'description', content: LANDING_META.description } },
      { selector: "property='og:title'", def: { property: 'og:title', content: LANDING_META.title } },
      { selector: "property='og:description'", def: { property: 'og:description', content: LANDING_META.description } },
      { selector: "property='og:type'", def: { property: 'og:type', content: 'website' } },
    ];
    this.meta.addTags(tags.map((t) => t.def));
    inject(DestroyRef).onDestroy(() => tags.forEach((t) => this.meta.removeTag(t.selector)));
  }

  protected skip(e: Event): void {
    e.preventDefault();
    document.getElementById('contenido-landing')?.focus();
  }
}
