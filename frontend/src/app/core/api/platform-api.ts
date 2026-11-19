import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiClient } from './api-client';
import { LandingContent } from '../../features/landing/landing.content';

// Formas de la API de plataforma (backend/internal/platform). Los importes son MXN enteros.
export type SubState = 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
export type PlanCode = 'free' | 'standard' | 'pro';
export type ActionKind = 'comp_plan' | 'extend_trial' | 'refund';
export type ActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface AccountRow {
  id: string; name: string; status: 'active' | 'suspended'; suspended_reason?: string; created_at: string; owner_email: string;
  plan: PlanCode; state: SubState; effective_plan: PlanCode; ends_at: string | null; comped: boolean; active_patients: number;
}
export interface AccountsPage { items: AccountRow[]; total: number; limit: number; offset: number }

export interface PaymentRow { id: string; status: 'paid' | 'failed' | 'refunded' | 'chargeback'; amount_mxn: number; plan: PlanCode; failure_reason?: string; occurred_at: string }
export interface AuditRow { action: string; actor: string; occurred_at: string; metadata: Record<string, unknown> }
export interface ActionRow {
  id: string; practice_id: string; practice_name?: string; kind: ActionKind; params: { plan?: PlanCode; period?: string; days?: number; payment_id?: string };
  reason: string; status: ActionStatus; requested_by: string; requested_by_email?: string; requested_at: string; decided_at?: string; decided_by_email?: string; decision_note?: string; error?: string;
}
/** -1 = sin tope. */
export interface Limits { active_patients: number; storage_bytes: number; tracking_photos: boolean }
export interface AccountDetail extends AccountRow {
  billing_period?: string; comp_reason?: string; cancel_at_period_end: boolean; trial_used: boolean; provider?: string; card?: string;
  storage_bytes: number; users: number; limits: Limits; payments: PaymentRow[]; audit: AuditRow[]; actions: ActionRow[];
}

/** Equipo del CRM (backend/internal/platform/staff.go). platform_admin es el rol heredado y equivale a dueño. */
export type StaffRole = 'platform_owner' | 'platform_support' | 'platform_viewer' | 'platform_content' | 'platform_admin';
export interface StaffRow { id: string; email: string; name: string; status: 'active' | 'invited' | 'disabled'; role: StaffRole; last_login_at: string | null; created_at: string }
export interface StaffInvite { staff: StaffRow; link?: string; emailed: boolean }

/** Landing gestionada desde el CRM (backend/internal/platform/landing.go). */
export type LandingStatus = 'draft' | 'pending' | 'published' | 'superseded';
export interface LandingVersion {
  id: string; number: number | null; status: LandingStatus; content: LandingContent; base_number: number | null; reason?: string;
  requested_by?: string; requested_at?: string; decided_by?: string; decided_at?: string; decision_note?: string; published_at?: string;
}
export interface LandingState { published: LandingVersion | null; draft: LandingVersion | null }
export interface LandingVersionRow { number: number; status: LandingStatus; reason?: string; requested_by?: string; requested_at?: string; decided_by?: string; decided_at?: string; decision_note?: string; published_at?: string }

export interface DayCount { day: string; total: number }
export interface Overview {
  generated_at: string; accounts: number; suspended: number; comped: number;
  by_state: Partial<Record<SubState, number>>; by_plan: Partial<Record<PlanCode, number>>;
  paying_accounts: number; mrr_mxn: number; mrr_by_plan: Partial<Record<PlanCode, number>>; trials_ending_soon: number; pending_actions: number;
  signups_daily: DayCount[]; signups_30d: number; signups_prev_30d: number;
  payments_30d: { paid_count: number; paid_mxn: number; failed_count: number; returned_mxn: number };
  recent_payments: { id: string; practice_id: string; practice_name: string; status: PaymentRow['status']; amount_mxn: number; plan: PlanCode; occurred_at: string }[];
  attention: { id: string; name: string; owner_email: string; reason: 'past_due' | 'trial_ending'; ends_at: string | null; plan: PlanCode }[];
  usage: { active_patients: number; users: number; storage_bytes: number };
}

export type AccountSort = 'name' | 'plan' | 'patients' | 'created';
export interface AccountQuery { q?: string; plan?: string; status?: string; sort?: AccountSort | ''; dir?: 'asc' | 'desc'; limit?: number; offset?: number }

/** Bitácora global: solo eventos operativos (accesos, cobros y plataforma); los clínicos nunca llegan aquí. */
export type ActivityCategory = '' | 'auth' | 'billing' | 'platform';
export interface ActivityRow { id: string; action: string; occurred_at: string; actor: string; practice_id?: string; practice_name?: string; metadata: Record<string, unknown> }
export interface ActivityPage { items: ActivityRow[]; total: number; limit: number; offset: number }
export interface ActivityQuery { q?: string; category?: ActivityCategory; practice?: string; from?: string; to?: string; limit?: number; offset?: number }

@Injectable({ providedIn: 'root' })
export class PlatformApi {
  private readonly api = inject(ApiClient);
  /** Solicitudes por aprobar: lo comparten el menú y las pantallas para que la cifra no quede vieja. */
  readonly pending = signal(0);
  overview(): Observable<Overview> { return this.api.get<Overview>('/platform/overview').pipe(tap((o) => this.pending.set(o.pending_actions))); }
  accounts(q: AccountQuery): Observable<AccountsPage> { return this.api.get<AccountsPage>('/platform/accounts', { ...q }); }
  account(id: string): Observable<AccountDetail> { return this.api.get<AccountDetail>(`/platform/accounts/${id}`); }
  activity(q: ActivityQuery): Observable<ActivityPage> { return this.api.get<ActivityPage>('/platform/activity', { ...q }); }
  staff(): Observable<{ items: StaffRow[]; roles: StaffRole[] }> { return this.api.get<{ items: StaffRow[]; roles: StaffRole[] }>('/platform/staff'); }
  inviteStaff(email: string, name: string, role: StaffRole): Observable<StaffInvite> { return this.api.post<StaffInvite>('/platform/staff', { email, name, role }); }
  resendStaffInvite(id: string): Observable<StaffInvite> { return this.api.post<StaffInvite>(`/platform/staff/${id}/invite`); }
  setStaffRole(id: string, role: StaffRole): Observable<StaffRow> { return this.api.put<StaffRow>(`/platform/staff/${id}/role`, { role }); }
  setStaffEnabled(id: string, enabled: boolean): Observable<StaffRow> { return this.api.post<StaffRow>(`/platform/staff/${id}/${enabled ? 'enable' : 'disable'}`); }
  landing(): Observable<LandingState> { return this.api.get<LandingState>('/platform/landing'); }
  landingSaveDraft(content: LandingContent): Observable<LandingVersion> { return this.api.put<LandingVersion>('/platform/landing/draft', content); }
  landingRequest(reason: string): Observable<LandingVersion> { return this.api.post<LandingVersion>('/platform/landing/request', { reason }); }
  landingWithdraw(): Observable<LandingVersion> { return this.api.post<LandingVersion>('/platform/landing/withdraw'); }
  landingDecide(approve: boolean, note: string): Observable<LandingState> { return this.api.post<LandingState>('/platform/landing/decision', { approve, note }); }
  landingVersions(): Observable<{ items: LandingVersionRow[] }> { return this.api.get<{ items: LandingVersionRow[] }>('/platform/landing/versions'); }
  landingRestore(n: number): Observable<LandingVersion> { return this.api.post<LandingVersion>(`/platform/landing/versions/${n}/restore`); }
  actions(status = ''): Observable<{ items: ActionRow[] }> { return this.api.get<{ items: ActionRow[] }>('/platform/actions', { status }); }
  suspend(id: string, reason: string): Observable<void> { return this.api.post(`/platform/accounts/${id}/suspend`, { reason }); }
  reactivate(id: string): Observable<void> { return this.api.post(`/platform/accounts/${id}/reactivate`); }
  request(id: string, kind: ActionKind, params: ActionRow['params'], reason: string): Observable<ActionRow> { return this.api.post<ActionRow>(`/platform/accounts/${id}/actions`, { kind, params, reason }); }
  decide(actionId: string, approve: boolean, note: string): Observable<ActionRow> { return this.api.post<ActionRow>(`/platform/actions/${actionId}/decision`, { approve, note }); }
  setPending(n: number): void { this.pending.set(n); }
}
