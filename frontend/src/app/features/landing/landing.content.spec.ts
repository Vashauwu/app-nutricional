import { describe, expect, it } from 'vitest';
import { LANDING_FOOTER, LANDING_SECTIONS } from './landing.content';

describe('contenido de la landing', () => {
  const all = LANDING_SECTIONS;
  const ids = all.map((s) => s.id);

  it('cada sección tiene un id único', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('los botones que apuntan a un ancla llegan a una sección activa', () => {
    const active = new Set(all.filter((s) => s.enabled !== false).map((s) => s.id));
    const actions = all.flatMap((s) => (s.type === 'hero' ? s.actions : s.type === 'cta' ? [s.action] : []));
    for (const a of actions.filter((x) => x.to.startsWith('#'))) expect(active.has(a.to.slice(1)), a.to).toBe(true);
  });

  it('hay exactamente un hero y es el primero', () => {
    expect(all.filter((s) => s.type === 'hero')).toHaveLength(1);
    expect(all[0].type).toBe('hero');
  });

  it('las rutas internas son las que existen hoy', () => {
    const known = new Set(['/ingresar', '/privacidad', '/terminos']);
    const links = [...LANDING_FOOTER.links.map((l) => l.to), ...all.flatMap((s) => (s.type === 'hero' ? s.actions.map((a) => a.to) : s.type === 'cta' ? [s.action.to] : []))];
    for (const to of links.filter((x) => x.startsWith('/'))) expect(known.has(to), to).toBe(true);
  });

  it('no promete lo que el producto no tiene (precios, testimonios, certificaciones)', () => {
    const text = JSON.stringify(all).toLowerCase();
    for (const w of ['$', 'mxn', 'testimonio', 'certificad', 'garantía', 'gratis', 'whatsapp']) expect(text.includes(w), w).toBe(false);
  });
});
