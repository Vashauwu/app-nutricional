import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiClient } from './api-client';

export type PlanCode = 'free' | 'standard' | 'pro';
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
}

export interface BillingSummary {
  plan: PlanInfo;
  period: BillingPeriod | null;
  status: string;
  usage: { activePatients: number; storageBytes: number };
  catalog: PlanInfo[];
}

interface ApiPlan {
  code: PlanCode; name: string; tagline: string; monthly_mxn: number; annual_mxn: number; features: string[];
  limits: { active_patients: number; storage_bytes: number; tracking_photos: boolean };
}
interface ApiSummary {
  plan: ApiPlan; billing_period: string; status: string; usage: { active_patients: number; storage_bytes: number }; catalog: ApiPlan[];
}

const mapPlan = (p: ApiPlan): PlanInfo => ({
  code: p.code, name: p.name, tagline: p.tagline, monthlyMxn: p.monthly_mxn, annualMxn: p.annual_mxn, features: p.features,
  activePatients: p.limits.active_patients, storageBytes: p.limits.storage_bytes, trackingPhotos: p.limits.tracking_photos,
});

@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly api = inject(ApiClient);

  summary(): Observable<BillingSummary> {
    return this.api.get<ApiSummary>('/billing').pipe(
      map((s) => ({
        plan: mapPlan(s.plan), period: (s.billing_period || null) as BillingPeriod | null, status: s.status,
        usage: { activePatients: s.usage.active_patients, storageBytes: s.usage.storage_bytes }, catalog: s.catalog.map(mapPlan),
      })),
    );
  }

  /** Registra el interés en un plan de pago (el cobro en línea aún no está disponible). */
  interest(plan: PlanCode, period: BillingPeriod): Observable<void> {
    return this.api.post('/billing/interest', { plan, period });
  }
}
