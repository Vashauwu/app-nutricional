import { formatDate, formatDateTime } from '../../shared/utils/format';
import { PlanCode, SubState, ActionKind, ActionStatus, PaymentRow } from '../../core/api/platform-api';

/** Textos y colores de cada estado: un solo lugar para que todas las pantallas del panel hablen igual. */
export type Tone = 'positive' | 'info' | 'warning' | 'negative' | 'neutral';

export const STATE_LABEL: Record<SubState, string> = { free: 'Gratuita', trialing: 'En prueba', active: 'Activa', past_due: 'Cobro fallido', canceled: 'Cancelada', expired: 'Vencida' };
export const STATE_TONE: Record<SubState, Tone> = { free: 'neutral', trialing: 'info', active: 'positive', past_due: 'negative', canceled: 'warning', expired: 'warning' };
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
  'platform.action_failed': 'La solicitud falló al ejecutarse',
};

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
