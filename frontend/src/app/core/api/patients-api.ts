import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap, tap } from 'rxjs';
import {
  Allergy, Condition, ConsentAcceptance, ConsentDocument, FoodPreference, Goal, Medication, Patient, PatientDocument, PatientNote, PatientProfile, PatientStatus, Sex,
} from '../../shared/models/domain';
import { Page } from '../../shared/utils/loadable';
import { DbService } from '../data/db.service';
import { ApiClient } from './api-client';
import { ApiMeasurement, MeasurementInput, measurementBody, toMeasurement } from './measurement-map';

// ---------- Formas de la API (backend/internal/patients) ----------
export interface ApiPatient {
  id: string; user_id: string | null; status: PatientStatus; first_name: string; last_name: string; birth_date: string; sex: Sex; email: string; phone: string;
  goal: Goal; goal_notes: string; clinical_indications: string; measurements_visible: boolean; quota_override_bytes: number | null;
  created_at: string; updated_at: string; deleted_at: string | null; consent_complete?: boolean;
}
interface ApiClinical {
  conditions: { id: string; name: string; details: string; status: Condition['status'] }[];
  allergies: { id: string; allergen: string; aliases: string[] | null; reaction: string; severity: Allergy['severity']; status: Allergy['status'] }[];
  medications: { id: string; name: string; dose: string; frequency: string; kind?: string; start_date: string | null; end_date: string | null; status: Medication['status'] }[];
  preferences: { id: string; food_name: string; preference_type: FoodPreference['type']; notes: string }[];
}
interface ApiDocument { id: string; name: string; category: PatientDocument['category']; description: string; document_date: string; visible_to_patient: boolean; scan_status: string; size_bytes: number; uploaded_at: string; url: string }
interface ApiNote { id: string; body: string; created_at: string }
interface ApiAcceptance { id: string; document_id: string; accepted_at: string; method: 'web_checkbox' | 'in_person'; revoked_at: string | null; document_type: 'privacy' | 'informed'; version: number; title: string }
interface ApiConsentDoc { id: string; document_type: 'privacy' | 'informed'; version: number; title: string; content: string; published_at: string; is_active: boolean }

export function mapPatient(d: ApiPatient, prev?: Patient): Patient {
  const profile: PatientProfile = { firstName: d.first_name, lastName: d.last_name, birthDate: d.birth_date, sex: d.sex, email: d.email, phone: d.phone };
  return {
    id: d.id, userId: d.user_id ?? undefined, status: d.status, profile, goal: d.goal, goalNotes: d.goal_notes, clinicalIndications: d.clinical_indications,
    measurementsVisibleToPatient: d.measurements_visible, quotaOverrideBytes: d.quota_override_bytes ?? undefined, usedBytes: prev?.usedBytes ?? 0,
    conditions: prev?.conditions ?? [], allergies: prev?.allergies ?? [], medications: prev?.medications ?? [], preferences: prev?.preferences ?? [],
    notes: prev?.notes ?? [], documents: prev?.documents ?? [], measurements: prev?.measurements ?? [],
    createdAt: d.created_at, createdBy: prev?.createdBy ?? '', deletedAt: d.deleted_at ?? undefined, consentComplete: d.consent_complete,
  };
}

const opt = (v: string | null | undefined): string | undefined => (v ? v : undefined);

/**
 * Traduce la API de pacientes al modelo del cliente. Los datos cargados se guardan en
 * DbService (solo en memoria en modo API) para que las pantallas no cambien.
 */
@Injectable({ providedIn: 'root' })
export class PatientsApi {
  private readonly api = inject(ApiClient);
  private readonly data = inject(DbService);

  list(q: { search: string; status: string; goal: string; page: number; pageSize: number }): Observable<Page<Patient>> {
    return this.api
      .get<{ items: ApiPatient[]; total: number; page: number; page_size: number }>('/patients', {
        search: q.search, status: q.status, goal: q.goal, page: q.page, page_size: q.pageSize,
      })
      .pipe(map((r) => ({ items: r.items.map((p) => mapPatient(p)), total: r.total, page: r.page, pageSize: r.page_size })));
  }

  /** Mete a todos los pacientes (resumen) en DbService para selectores; no pisa expedientes ya cargados. */
  loadAll(): Observable<void> {
    return this.list({ search: '', status: '', goal: '', page: 1, pageSize: 100 }).pipe(
      tap((page) =>
        this.data.mutate((d) => {
          for (const p of page.items) {
            const at = d.patients.findIndex((x) => x.id === p.id);
            if (at < 0) d.patients.push(p);
            else d.patients[at] = { ...p, conditions: d.patients[at].conditions, allergies: d.patients[at].allergies, medications: d.patients[at].medications, preferences: d.patients[at].preferences, notes: d.patients[at].notes, measurements: d.patients[at].measurements };
          }
        }),
      ),
      map(() => void 0),
    );
  }

  /** Carga el expediente completo (el clínico solo si el consentimiento está completo). */
  load(id: string): Observable<void> {
    return forkJoin({ p: this.api.get<ApiPatient>(`/patients/${id}`), docs: this.api.get<{ items: ApiConsentDoc[] }>('/consent-documents') }).pipe(
      switchMap(({ p, docs }) => {
        const unlocked = !!p.consent_complete;
        return forkJoin({
          clinical: unlocked ? this.api.get<ApiClinical>(`/patients/${id}/clinical`) : of(null),
          measurements: unlocked ? this.api.get<{ items: ApiMeasurement[] }>(`/patients/${id}/measurements`) : of(null),
          notes: unlocked ? this.api.get<{ items: ApiNote[] }>(`/patients/${id}/notes`) : of(null),
          consents: this.api.get<{ acceptances: ApiAcceptance[] }>(`/patients/${id}/consents`),
        }).pipe(map((r) => ({ p, docs: docs.items, ...r })));
      }),
      tap((r) => {
        this.data.mutate((d) => {
          const prev = d.patients.find((x) => x.id === id);
          const patient = mapPatient(r.p, prev);
          if (r.clinical) {
            patient.conditions = (r.clinical.conditions ?? []).map((c) => ({ id: c.id, name: c.name, details: c.details, status: c.status }));
            patient.allergies = (r.clinical.allergies ?? []).map((a) => ({ id: a.id, allergen: a.allergen, aliases: a.aliases ?? [], reaction: a.reaction, severity: a.severity, status: a.status }));
            patient.medications = (r.clinical.medications ?? []).map((m) => ({ id: m.id, name: m.name, dose: m.dose, frequency: m.frequency, kind: opt(m.kind), startDate: opt(m.start_date), endDate: opt(m.end_date), status: m.status }));
            patient.preferences = (r.clinical.preferences ?? []).map((f) => ({ id: f.id, foodName: f.food_name, type: f.preference_type, notes: f.notes }));
          } else {
            patient.conditions = patient.allergies = patient.medications = patient.preferences = [];
          }
          patient.measurements = (r.measurements?.items ?? []).map(
            toMeasurement,
          );
          patient.notes = (r.notes?.items ?? []).map((n): PatientNote => ({ id: n.id, body: n.body, createdAt: n.created_at, authorName: '' }));
          const at = d.patients.findIndex((x) => x.id === id);
          if (at >= 0) d.patients[at] = patient;
          else d.patients.push(patient);

          // Documentos legales: vigentes + los que aparecen en el historial de aceptaciones.
          const docsById = new Map<string, ConsentDocument>();
          for (const x of r.docs) docsById.set(x.id, { id: x.id, type: x.document_type, version: x.version, title: x.title, content: x.content, publishedAt: x.published_at, isActive: true });
          for (const a of r.consents.acceptances ?? []) {
            if (!docsById.has(a.document_id)) docsById.set(a.document_id, { id: a.document_id, type: a.document_type, version: a.version, title: a.title, content: '', publishedAt: a.accepted_at, isActive: false });
          }
          d.consentDocuments = [...docsById.values()];
          d.consentAcceptances = [
            ...d.consentAcceptances.filter((a) => a.patientId !== id),
            ...(r.consents.acceptances ?? []).map(
              (a): ConsentAcceptance => ({
                id: a.id, patientId: id, consentDocumentId: a.document_id, acceptedAt: a.accepted_at, method: a.method,
                evidence: { userAgent: '', recordedBy: a.method === 'in_person' ? 'Nutrióloga' : 'paciente' }, revokedAt: opt(a.revoked_at),
              }),
            ),
          ];
        });
      }),
      map(() => void 0),
    );
  }

  /** Devuelve el id y, si el servidor no tiene correo configurado, el enlace de invitación para compartir. */
  create(p: PatientProfile, goal: Goal, invite: boolean): Observable<{ id: string; inviteLink?: string }> {
    return this.api
      .post<ApiPatient & { invite_link?: string }>('/patients', { first_name: p.firstName, last_name: p.lastName, birth_date: p.birthDate, sex: p.sex, email: p.email, phone: p.phone, goal, invite })
      .pipe(map((r) => ({ id: r.id, inviteLink: r.invite_link })));
  }

  resend(id: string): Observable<{ emailed: boolean; inviteLink?: string }> {
    return this.api.post<{ emailed: boolean; invite_link?: string }>(`/patients/${id}/invite`).pipe(map((r) => ({ emailed: r.emailed, inviteLink: r.invite_link })));
  }

  update(id: string, patch: Record<string, unknown>): Observable<unknown> {
    return this.api.patch(`/patients/${id}`, patch);
  }

  setActive(id: string, active: boolean): Observable<unknown> {
    return this.api.post(`/patients/${id}/${active ? 'restore' : 'deactivate'}`);
  }

  addMeasurement(id: string, m: MeasurementInput): Observable<unknown> {
    return this.api.post(`/patients/${id}/measurements`, measurementBody(m));
  }

  /** Alta o edición de condiciones, alergias, medicamentos y preferencias. */
  saveItem(id: string, collection: 'conditions' | 'allergies' | 'medications' | 'preferences', itemId: string | undefined, body: unknown): Observable<unknown> {
    return itemId ? this.api.put(`/patients/${id}/${collection}/${itemId}`, body) : this.api.post(`/patients/${id}/${collection}`, body);
  }
  removeItem(id: string, collection: string, itemId: string): Observable<unknown> {
    return this.api.delete(`/patients/${id}/${collection}/${itemId}`);
  }
  addNote(id: string, body: string): Observable<unknown> {
    return this.api.post(`/patients/${id}/notes`, { body });
  }
  deleteNote(id: string, noteId: string): Observable<unknown> {
    return this.api.delete(`/patients/${id}/notes/${noteId}`);
  }
  recordConsent(id: string, docIds: string[]): Observable<unknown> {
    return this.api.post(`/patients/${id}/consents/record`, { document_ids: docIds });
  }
  revokeConsent(id: string, acceptanceId: string): Observable<unknown> {
    return this.api.post(`/patients/${id}/consents/${acceptanceId}/revoke`);
  }
  // ---------- Documentos clínicos (PDF) ----------
  loadDocuments(id: string): Observable<void> {
    return forkJoin({
      docs: this.api.get<{ items: ApiDocument[] | null }>(`/patients/${id}/documents`),
      usage: this.api.get<{ used_bytes: number; quota_bytes: number }>(`/patients/${id}/storage`),
    }).pipe(
      tap(({ docs, usage }) =>
        this.data.mutate((d) => {
          const p = d.patients.find((x) => x.id === id);
          if (!p) return;
          p.usedBytes = usage.used_bytes;
          p.documents = (docs.items ?? []).map((x): PatientDocument => ({
            id: x.id, name: x.name, category: x.category, documentDate: x.document_date, description: x.description, sizeBytes: x.size_bytes, visibleToPatient: x.visible_to_patient,
            uploadedBy: '', uploadedAt: x.uploaded_at, scanStatus: x.scan_status === 'clean' ? 'clean' : 'scanning', url: x.url,
          }));
        }),
      ),
      map(() => void 0),
    );
  }
  uploadDocument(id: string, file: File, meta: { name: string; category: string; documentDate: string; description: string; visibleToPatient: boolean }): Observable<unknown> {
    const f = new FormData();
    f.append('file', file, file.name);
    f.append('name', meta.name);
    f.append('category', meta.category);
    f.append('description', meta.description);
    f.append('document_date', meta.documentDate);
    f.append('visible_to_patient', String(meta.visibleToPatient));
    return this.api.post(`/patients/${id}/documents`, f);
  }
  updateDocument(id: string, docId: string, d: PatientDocument, patch: Partial<PatientDocument>): Observable<unknown> {
    const m = { ...d, ...patch };
    return this.api.put(`/patients/${id}/documents/${docId}`, { name: m.name, category: m.category, description: m.description, document_date: m.documentDate, visible_to_patient: m.visibleToPatient });
  }
  deleteDocument(id: string, docId: string): Observable<unknown> { return this.api.delete(`/patients/${id}/documents/${docId}`); }

  logExport(id: string, kind: 'measurements' | 'report' | 'document'): Observable<unknown> {
    return this.api.post(`/patients/${id}/exports`, { kind });
  }
}
