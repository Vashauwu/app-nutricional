import { LandingContent } from '../landing/landing.content';

/** Objeto libre que edita el formulario (el servidor valida su forma; aquí solo se escribe en él). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Rec { type: string; id: string; enabled?: boolean; [key: string]: any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Free = Record<string, any>;

export interface FieldDef { key: string; label: string; kind: 'text' | 'area' | 'icon' | 'dest' | 'select'; options?: string[] }
export interface ListDef { key: string; label: string; noun: string; max: number; strings?: boolean; fields: FieldDef[]; blank: () => unknown }
export interface TypeDef {
  label: string;
  addable: boolean;
  fields: FieldDef[];
  object?: { key: string; label: string; fields: FieldDef[] };
  lists: ListDef[];
  /** Sección nueva ya válida (el servidor exige textos): el editor las pule después. */
  make: () => Free;
}

export const fieldKey = (key: string, label: string, kind: FieldDef['kind'], options?: string[]): FieldDef => ({ key, label, kind, options });

/** Destinos que el servidor acepta además de las secciones de la página (lista cerrada). */
export const ROUTE_DESTS = ['/ingresar', '/registro', '/privacidad', '/terminos', '/inicio'];

const title = fieldKey('title', 'Título', 'text');
const text = fieldKey('text', 'Texto', 'area');
const note = fieldKey('note', 'Nota breve', 'text');
const itemTitle = fieldKey('title', 'Título', 'text');
const itemText = fieldKey('text', 'Texto', 'area');
const icon = fieldKey('icon', 'Ícono', 'icon');
const action = [fieldKey('label', 'Texto del botón', 'text'), fieldKey('to', 'Destino', 'dest')];

export const LANDING_TYPES: Record<string, TypeDef> = {
  hero: {
    label: 'Principal (encabezado)', addable: false,
    fields: [title, text, note],
    lists: [{ key: 'actions', label: 'Botones', noun: 'botón', max: 3, fields: [...action, fieldKey('kind', 'Estilo', 'select', ['primary', 'ghost'])], blank: () => ({ label: 'Botón', to: '/ingresar', kind: 'ghost' }) }],
    make: () => ({}),
  },
  intro: {
    label: 'Introducción', addable: true, fields: [title, text],
    lists: [{ key: 'points', label: 'Puntos', noun: 'punto', max: 6, fields: [itemTitle, itemText], blank: () => ({ title: 'Título', text: 'Texto' }) }],
    make: () => ({ title: 'Nueva sección', text: 'Describe esta sección.', points: [{ title: 'Título', text: 'Texto' }] }),
  },
  features: {
    label: 'Funcionalidades (tarjetas con ícono)', addable: true, fields: [title, text],
    lists: [{ key: 'items', label: 'Tarjetas', noun: 'tarjeta', max: 12, fields: [icon, itemTitle, itemText], blank: () => ({ icon: 'heart', title: 'Título', text: 'Texto' }) }],
    make: () => ({ title: 'Nueva sección', text: 'Describe esta sección.', items: [{ icon: 'heart', title: 'Título', text: 'Texto' }] }),
  },
  steps: {
    label: 'Pasos', addable: true, fields: [title],
    lists: [{ key: 'items', label: 'Pasos', noun: 'paso', max: 8, fields: [itemTitle, itemText], blank: () => ({ title: 'Título', text: 'Texto' }) }],
    make: () => ({ title: 'Cómo funciona', items: [{ title: 'Primer paso', text: 'Describe el paso.' }] }),
  },
  preview: {
    label: 'Vista de la plataforma', addable: true, fields: [title, text, fieldKey('caption', 'Leyenda de la ilustración', 'text')],
    lists: [{ key: 'bullets', label: 'Viñetas', noun: 'viñeta', max: 10, strings: true, fields: [], blank: () => 'Viñeta' }],
    make: () => ({ title: 'Conoce la plataforma', text: 'Describe lo que se ve.', caption: 'Ilustración con datos ficticios.', bullets: [] }),
  },
  principles: {
    label: 'Principios (tarjetas con ícono)', addable: true, fields: [title],
    lists: [{ key: 'items', label: 'Principios', noun: 'principio', max: 12, fields: [icon, itemTitle, itemText], blank: () => ({ icon: 'lock', title: 'Título', text: 'Texto' }) }],
    make: () => ({ title: 'Nuestros principios', items: [{ icon: 'lock', title: 'Título', text: 'Texto' }] }),
  },
  faq: {
    label: 'Preguntas frecuentes', addable: true, fields: [title],
    lists: [{ key: 'items', label: 'Preguntas', noun: 'pregunta', max: 20, fields: [fieldKey('q', 'Pregunta', 'text'), fieldKey('a', 'Respuesta', 'area')], blank: () => ({ q: 'Pregunta', a: 'Respuesta' }) }],
    make: () => ({ title: 'Preguntas frecuentes', items: [{ q: 'Pregunta', a: 'Respuesta' }] }),
  },
  cta: {
    label: 'Llamado a la acción', addable: true, fields: [title, text, note],
    object: { key: 'action', label: 'Botón', fields: action },
    lists: [],
    make: () => ({ title: 'Empieza hoy', text: 'Invita a dar el siguiente paso.', note: '', action: { label: 'Ingresar a la plataforma', to: '/ingresar', kind: 'primary' } }),
  },
};

// ---- Diferencias para la revisión ----

function flat(v: unknown, path: string, out: Map<string, string>): void {
  if (Array.isArray(v)) v.forEach((x, i) => flat(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) flat(x, path ? `${path}.${k}` : k, out);
  else if (v !== undefined && v !== null && v !== '') out.set(path, String(v));
}

/** Las secciones se comparan por su id (no por posición): mover una sección es «orden», no cien cambios. */
function keyed(c: LandingContent): Map<string, string> {
  const out = new Map<string, string>();
  flat(c.meta, 'meta', out);
  flat(c.footer, 'footer', out);
  out.set('orden', c.sections.map((s) => s.id).join(' → '));
  for (const s of c.sections) flat(s, `sections.${s.id}`, out);
  return out;
}

const FIELD: Record<string, string> = { title: 'Título', text: 'Texto', note: 'Nota', caption: 'Leyenda', label: 'Texto del botón', to: 'Destino', q: 'Pregunta', a: 'Respuesta', description: 'Descripción', legal: 'Aviso', nav: 'Menú', icon: 'Ícono', kind: 'Estilo', enabled: 'Visible', id: 'Ancla' };
/** items[2].title → «Título» del elemento 3: legible para quien revisa. */
const human = (rest: string): string => rest.replace(/\[(\d+)\]/g, (_, n: string) => ' ' + (Number(n) + 1)).split('.').map((k) => FIELD[k] ?? k).join(' › ');

const where = (path: string): string => {
  if (path === 'orden') return 'Orden de las secciones';
  if (path.startsWith('meta.')) return `Página · ${human(path.slice(5))}`;
  if (path.startsWith('footer.')) return `Pie · ${human(path.slice(7))}`;
  const m = /^sections\.([a-z0-9-]+)\.?(.*)$/.exec(path);
  return m ? `Sección «${m[1]}»${m[2] ? ' · ' + human(m[2]) : ''}` : path;
};

export interface Change { where: string; before: string; after: string }

export function diffLanding(before: LandingContent, after: LandingContent): Change[] {
  const a = keyed(before), b = keyed(after);
  const out: Change[] = [];
  for (const [p, v] of b) if (a.get(p) !== v) out.push({ where: where(p), before: a.get(p) ?? '', after: v });
  for (const [p, v] of a) if (!b.has(p)) out.push({ where: where(p), before: v, after: '' });
  return out.slice(0, 80);
}
