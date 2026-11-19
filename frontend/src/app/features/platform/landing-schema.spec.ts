import { describe, expect, it } from 'vitest';
import { BUNDLED_LANDING, LandingContent } from '../landing/landing.content';
import { normalizeLanding } from '../landing/landing-content.service';
import { LANDING_TYPES, ROUTE_DESTS, diffLanding } from './landing-schema';

const clone = (): LandingContent => structuredClone(BUNDLED_LANDING);

describe('revisión de la landing (diferencias)', () => {
  it('sin cambios no hay diferencias', () => {
    expect(diffLanding(BUNDLED_LANDING, clone())).toEqual([]);
  });

  it('un texto cambiado se describe con el campo en español, sin claves técnicas', () => {
    const c = clone();
    c.sections[0] = { ...c.sections[0], title: 'Título nuevo' } as LandingContent['sections'][number];
    const d = diffLanding(BUNDLED_LANDING, c);
    expect(d).toHaveLength(1);
    expect(d[0].where).toBe('Sección «inicio» · Título');
    expect(d[0].after).toBe('Título nuevo');
    expect(d[0].before).not.toBe('');
  });

  it('mover una sección es un cambio de orden, no decenas de cambios de contenido', () => {
    const c = clone();
    [c.sections[2], c.sections[3]] = [c.sections[3], c.sections[2]];
    const d = diffLanding(BUNDLED_LANDING, c);
    expect(d).toHaveLength(1);
    expect(d[0].where).toBe('Orden de las secciones');
  });

  it('quitar una sección lista lo que se quita', () => {
    const c = clone();
    c.sections = c.sections.filter((s) => s.id !== 'preguntas');
    const d = diffLanding(BUNDLED_LANDING, c);
    expect(d.some((x) => x.where.startsWith('Sección «preguntas»') && x.after === '')).toBe(true);
  });
});

describe('secciones nuevas del editor', () => {
  it('cada plantilla nace con textos (el servidor los exige) y sin palabras vigiladas', () => {
    for (const [type, def] of Object.entries(LANDING_TYPES).filter(([, d]) => d.addable)) {
      const s = def.make();
      expect(JSON.stringify(s), type).not.toMatch(/\$|mxn|testimonio|certificad|garant|gratis|whatsapp/i);
      for (const l of def.lists) for (const it of [l.blank()]) expect(it, `${type}.${l.key}`).toBeTruthy();
    }
  });

  it('los destinos que ofrece el editor son los que acepta el servidor', () => {
    expect(ROUTE_DESTS).toEqual(['/ingresar', '/registro', '/privacidad', '/terminos', '/inicio']);
  });
});

describe('contenido publicado que llega de la API', () => {
  it('el servidor omite las listas vacías: se restituyen para que las secciones no fallen', () => {
    const c = clone();
    const p = c.sections.find((s) => s.type === 'preview');
    if (p && p.type === 'preview') delete (p as { bullets?: string[] }).bullets;
    delete (c.footer as { links?: unknown }).links;
    const n = normalizeLanding(c);
    const np = n.sections.find((s) => s.type === 'preview');
    expect(np && np.type === 'preview' ? np.bullets : null).toEqual([]);
    expect(n.footer.links).toEqual([]);
  });
});
