import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, of, tap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiAlert, mapAlert } from '../api/plans-api';
import { ApiEntry, mapEntry } from '../api/tracking-api';
import { DbService } from '../data/db.service';
import { IsoDate, MealPlan, NutriAlert, Patient, TrackingEntry } from '../../shared/models/domain';
import { PlansService } from './plans.service';
import { PatientsService } from './patients.service';
import { ComplianceResult, computeCompliance } from './tracking.service';
import { addDays, diffDays, startOfWeek, todayIso } from '../../shared/utils/format';
import { add, dec } from '../../shared/utils/decimal';
import { itemTotals, latestMeasurement } from '../nutrition/engine';

export interface DayPoint {
  date: IsoDate;
  planned: number;
  done: number;
  plannedKcal: number;
  recordedKcal: number;
}

export interface GoalProgress {
  label: string;
  detail: string;
  pct: number | null;
}

interface ApiDashboard {
  patients: { total: number; active: number; invited: number; consent_pending: number };
  plans: { draft: number; published: number; finished: number; archived: number; ending_soon: { id: string; name: string; patient_id: string; patient_name: string; end_date: string }[] | null };
  compliance: { pct: number | null; per_patient: { patient_id: string; patient_name: string; planned: number; done: number; skipped: number; pct: number | null }[] | null };
  alerts: { critical: number; warning: number; info: number; items: ApiAlert[] | null };
  activity: ApiEntry[] | null;
  to_review: number;
}

const EMPTY_DASHBOARD = {
  patients: { total: 0, active: 0, invited: 0, consentPending: 0 },
  plans: { draft: 0, published: 0, finished: 0, archived: 0, endingSoon: [] as MealPlan[] },
  compliance: { pct: null as number | null, perPatient: [] as { patient: Patient; name: string; result: ComplianceResult }[] },
  alerts: { all: [] as NutriAlert[], critical: [] as NutriAlert[], warning: [] as NutriAlert[] },
  activity: [] as TrackingEntry[],
  toReview: 0,
};
type DashboardView = typeof EMPTY_DASHBOARD;

@Injectable({ providedIn: 'root' })
export class InsightsService {
  private readonly data = inject(DbService);
  private readonly remote = inject(ApiClient);
  readonly apiMode = this.remote.enabled;
  private readonly apiDash = signal<DashboardView>(EMPTY_DASHBOARD);

  /** Modo API: pide el tablero al servidor (los cálculos, incluidas las alertas, son suyos). */
  loadDashboard(): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.remote.get<ApiDashboard>('/dashboard').pipe(
      tap((r) => {
        const names: Record<string, string> = {};
        const shell = (id: string, name: string): Patient => {
          names[id] = name;
          const [first, ...rest] = name.split(' ');
          return { id, status: 'active', profile: { firstName: first, lastName: rest.join(' '), birthDate: '', sex: 'F', email: '', phone: '' }, goal: 'maintenance', goalNotes: '', clinicalIndications: '', measurementsVisibleToPatient: false, usedBytes: 0, conditions: [], allergies: [], medications: [], preferences: [], notes: [], documents: [], measurements: [], createdAt: '', createdBy: '' };
        };
        const alerts = (r.alerts.items ?? []).map(mapAlert);
        const act = (r.activity ?? []).map((e) => { if (e.patient_name) names[e.patient_id] = e.patient_name; return mapEntry(e); });
        this.data.rememberNames(names);
        this.apiDash.set({
          patients: { total: r.patients.total, active: r.patients.active, invited: r.patients.invited, consentPending: r.patients.consent_pending },
          plans: {
            draft: r.plans.draft, published: r.plans.published, finished: r.plans.finished, archived: r.plans.archived,
            endingSoon: (r.plans.ending_soon ?? []).map((p) => ({ id: p.id, patientId: p.patient_id, name: p.name, status: 'published', startDate: '', endDate: p.end_date.slice(0, 10), revision: 1, updatedAt: '', updatedBy: '', createdAt: '', createdBy: '', targets: { energy: '0', protein: '0', carbs: '0', lipids: '0', equivalents: {}, version: 1 }, days: [], publications: [], history: [] })),
          },
          compliance: {
            pct: r.compliance.pct,
            perPatient: (r.compliance.per_patient ?? []).map((p) => ({ patient: shell(p.patient_id, p.patient_name), name: p.patient_name, result: { planned: p.planned, done: p.done, skipped: p.skipped, pending: p.planned - p.done - p.skipped, pct: p.pct } })).sort((a, b) => (a.result.pct ?? 0) - (b.result.pct ?? 0)),
          },
          alerts: { all: alerts, critical: alerts.filter((a) => a.level === 'critical'), warning: alerts.filter((a) => a.level === 'warning') },
          activity: act,
          toReview: r.to_review,
        });
      }),
      map(() => void 0),
    );
  }
  private readonly plans = inject(PlansService);
  private readonly patients = inject(PatientsService);

  /** Resumen del dashboard (§13). Cada cifra enlaza al registro que la origina. */
  dashboard(): DashboardView {
    if (this.apiMode) return this.apiDash();
    const d = this.data.db();
    const today = todayIso();
    const active = d.patients.filter((p) => !p.deletedAt);
    const plans = d.plans.filter((p) => !p.deletedAt);
    const weekStart = addDays(today, -6);
    const perPatient = active
      .map((p) => ({
        patient: p,
        name: this.patients.fullName(p),
        result: computeCompliance(plans.filter((x) => x.patientId === p.id), d.tracking.filter((t) => t.patientId === p.id), weekStart, today),
      }))
      .filter((r) => r.result.planned > 0);
    const totalPlanned = perPatient.reduce((a, r) => a + r.result.planned, 0);
    const totalDone = perPatient.reduce((a, r) => a + r.result.done, 0);
    const alerts = this.plans.allAlerts();
    const activity = [...d.tracking]
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, 8);
    return {
      patients: {
        total: active.length,
        active: active.filter((p) => p.status === 'active').length,
        invited: active.filter((p) => p.status === 'invited').length,
        consentPending: active.filter((p) => !this.patients.consentComplete(p.id)).length,
      },
      plans: {
        draft: plans.filter((p) => p.status === 'draft').length,
        published: plans.filter((p) => p.status === 'published').length,
        finished: plans.filter((p) => p.status === 'finished').length,
        archived: plans.filter((p) => p.status === 'archived').length,
        endingSoon: plans.filter((p) => p.status === 'published' && p.endDate >= today && diffDays(p.endDate, today) <= 3),
      },
      compliance: { pct: totalPlanned ? Math.round((totalDone / totalPlanned) * 100) : null, perPatient: perPatient.sort((a, b) => (a.result.pct ?? 0) - (b.result.pct ?? 0)) },
      alerts: { all: alerts, critical: alerts.filter((a) => a.level === 'critical'), warning: alerts.filter((a) => a.level === 'warning') },
      activity,
      toReview: d.tracking.filter((t) => t.needsReview).length,
    };
  }

  // ---------- Reportes (§15.1) ----------
  anthropometrics(patient: Patient) {
    const list = [...patient.measurements].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
    const series = (get: (m: Patient['measurements'][number]) => string | undefined) =>
      list.filter((m) => get(m) !== undefined).map((m) => ({ date: m.measuredAt, value: Number(get(m)) }));
    return {
      weight: series((m) => m.weightKg),
      bmi: series((m) => m.bmi),
      waist: series((m) => m.waistCm),
      hip: series((m) => m.hipCm),
      fat: series((m) => m.bodyFatPct),
      first: list[0],
      last: list[list.length - 1],
    };
  }

  /** Día a día: comidas planeadas/realizadas y energía planeada frente a registrada. */
  dailySeries(patientId: string, from: IsoDate, to: IsoDate): DayPoint[] {
    const d = this.data.db();
    const plans = d.plans.filter((p) => p.patientId === patientId && !p.deletedAt && p.status !== 'draft');
    const tracking = new Map(d.tracking.filter((t) => t.patientId === patientId).map((t) => [`${t.planId}:${t.itemId}`, t]));
    const today = todayIso();
    const out: DayPoint[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      let planned = 0;
      let done = 0;
      let plannedKcal = dec('0');
      let recordedKcal = dec('0');
      for (const p of plans) {
        const pd = p.days.find((x) => x.date === day);
        if (!pd) continue;
        for (const s of pd.slots) {
          for (const it of s.items) {
            const kcal = itemTotals(this.data.dishVersion(it.dishId, it.dishVersion), it.servings).nutrients.energy;
            planned++;
            plannedKcal = add(plannedKcal, kcal);
            if (tracking.get(`${p.id}:${it.id}`)?.status === 'done' && day <= today) {
              done++;
              recordedKcal = add(recordedKcal, kcal);
            }
          }
        }
      }
      out.push({ date: day, planned, done, plannedKcal: Number(plannedKcal.toFixed(0)), recordedKcal: Number(recordedKcal.toFixed(0)) });
    }
    return out;
  }

  weeklyCompliance(patientId: string, weeks: number): { label: string; result: ComplianceResult }[] {
    const d = this.data.db();
    const plans = d.plans.filter((p) => p.patientId === patientId && !p.deletedAt);
    const tr = d.tracking.filter((t) => t.patientId === patientId);
    const start = startOfWeek(todayIso());
    return Array.from({ length: weeks }, (_, i) => {
      const from = addDays(start, -7 * (weeks - 1 - i));
      return { label: from, result: computeCompliance(plans, tr, from, addDays(from, 6)) };
    });
  }

  compare(patientId: string, a: { from: IsoDate; to: IsoDate }, b: { from: IsoDate; to: IsoDate }) {
    const d = this.data.db();
    const plans = d.plans.filter((p) => p.patientId === patientId && !p.deletedAt);
    const tr = d.tracking.filter((t) => t.patientId === patientId);
    const p = this.data.patient(patientId);
    const weightAt = (to: IsoDate): string | undefined => {
      const ms = (p?.measurements ?? []).filter((m) => m.measuredAt <= to);
      return latestMeasurement(ms)?.weightKg;
    };
    return {
      a: { range: a, compliance: computeCompliance(plans, tr, a.from, a.to), weight: weightAt(a.to) },
      b: { range: b, compliance: computeCompliance(plans, tr, b.from, b.to), weight: weightAt(b.to) },
    };
  }

  /** Avance hacia el objetivo con base en mediciones; orientativo, no clínico. */
  goalProgress(patient: Patient): GoalProgress {
    const m = [...patient.measurements].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
    if (m.length < 2) return { label: 'Aún sin suficientes mediciones', detail: 'Se necesitan al menos dos mediciones para estimar el avance.', pct: null };
    const first = Number(m[0].weightKg);
    const last = Number(m[m.length - 1].weightKg);
    const delta = last - first;
    if (patient.goal === 'weight_loss') return { label: 'Pérdida de peso', detail: `${delta.toFixed(1)} kg desde la primera medición`, pct: Math.max(0, Math.min(100, Math.round((-delta / 6) * 100))) };
    if (patient.goal === 'muscle_gain') return { label: 'Ganancia muscular', detail: `${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg desde la primera medición`, pct: Math.max(0, Math.min(100, Math.round((delta / 4) * 100))) };
    return { label: 'Mantenimiento', detail: `Variación de ${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg`, pct: Math.max(0, 100 - Math.round(Math.abs(delta) * 20)) };
  }

  planOfEntry = (e: TrackingEntry): MealPlan | undefined => this.data.db().plans.find((p) => p.id === e.planId);
}
