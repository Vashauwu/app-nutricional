import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiClient } from './api-client';

export type PlanCode = 'free' | 'standard' | 'pro';
export type SubState = 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

/** Funciones que cambian según el plan. */
export interface Perks { platformMark: boolean; allHandoutStyles: boolean; customAccent: boolean }
export type BillingPeriod = 'monthly' | 'annual';

export interface PlanInfo {
  code: PlanCode;
  name: string;
  tagline: string;
  monthlyMxn: number;
  annualMxn: number;
  features: string[];
  /** -1 = sin tope. */
  activePatients: number;
  storageBytes: number;
  trackingPhotos: boolean;
  perks: Perks;
}

export interface BillingSummary {
  /** Plan efectivo (el que valida límites). */
  plan: PlanInfo;
  /** Plan contratado, aunque ya no esté vigente. */
  contracted: PlanInfo;
  period: BillingPeriod | null;
  state: SubState;
  /** Fin de la prueba, la gracia o el periodo pagado. */
  endsAt: Date | null;
  downgraded: boolean;
  comped: boolean;
  compReason: string;
  cancelAtPeriodEnd: boolean;
  pendingPlan: PlanCode | null;
  usage: { activePatients: number; storageBytes: number };
  catalog: PlanInfo[];
}

interface ApiPlan {
  code: PlanCode; name: string; tagline: string; monthly_mxn: number; annual_mxn: number; features: string[];
  limits: { active_patients: number; storage_bytes: number; tracking_photos: boolean };
  perks: { platform_mark: boolean; all_handout_styles: boolean; custom_accent: boolean };
}
interface ApiSummary {
  plan: ApiPlan; contracted: ApiPlan; billing_period: string; state: SubState; ends_at: string | null; downgraded: boolean; comped: boolean;
  comp_reason?: string; cancel_at_period_end: boolean; pending_plan?: PlanCode; usage: { active_patients: number; storage_bytes: number }; catalog: ApiPlan[];
}

const mapPlan = (p: ApiPlan): PlanInfo => ({
  code: p.code, name: p.name, tagline: p.tagline, monthlyMxn: p.monthly_mxn, annualMxn: p.annual_mxn, features: p.features,
  activePatients: p.limits.active_patients, storageBytes: p.limits.storage_bytes, trackingPhotos: p.limits.tracking_photos,
  perks: { platformMark: p.perks.platform_mark, allHandoutStyles: p.perks.all_handout_styles, customAccent: p.perks.custom_accent },
});

@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly api = inject(ApiClient);

  summary(): Observable<BillingSummary> {
    return this.api.get<ApiSummary>('/billing').pipe(
      map((s) => ({
        plan: mapPlan(s.plan), contracted: mapPlan(s.contracted), period: (s.billing_period || null) as BillingPeriod | null, state: s.state,
        endsAt: s.ends_at ? new Date(s.ends_at) : null, downgraded: s.downgraded, comped: s.comped, compReason: s.comp_reason ?? '',
        cancelAtPeriodEnd: s.cancel_at_period_end, pendingPlan: s.pending_plan ?? null,
        usage: { activePatients: s.usage.active_patients, storageBytes: s.usage.storage_bytes }, catalog: s.catalog.map(mapPlan),
      })),
    );
  }

  /** Registra el interés en un plan de pago (el cobro en línea aún no está disponible). */
  interest(plan: PlanCode, period: BillingPeriod): Observable<void> {
    return this.api.post('/billing/interest', { plan, period });
  }
}
