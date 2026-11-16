/**
 * Paquete de colores de marca que la nutrióloga puede elegir (sin escribir hexadecimales).
 * `primary` es la tinta de la marca: botones, foco y menú activo sobre fondo claro; `secondary` es la superficie
 * suave (selección, avatar). Todos cumplen contraste ≥ 7:1 (AAA) del principal contra el marfil y el blanco,
 * y texto normal ≥ 4.5:1 sobre el secundario (se comprueba en `brand-palettes.spec.ts`).
 */
export interface BrandPalette {
  id: string;
  name: string;
  primary: string;
  secondary: string;
}

export const BRAND_PALETTES: readonly BrandPalette[] = [
  { id: 'ciruela', name: 'Ciruela', primary: '#4E344C', secondary: '#DDD6F2' },
  { id: 'pino', name: 'Pino', primary: '#2B5448', secondary: '#D7E8D5' },
  { id: 'oceano', name: 'Océano', primary: '#1F4E6B', secondary: '#D8E8F2' },
  { id: 'indigo', name: 'Índigo', primary: '#3E4A9C', secondary: '#DCE0F5' },
  { id: 'vino', name: 'Vino', primary: '#7A2E3F', secondary: '#F4D3DC' },
  { id: 'terracota', name: 'Terracota', primary: '#7F3E22', secondary: '#F4DFD2' },
  { id: 'ocre', name: 'Ocre', primary: '#654C0D', secondary: '#F8E8B8' },
  { id: 'pizarra', name: 'Pizarra', primary: '#3F4A55', secondary: '#E1E6EB' },
  { id: 'turquesa', name: 'Turquesa', primary: '#165A5A', secondary: '#D2EBE8' },
  { id: 'oliva', name: 'Oliva', primary: '#4A5522', secondary: '#E4EBCB' },
];

export const DEFAULT_PALETTE = BRAND_PALETTES[0];
