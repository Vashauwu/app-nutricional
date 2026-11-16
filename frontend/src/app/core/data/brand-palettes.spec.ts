import { describe, expect, it } from 'vitest';
import { contrastRatio, isHex } from '../services/ui.services';
import { BRAND_PALETTES } from './brand-palettes';

describe('Paquete de colores de marca', () => {
  it('tiene 10 colores distintos y con formato válido', () => {
    expect(BRAND_PALETTES).toHaveLength(10);
    expect(new Set(BRAND_PALETTES.map((p) => p.primary.toLowerCase())).size).toBe(10);
    expect(new Set(BRAND_PALETTES.map((p) => p.id)).size).toBe(10);
    for (const p of BRAND_PALETTES) { expect(isHex(p.primary)).toBe(true); expect(isHex(p.secondary)).toBe(true); }
  });
  it.each(BRAND_PALETTES.map((p) => [p.name, p] as const))('%s cumple contraste AAA del principal y AA del texto sobre el secundario', (_n, p) => {
    expect(contrastRatio(p.primary, '#FAF7F2')).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.primary, '#FFFFFF')).toBeGreaterThanOrEqual(7);
    expect(contrastRatio('#514653', p.secondary)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(BRAND_PALETTES.map((p) => [p.name, p] as const))('%s: variante oscura con contraste suficiente', (_n, p) => {
    expect(contrastRatio(p.darkPrimary, '#1D181F')).toBeGreaterThanOrEqual(7); // fondo oscuro
    expect(contrastRatio(p.darkPrimary, '#28222A')).toBeGreaterThanOrEqual(7); // superficie
    expect(contrastRatio('#FBF5FB', p.darkSecondary)).toBeGreaterThanOrEqual(7); // texto fuerte sobre la selección
    expect(contrastRatio(p.darkPrimary, p.darkSecondary)).toBeGreaterThanOrEqual(4.5); // letra del avatar
  });
  it('el primero es el ciruela por omisión de la marca', () => {
    expect(BRAND_PALETTES[0].primary).toBe('#4E344C');
  });
});
