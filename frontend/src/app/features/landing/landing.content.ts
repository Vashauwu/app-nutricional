import { IconName } from '../../shared/components/icon';

/**
 * Contenido de la página pública. Todo lo que se lee en la landing (salvo el menú superior) vive aquí:
 * para cambiar un texto, quitar una sección o reordenarlas basta con editar este archivo.
 *
 * Reglas del contenido: solo lo que el producto hace hoy (PRODUCT.md). Sin testimonios, cifras, precios ni
 * certificaciones inventados; si algún día existen, se agregan como una sección nueva de `LANDING_SECTIONS`.
 */

/** Destino de un botón o enlace: ruta de la aplicación (`/ingresar`) o ancla de esta página (`#funcionalidades`). */
export interface Action { label: string; to: string; kind?: 'primary' | 'ghost' }

interface Base {
  /** Ancla de la sección (id del elemento). */
  id: string;
  /** Texto que aparece en el menú superior; sin él la sección no se enlaza. */
  nav?: string;
  /** `false` oculta la sección sin borrarla. */
  enabled?: boolean;
}

export interface HeroSection extends Base { type: 'hero'; title: string; text: string; actions: Action[]; note: string }
export interface IntroSection extends Base { type: 'intro'; title: string; text: string; points: { title: string; text: string }[] }
export interface FeaturesSection extends Base { type: 'features'; title: string; text: string; items: { icon: IconName; title: string; text: string }[] }
export interface StepsSection extends Base { type: 'steps'; title: string; items: { title: string; text: string }[] }
export interface PreviewSection extends Base { type: 'preview'; title: string; text: string; bullets: string[]; caption: string }
export interface PrinciplesSection extends Base { type: 'principles'; title: string; items: { icon: IconName; title: string; text: string }[] }
export interface FaqSection extends Base { type: 'faq'; title: string; items: { q: string; a: string }[] }
export interface CtaSection extends Base { type: 'cta'; title: string; text: string; action: Action; note: string }

export type LandingSection = HeroSection | IntroSection | FeaturesSection | StepsSection | PreviewSection | PrinciplesSection | FaqSection | CtaSection;

export interface LandingMeta { title: string; description: string }
export interface LandingFooter {
  legal: string;
  links: { label: string; to: string }[];
}

export const LANDING_META: LandingMeta = {
  title: 'Nutrición Integral · Gestión de pacientes y planes de alimentación',
  description: 'Expedientes, planes de alimentación con calendario, equivalentes SMAE y seguimiento de tus pacientes en un solo lugar. Herramienta de apoyo para nutriólogas y nutriólogos.',
};

/** Orden de arriba hacia abajo. Cambiar el orden del arreglo cambia el de la página. */
export const LANDING_SECTIONS: LandingSection[] = [
  {
    type: 'hero', id: 'inicio', nav: 'Inicio',
    title: 'Dedica más tiempo a tus pacientes. Nutrición Integral te ayuda con el resto.',
    text: 'Organiza expedientes, arma planes de alimentación en un calendario y da seguimiento a tus pacientes desde una experiencia clara y sencilla.',
    actions: [
      { label: 'Ingresar a la plataforma', to: '/ingresar', kind: 'primary' },
      { label: 'Ver cómo funciona', to: '#como-funciona', kind: 'ghost' },
    ],
    note: 'Herramienta de apoyo profesional: no sustituye el criterio clínico.',
  },
  {
    type: 'intro', id: 'por-que',
    title: 'Menos tiempo armando y reenviando planes, más tiempo para la consulta.',
    text: 'La información de cada paciente, sus consultas y su plan de alimentación suelen vivir en lugares distintos. Nutrición Integral los reúne para que consultarlos y actualizarlos sea rápido.',
    points: [
      { title: 'Todo del paciente en un expediente', text: 'Datos generales, mediciones y objetivos, disponibles cuando los necesitas en la consulta.' },
      { title: 'Planes y calendario juntos', text: 'Arma el menú por día y por tiempo de comida, y ve de inmediato cuánto aporta cada día.' },
      { title: 'Seguimiento sin intermediarios', text: 'Tu paciente consulta el plan que publicaste y registra cómo le va; tú lo revisas con datos.' },
    ],
  },
  {
    type: 'features', id: 'funcionalidades', nav: 'Funcionalidades',
    title: 'Lo que puedes hacer hoy con la plataforma',
    text: 'Cada herramienta está pensada para el trabajo diario de una consulta de nutrición.',
    items: [
      { icon: 'users', title: 'Expediente del paciente', text: 'Datos generales, antropometría y objetivos en un solo lugar. El paciente acepta su aviso de privacidad y consentimiento antes de acceder.' },
      { icon: 'calendar', title: 'Planes con calendario', text: 'Arrastra platillos al día y al tiempo de comida que corresponde, duplica días o semanas y reutiliza plantillas.' },
      { icon: 'dish', title: 'Platillos con cálculo nutricional', text: 'Cada platillo calcula su aporte con precisión decimal y conserva sus versiones, para reconstruir exactamente lo que el paciente vio.' },
      { icon: 'calculator', title: 'Dietocálculo y equivalentes SMAE', text: 'Compara ecuaciones de gasto energético, reparte equivalentes por grupo y por tiempo de comida, y revisa la adecuación contra la meta.' },
      { icon: 'bell', title: 'Alertas que explican su motivo', text: 'Cada alerta muestra el dato que la originó y nunca bloquea la publicación: la decisión sigue siendo tuya.' },
      { icon: 'activity', title: 'Seguimiento y reportes', text: 'Comidas marcadas, fotos y comentarios de tus pacientes, y reportes de cumplimiento separados de la evolución antropométrica.' },
    ],
  },
  {
    type: 'steps', id: 'como-funciona', nav: 'Cómo funciona',
    title: 'De la consulta al plan, en cuatro pasos',
    items: [
      { title: 'Registra a tu paciente', text: 'Da de alta su expediente con sus datos, mediciones y objetivos.' },
      { title: 'Calcula su requerimiento', text: 'Usa el Dietocálculo para obtener la prescripción y el reparto de equivalentes.' },
      { title: 'Arma el plan en el calendario', text: 'Elige platillos de tu biblioteca para cada tiempo de comida y revisa las alertas.' },
      { title: 'Publica y da seguimiento', text: 'Tu paciente ve su plan en el celular, registra sus comidas y tú revisas los avances.' },
    ],
  },
  {
    type: 'preview', id: 'plataforma',
    title: 'Un calendario claro para cada semana de tu paciente',
    text: 'Verás cada día con sus tiempos de comida, cuánta energía aporta contra la meta y qué grupos de equivalentes faltan o sobran.',
    bullets: ['Suma de energía y macronutrimentos por día', 'Equivalentes planeados contra la meta', 'Deshacer, rehacer y guardado automático'],
    caption: 'Ejemplo ilustrativo con datos ficticios.',
  },
  {
    type: 'principles', id: 'principios',
    title: 'Pensada para cuidar tu criterio y la información de tus pacientes',
    items: [
      { icon: 'stethoscope', title: 'Apoyo, no sustitución', text: 'Cada cálculo y cada alerta muestran su origen. La decisión clínica es siempre de la nutrióloga o el nutriólogo.' },
      { icon: 'lock', title: 'Datos sensibles protegidos', text: 'Aviso de privacidad y consentimiento antes de dar acceso, archivos clínicos siempre privados y registro de cambios.' },
      { icon: 'history', title: 'Todo se puede reconstruir', text: 'Platillos y planes se versionan: lo que tu paciente vio y registró queda disponible tal como fue.' },
      { icon: 'heart', title: 'Con tu propia marca', text: 'Nombre comercial, logotipo y colores de tu consulta, configurables sin tocar código.' },
    ],
  },
  {
    type: 'faq', id: 'preguntas', nav: 'Preguntas',
    title: 'Preguntas frecuentes',
    items: [
      { q: '¿Qué es Nutrición Integral?', a: 'Una plataforma web para nutriólogas y nutriólogos que reúne expedientes, platillos, planes de alimentación con calendario, Dietocálculo, seguimiento y reportes.' },
      { q: '¿A quién está dirigida?', a: 'A profesionales de la nutrición que atienden pacientes adultos y quieren organizar su consulta y sus planes. Los pacientes usan una versión pensada para el celular para consultar su plan.' },
      { q: '¿Puedo crear planes de alimentación para mis pacientes?', a: 'Sí. Armas el plan por día y tiempo de comida con tus platillos, revisas las alertas y lo publicas. Tu paciente solo ve los planes publicados.' },
      { q: '¿Reemplaza mi criterio profesional?', a: 'No. Es una herramienta de apoyo: calcula y avisa, pero las decisiones clínicas son tuyas.' },
      { q: '¿Cómo accedo?', a: 'Desde el botón «Ingresar». Si eres paciente, usa el correo con el que tu nutrióloga te registró.' },
    ],
  },
  {
    type: 'cta', id: 'comenzar',
    title: 'Haz que tu práctica nutricional fluya mejor.',
    text: 'Conoce una forma más ordenada de trabajar con tus pacientes y sus planes de alimentación.',
    action: { label: 'Ingresar a la plataforma', to: '/ingresar', kind: 'primary' },
    note: '¿Eres paciente? Ingresa con el correo con el que tu nutrióloga te registró.',
  },
];

export const LANDING_FOOTER: LandingFooter = {
  legal: 'Herramienta de apoyo profesional: no sustituye el criterio clínico.',
  links: [
    { label: 'Ingresar', to: '/ingresar' },
    { label: 'Aviso de privacidad', to: '/privacidad' },
    { label: 'Términos de uso', to: '/terminos' },
  ],
};
