import { formatDate, formatDateTime } from '../../shared/utils/format';
import { PlanCode, SubState, ActionKind, ActionStatus, PaymentRow } from '../../core/api/platform-api';

/** Textos y colores de cada estado: un solo lugar para que todas las pantallas del panel hablen igual. */
export type Tone = 'positive' | 'info' | 'warning' | 'negative' | 'neutral';

export const STATE_LABEL: Record<SubState, string> = { free: 'Gratuita', trialing: 'En prueba', active: 'Activa', past_due: 'Cobro fallido', canceled: 'Cancelada', expired: 'Vencida' };
export const STATE_TONE: Record<SubState, Tone> = { free: 'neutral', trialing: 'info', active: 'positive', past_due: 'negative', canceled: 'warning', expired: 'warning' };
export const ROLE_LABEL: Record<string, string> = { platform_owner: 'Dueño', platform_support: 'Soporte', platform_viewer: 'Solo lectura', platform_content: 'Contenido', platform_admin: 'Administrador (heredado)' };
export const ROLE_HELP: Record<string, string> = {
  platform_owner: 'Todo: cuentas, aprobaciones, equipo y contenido.',
  platform_support: 'Ve las cuentas y opera (suspender, pedir cortesías y reembolsos), pero no aprueba.',
  platform_viewer: 'Solo mira el panel; no cambia nada.',
  platform_content: 'Edita la landing y pide publicarla; no ve cuentas.',
  platform_admin: 'Rol anterior a los roles finos; equivale a dueño.',
};
export const STAFF_STATUS_LABEL: Record<string, string> = { active: 'Activo', invited: 'Invitación pendiente', disabled: 'Deshabilitado' };
export const STAFF_STATUS_TONE: Record<string, Tone> = { active: 'positive', invited: 'warning', disabled: 'neutral' };
export const PLAN_LABEL: Record<PlanCode, string> = { free: 'Gratuito', standard: 'Estándar', pro: 'Pro' };
export const KIND_LABEL: Record<ActionKind, string> = { comp_plan: 'Plan de cortesía', extend_trial: 'Prórroga de prueba', refund: 'Reembolso' };
export const ACTION_LABEL: Record<ActionStatus, string> = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada', executed: 'Ejecutada', failed: 'Falló' };
export const ACTION_TONE: Record<ActionStatus, Tone> = { pending: 'warning', approved: 'info', rejected: 'neutral', executed: 'positive', failed: 'negative' };
export const PAYMENT_LABEL: Record<PaymentRow['status'], string> = { paid: 'Pagado', failed: 'Fallido', refunded: 'Reembolsado', chargeback: 'Contracargo' };
export const PAYMENT_TONE: Record<PaymentRow['status'], Tone> = { paid: 'positive', failed: 'negative', refunded: 'neutral', chargeback: 'negative' };

/** Nombre de la acción de bitácora legible (las desconocidas se muestran tal cual). */
export const AUDIT_LABEL: Record<string, string> = {
  'platform.suspend': 'Cuenta suspendida', 'platform.reactivate': 'Cuenta reactivada', 'platform.action_requested': 'Solicitud creada',
  'platform.action_approved': 'Solicitud aprobada', 'platform.action_rejected': 'Solicitud rechazada', 'platform.action_executed': 'Solicitud ejecutada',
  'platform.action_failed': 'La solicitud falló al ejecutarse', 'platform.provider_subscription_canceled': 'Cobro automático cancelado (por cortesía)',
  'platform.staff_invited': 'Persona invitada al equipo', 'platform.staff_invite_resent': 'Invitación reenviada', 'platform.staff_role_changed': 'Rol del equipo cambiado',
  'platform.staff_disabled': 'Persona del equipo deshabilitada', 'platform.staff_enabled': 'Persona del equipo habilitada',
  'platform.landing_requested': 'Publicación de la landing pedida', 'platform.landing_withdrawn': 'Publicación de la landing retirada', 'platform.landing_rejected': 'Publicación de la landing rechazada',
  'platform.landing_published': 'Landing publicada', 'platform.landing_restored': 'Versión de la landing restaurada como borrador',
  'auth.signup': 'Cuenta creada', 'auth.login': 'Inicio de sesión', 'auth.login_failed': 'Inicio de sesión fallido', 'auth.login_blocked': 'Inicio de sesión bloqueado',
  'auth.login_blocked_suspended': 'Intento de acceso a cuenta suspendida', 'auth.logout': 'Cierre de sesión', 'auth.password_reset_requested': 'Recuperación de contraseña pedida',
  'auth.password_reset': 'Contraseña restablecida', 'auth.password_set_by_admin': 'Contraseña fijada por administración', 'auth.email_verified': 'Correo confirmado',
  'auth.google_failed': 'Acceso con Google rechazado', 'auth.refresh_reuse': 'Posible reutilización de sesión', 'auth.account_disabled': 'Cuenta deshabilitada',
  'billing.checkout': 'Contratación de plan', 'billing.upgrade': 'Cambio a un plan superior', 'billing.downgrade_scheduled': 'Baja de plan programada', 'billing.cancel': 'Suscripción cancelada',
  'billing.card_updated': 'Tarjeta actualizada', 'billing.card_rejected': 'Tarjeta rechazada', 'billing.payment_succeeded': 'Cobro exitoso', 'billing.payment_failed': 'Cobro fallido',
  'billing.charge_failed': 'Cobro fallido', 'billing.refund': 'Reembolso', 'billing.plan_interest': 'Interés en un plan',
};
export const auditLabel = (a: string): string => AUDIT_LABEL[a] ?? a;

export const CATEGORY_LABEL: Record<string, string> = { auth: 'Accesos', billing: 'Cobros', platform: 'Plataforma' };
/** Familia del evento («billing.refund» → «billing») y su tono, para ubicarlo de un vistazo (siempre va con el texto). */
export const categoryOf = (a: string): string => a.split('.')[0];
export const ACTIVITY_TONE: Record<string, Tone> = { auth: 'neutral', billing: 'info', platform: 'warning' };

/** Apariencia de Taiga para cada tono. El color siempre va acompañado de texto (no se depende solo del color). */
export const TONE_APPEARANCE: Record<Tone, string> = { positive: 'positive', info: 'info', warning: 'warning', negative: 'negative', neutral: 'neutral' };

export const mxn = (n: number): string => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);
export const pct = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 100) : 0);
export const delta = (now: number, before: number): string => {
  if (before === 0) return now === 0 ? 'sin cambio' : `+${now} vs. 30 días previos`;
  const d = Math.round(((now - before) / before) * 100);
  return `${d > 0 ? '+' : ''}${d}% vs. 30 días previos`;
};

export const fd = (v: string | null | undefined): string => formatDate(v);
export const fdt = (v: string | null | undefined): string => formatDateTime(v);
export const nf = (n: number): string => n.toLocaleString('es-MX');

/** Color de cada tono como superficie (pastel con significado) para puntos y barras. */
export const TONE_VAR: Record<Tone, string> = {
  positive: 'var(--nutri-salvia)', info: 'var(--nutri-cielo)', warning: 'var(--nutri-mantequilla)', negative: 'var(--nutri-rosa)',
  neutral: 'color-mix(in srgb, var(--nutri-texto) 22%, var(--surface))',
};

/** «en 3 días», «mañana», «hoy», «venció hace 2 días». Más allá de dos meses solo la fecha. */
export function when(iso: string | null | undefined, now = Date.now()): { text: string; urgent: boolean } {
  if (!iso) return { text: '—', urgent: false };
  const days = Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
  if (days < 0) return { text: `venció hace ${-days} día${days === -1 ? '' : 's'}`, urgent: true };
  if (days === 0) return { text: 'hoy', urgent: true };
  if (days === 1) return { text: 'mañana', urgent: true };
  if (days <= 60) return { text: `en ${days} días`, urgent: days <= 3 };
  return { text: formatDate(iso), urgent: false };
}
