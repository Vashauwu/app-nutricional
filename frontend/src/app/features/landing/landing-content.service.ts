import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api-client';
import { BUNDLED_LANDING, LandingContent } from './landing.content';

/**
 * Contenido de la landing. Siempre hay algo que mostrar: parte del contenido empaquetado y, si el CRM tiene una versión
 * publicada, la reemplaza al llegar. Si la API no responde (o aún no hay nada publicado), la página no cambia ni se rompe.
 */
@Injectable({ providedIn: 'root' })
export class LandingContentService {
  private readonly api = inject(ApiClient);
  readonly content = signal<LandingContent>(BUNDLED_LANDING);
  private requested = false;

  load(): void {
    if (this.requested || !this.api.enabled) return;
    this.requested = true;
    this.api.get<{ content: LandingContent }>('/public/landing').subscribe({
      next: (r) => this.content.set(normalizeLanding(r.content)),
      error: () => undefined,
    });
  }
}

/** El servidor omite las listas vacías: aquí se restituyen para que las secciones siempre reciban arreglos. */
export function normalizeLanding(c: LandingContent): LandingContent {
  return {
    meta: c.meta,
    sections: c.sections.map((s) => (s.type === 'preview' ? { ...s, bullets: s.bullets ?? [] } : s)),
    footer: { ...c.footer, links: c.footer.links ?? [] },
  };
}
