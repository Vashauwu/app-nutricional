import {
  AlertLevel,
  Dish,
  Id,
  MealPlan,
  NutriAlert,
  Patient,
  PlanDay,
  Settings,
} from '../../shared/models/domain';
import { normalizeText } from '../../shared/utils/format';
import { DishLookup, compareEquivalents, compareMacros, dayTotals } from './engine';

/**
 * Alertas nutricionales (§14). Apoyan la revisión profesional; nunca bloquean la
 * publicación. Cada alerta explica el motivo y el dato que la originó.
 */
export interface AlertContext {
  patient: Patient;
  plan: MealPlan;
  settings: Settings;
  dishes: Dish[];
  lookup: DishLookup;
  subgroupName: (code: string) => string;
  /** Si se indica, solo se evalúan esos días. */
  days?: PlanDay[];
}

const LEVEL_RANK: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };

export const sortAlerts = (list: NutriAlert[]): NutriAlert[] =>
  [...list].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || (a.date ?? '').localeCompare(b.date ?? ''));

function matches(haystack: string[], needle: string): boolean {
  const n = normalizeText(needle);
  if (n.length < 3) return false;
  return haystack.some((h) => normalizeText(h).includes(n));
}

export function evaluatePlanAlerts(ctx: AlertContext): NutriAlert[] {
  const { patient, plan, settings, lookup } = ctx;
  const out: NutriAlert[] = [];
  const seen = new Set<string>();
  const push = (a: NutriAlert): void => {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  };
  const allergies = patient.allergies.filter((a) => a.status === 'active');
  const avoid = patient.preferences.filter((p) => p.type === 'avoid' || p.type === 'restriction');
  const rules = settings.alerts.clinicalRules.filter((r) => r.enabled);
  const indications = normalizeText(
    [patient.clinicalIndications, ...patient.conditions.filter((c) => c.status === 'active').map((c) => `${c.name} ${c.details}`)].join(' '),
  );
  const tol = {
    energyPct: settings.alerts.energyTolerancePct,
    macroPct: settings.alerts.macroTolerancePct,
    equivalent: settings.alerts.equivalentTolerance,
  };

  for (const day of ctx.days ?? plan.days) {
    for (const slot of day.slots) {
      for (const item of slot.items) {
        const v = lookup(item.dishId, item.dishVersion);
        const dish = ctx.dishes.find((d) => d.id === item.dishId);
        if (!v || !dish) continue;
        const words = [dish.name, ...dish.tags, ...v.ingredients.map((i) => i.nameSnapshot)];
        const where = `${dish.name} · ${slot.name}`;
        for (const a of allergies) {
          const terms = [a.allergen, ...a.aliases];
          const hit = terms.find((t) => matches(words, t));
          if (hit) {
            push({
              id: `allergy:${plan.id}:${day.date}:${slot.id}:${item.id}:${a.id}`,
              level: 'critical',
              kind: 'allergy',
              title: `Posible alérgeno: ${a.allergen}`,
              reason: `"${where}" contiene o menciona "${hit}", registrado como alergia (${a.severity === 'severe' ? 'severa' : a.severity === 'moderate' ? 'moderada' : 'leve'}).`,
              source: `Alergia registrada: ${a.allergen}${a.reaction ? ` — ${a.reaction}` : ''}`,
              patientId: patient.id,
              planId: plan.id,
              date: day.date,
              slotName: slot.name,
            });
          }
        }
        for (const p of avoid) {
          if (matches(words, p.foodName)) {
            push({
              id: `avoid:${plan.id}:${day.date}:${slot.id}:${item.id}:${p.id}`,
              level: 'warning',
              kind: 'restriction',
              title: `${p.type === 'avoid' ? 'Alimento que no consume' : 'Restricción'}: ${p.foodName}`,
              reason: `"${where}" incluye "${p.foodName}".`,
              source: `Preferencia registrada${p.notes ? `: ${p.notes}` : ''}`,
              patientId: patient.id,
              planId: plan.id,
              date: day.date,
              slotName: slot.name,
            });
          }
        }
        for (const r of rules) {
          const trigger = r.triggers.find((t) => matches(words, t));
          if (trigger && indications.includes(normalizeText(r.keyword))) {
            push({
              id: `clin:${plan.id}:${day.date}:${slot.id}:${item.id}:${r.id}`,
              level: r.level,
              kind: 'clinical',
              title: r.message,
              reason: `"${where}" menciona "${trigger}" y podría entrar en conflicto con la indicación clínica "${r.keyword}".`,
              source: 'Regla clínica configurable (validada por la nutrióloga)',
              patientId: patient.id,
              planId: plan.id,
              date: day.date,
              slotName: slot.name,
            });
          }
        }
      }
    }
    // Desviaciones respecto de objetivos
    const hasItems = day.slots.some((s) => s.items.length);
    if (hasItems) {
      const totals = dayTotals(day, lookup);
      for (const m of compareMacros(totals, plan.targets, tol)) {
        if (m.status === 'ok' || m.status === 'none') continue;
        const limit = m.key === 'energy' ? tol.energyPct : tol.macroPct;
        const level: AlertLevel = Math.abs(m.pct) > limit * 2 ? 'critical' : 'warning';
        push({
          id: `dev:${plan.id}:${day.date}:${m.key}`,
          level,
          kind: m.key === 'energy' ? 'energy' : 'macro',
          title: `${m.label} ${m.status === 'over' ? 'por encima' : 'por debajo'} del objetivo`,
          reason: `El día suma ${Number(m.planned).toFixed(0)} ${m.unit} frente a un objetivo de ${Number(m.target).toFixed(0)} ${m.unit} (${m.pct > 0 ? '+' : ''}${m.pct.toFixed(1)} %; tolerancia ±${limit} %).`,
          source: 'Objetivos diarios del plan',
          patientId: patient.id,
          planId: plan.id,
          date: day.date,
        });
      }
      for (const m of compareEquivalents(totals, plan.targets, ctx.subgroupName, tol)) {
        if (m.status === 'ok' || m.status === 'none') continue;
        push({
          id: `eq:${plan.id}:${day.date}:${m.key}`,
          level: 'info',
          kind: 'equivalent',
          title: `${m.label}: ${m.status === 'over' ? 'excede' : 'faltan'} equivalentes`,
          reason: `Planeado ${Number(m.planned).toFixed(1)} eq. frente a ${Number(m.target).toFixed(1)} eq. de objetivo.`,
          source: 'Objetivos de equivalentes del plan',
          patientId: patient.id,
          planId: plan.id,
          date: day.date,
        });
      }
    }
  }
  return sortAlerts(out);
}
