/**
 * Paquete de colores de marca que la nutrióloga puede elegir (sin escribir hexadecimales).
 * `primary` es la tinta de la marca: botones, foco y menú activo sobre fondo claro; `secondary` es la superficie
 * suave (selección, avatar). Todos cumplen contraste ≥ 7:1 (AAA) del principal contra el marfil y el blanco,
 * y texto normal ≥ 4.5:1 sobre el secundario. Las variantes oscuras cumplen ≥ 7:1 contra el fondo y el texto
 * sobre la superficie profunda (todo se comprueba en `brand-palettes.spec.ts`).
 */
export interface BrandPalette {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  /** Variante para modo oscuro: tono claro de la tinta y superficie profunda para selecciones. */
  darkPrimary: string;
  darkSecondary: string;
}

export const BRAND_PALETTES: readonly BrandPalette[] = [
  { id: 'ciruela', name: 'Ciruela', primary: '#4E344C', secondary: '#DDD6F2', darkPrimary: '#EFE6EE', darkSecondary: '#443B62' },
  { id: 'pino', name: 'Pino', primary: '#2B5448', secondary: '#D7E8D5', darkPrimary: '#CFE5DA', darkSecondary: '#2F4A40' },
  { id: 'oceano', name: 'Océano', primary: '#1F4E6B', secondary: '#D8E8F2', darkPrimary: '#CBE2F2', darkSecondary: '#2B4660' },
  { id: 'indigo', name: 'Índigo', primary: '#3E4A9C', secondary: '#DCE0F5', darkPrimary: '#D3D8F8', darkSecondary: '#38407A' },
  { id: 'vino', name: 'Vino', primary: '#7A2E3F', secondary: '#F4D3DC', darkPrimary: '#F5D0D8', darkSecondary: '#5E2F3C' },
  { id: 'terracota', name: 'Terracota', primary: '#7F3E22', secondary: '#F4DFD2', darkPrimary: '#F3D5C6', darkSecondary: '#5C3A2A' },
  { id: 'ocre', name: 'Ocre', primary: '#654C0D', secondary: '#F8E8B8', darkPrimary: '#F1DDA0', darkSecondary: '#5A4A1C' },
  { id: 'pizarra', name: 'Pizarra', primary: '#3F4A55', secondary: '#E1E6EB', darkPrimary: '#D7DEE6', darkSecondary: '#3C4651' },
  { id: 'turquesa', name: 'Turquesa', primary: '#165A5A', secondary: '#D2EBE8', darkPrimary: '#C5E8E4', darkSecondary: '#2A5252' },
  { id: 'oliva', name: 'Oliva', primary: '#4A5522', secondary: '#E4EBCB', darkPrimary: '#DCE6B8', darkSecondary: '#444E26' },
];

export const DEFAULT_PALETTE = BRAND_PALETTES[0];

/** Paleta del paquete que corresponde a un color principal guardado (sin distinguir mayúsculas). */
export const paletteOf = (primary: string): BrandPalette | undefined => BRAND_PALETTES.find((p) => p.primary.toLowerCase() === primary.trim().toLowerCase());
