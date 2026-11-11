import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, of, switchMap, tap } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { PatientsApi } from '../api/patients-api';
import type { MeasurementInput } from '../api/measurement-map';
import { ToastService } from './ui.services';
import { DbService } from '../data/db.service';
import {
  Allergy, COMPOSITION_FIELDS, Condition, ConsentAcceptance, ConsentDocument, DocumentCategory, FoodPreference, Goal, Measurement, Medication,
  Patient, PatientDocument, PatientProfile, PatientStatus,
} from '../../shared/models/domain';
import { Page, paginate } from '../../shared/utils/loadable';
import { ageFrom, normalizeText, uid } from '../../shared/utils/format';
import { computeBmi, latestMeasurement } from '../nutrition/engine';
import { computeCompliance } from './tracking.service';
import { sortAlerts } from '../nutrition/alerts';

export interface PatientQuery {
  search: string;
  status: PatientStatus | '' | 'deleted';
  goal: Goal | '';
  page: number;
  pageSize: number;
}

export interface PatientRow {
  patient: Patient;
  name: string;
  age: number;
  weightKg?: string;
  planName?: string;
  planStatus?: string;
  compliance: number | null;
  consentComplete: boolean;
}

export type { MeasurementInput };

const MB = 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class PatientsService {
  private readonly data = inject(DbService);
  private readonly remote = inject(PatientsApi);
  private readonly toast = inject(ToastService);
  readonly apiMode = inject(ApiClient).enabled;

  /** Modo API: carga el expediente desde el servidor al abrirlo. En modo simulado no hace nada. */
  load(id: string): Observable<void> {
    return this.apiMode ? this.remote.load(id) : of(void 0);
  }

  /** Enlace de invitación del último alta (solo si el servidor no envía correos). */
  readonly inviteLink = signal<string | null>(null);

  /** Reenvía la invitación; si no hay correo configurado devuelve el enlace para compartirlo. */
  resendInvite(id: string): Observable<{ emailed: boolean; inviteLink?: string }> {
    return this.apiMode ? this.remote.resend(id) : of({ emailed: true });
  }

  /** Modo API: trae a todos los pacientes (resumen) para selectores y listas. */
  loadAll(): Observable<void> {
    return this.apiMode ? this.remote.loadAll() : of(void 0);
  }

  /** Ejecuta una operación contra la API y refresca el expediente; los errores se muestran al usuario. */
  private fire(id: string, op: Observable<unknown>): void {
    op.pipe(switchMap(() => this.remote.load(id))).subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') });
  }

  fullName = (p: Patient): string => `${p.profile.firstName} ${p.profile.lastName}`;

  get = (id: string): Patient | undefined => this.data.db().patients.find((p) => p.id === id);

  all(): Patient[] {
    return this.data.db().patients.filter((p) => !p.deletedAt);
  }

  // ---------- Consentimientos (§4.1) ----------
  activeConsents(): ConsentDocument[] {
    return this.data.db().consentDocuments.filter((c) => c.isActive);
  }

  acceptancesOf(patientId: string): ConsentAcceptance[] {
    return this.data.db().consentAcceptances.filter((a) => a.patientId === patientId);
  }

  consentComplete(patientId: string): boolean {
    if (this.apiMode) return this.get(patientId)?.consentComplete ?? false;
    const accepted = new Set(this.acceptancesOf(patientId).filter((a) => !a.revokedAt).map((a) => a.consentDocumentId));
    return this.activeConsents().every((c) => accepted.has(c.id));
  }

  pendingConsentDocs(patientId: string): ConsentDocument[] {
    const accepted = new Set(this.acceptancesOf(patientId).filter((a) => !a.revokedAt).map((a) => a.consentDocumentId));
    return this.activeConsents().filter((c) => !accepted.has(c.id));
  }

  recordInPersonConsent(patientId: string, docIds: string[]): void {
    if (this.apiMode) {
      this.fire(patientId, this.remote.recordConsent(patientId, docIds));
      return;
    }
    this.data.mutate((d) => {
      const now = new Date().toISOString();
      for (const id of docIds) {
        d.consentAcceptances.push({ id: uid('ac'), patientId, consentDocumentId: id, acceptedAt: now, method: 'in_person', evidence: { userAgent: 'Registro presencial', recordedBy: this.data.actor() } });
      }
      this.data.audit(d, 'consent.recorded', 'patient', patientId, 'Registró aceptación presencial de documentos');
    });
  }

  revokeConsent(patientId: string, acceptanceId: string): void {
    if (this.apiMode) {
      this.fire(patientId, this.remote.revokeConsent(patientId, acceptanceId));
      return;
    }
    this.data.mutate((d) => {
      const a = d.consentAcceptances.find((x) => x.id === acceptanceId);
      if (a) a.revokedAt = new Date().toISOString();
      this.data.audit(d, 'consent.revoked', 'patient', patientId, 'Revocó un consentimiento');
    });
  }

  // ---------- Listado con filtros en "backend" (§16) ----------
  list(q: PatientQuery): Observable<Page<PatientRow>> {
    if (this.apiMode) {
      return this.remote.list(q).pipe(
        map((pg) => ({
          ...pg,
          items: pg.items.map((p): PatientRow => ({ patient: p, name: this.fullName(p), age: ageFrom(p.profile.birthDate), compliance: null, consentComplete: !!p.consentComplete })),
        })),
      );
    }
    return this.data.respond(() => {
      const d = this.data.db();
      const term = normalizeText(q.search);
      const rows = d.patients
        .filter((p) => (q.status === 'deleted' ? !!p.deletedAt : !p.deletedAt))
        .filter((p) => (q.status && q.status !== 'deleted' ? p.status === q.status : true))
        .filter((p) => (q.goal ? p.goal === q.goal : true))
        .filter((p) => !term || normalizeText(`${p.profile.firstName} ${p.profile.lastName} ${p.profile.email} ${p.profile.phone}`).includes(term))
        .sort((a, b) => this.fullName(a).localeCompare(this.fullName(b), 'es'))
        .map((p): PatientRow => {
          const plans = d.plans.filter((x) => x.patientId === p.id && !x.deletedAt);
          const current = plans.find((x) => x.status === 'published') ?? plans.find((x) => x.status === 'draft');
          return {
            patient: p,
            name: this.fullName(p),
            age: ageFrom(p.profile.birthDate),
            weightKg: latestMeasurement(p.measurements)?.weightKg,
            planName: current?.name,
            planStatus: current?.status,
            compliance: computeCompliance(plans, d.tracking.filter((t) => t.patientId === p.id)).pct,
            consentComplete: this.consentComplete(p.id),
          };
        });
      return paginate(rows, q.page, q.pageSize);
    });
  }

  // ---------- Alta y edición ----------
  create(profile: PatientProfile, goal: Goal, mode: 'manual' | 'invite'): Observable<string> {
    if (this.apiMode) {
      this.inviteLink.set(null);
      return this.remote.create(profile, goal, mode === 'invite').pipe(
        tap((r) => this.inviteLink.set(r.inviteLink ?? null)),
        map((r) => r.id),
      );
    }
    const id = uid('p-');
    this.data.mutate((d) => {
      d.patients.push({
        id, status: mode === 'invite' ? 'invited' : 'active', profile, goal, goalNotes: '', clinicalIndications: '',
        measurementsVisibleToPatient: true, usedBytes: 0, conditions: [], allergies: [], medications: [], preferences: [],
        notes: [], documents: [], measurements: [], createdAt: new Date().toISOString(), createdBy: this.data.actor(),
      });
      this.data.audit(d, 'patient.create', 'patient', id, `${mode === 'invite' ? 'Invitó a' : 'Registró a'} ${profile.firstName} ${profile.lastName}`);
    });
    return of(id);
  }

  emailInUse(email: string, exceptId?: string): boolean {
    if (this.apiMode) return false; // el servidor valida la unicidad y responde 409
    const e = email.trim().toLowerCase();
    return this.data.db().patients.some((p) => p.id !== exceptId && p.profile.email.toLowerCase() === e);
  }

  update(id: string, patch: Partial<Pick<Patient, 'goal' | 'goalNotes' | 'clinicalIndications' | 'measurementsVisibleToPatient' | 'quotaOverrideBytes'>> & { profile?: Partial<PatientProfile> }): void {
    if (this.apiMode) {
      // Solo se envía lo que cambió: el servidor trata las notas del objetivo y las indicaciones como datos clínicos y
      // los rechaza (423) mientras no haya consentimientos; mandarlos sin cambios bloquearía editar un simple correo.
      const cur = this.get(id);
      const b: Record<string, unknown> = {};
      const set = (k: string, v: unknown, old: unknown): void => { if (v !== undefined && v !== old) b[k] = v; };
      set('goal', patch.goal, cur?.goal); set('goal_notes', patch.goalNotes, cur?.goalNotes); set('clinical_indications', patch.clinicalIndications, cur?.clinicalIndications);
      set('measurements_visible', patch.measurementsVisibleToPatient, cur?.measurementsVisibleToPatient); set('quota_override_bytes', patch.quotaOverrideBytes, cur?.quotaOverrideBytes);
      const pr = patch.profile;
      const cp = cur?.profile;
      if (pr) {
        set('first_name', pr.firstName, cp?.firstName); set('last_name', pr.lastName, cp?.lastName); set('birth_date', pr.birthDate, cp?.birthDate);
        set('sex', pr.sex, cp?.sex); set('email', pr.email, cp?.email); set('phone', pr.phone, cp?.phone);
      }
      this.fire(id, this.remote.update(id, b));
      return;
    }
    this.data.mutate((d) => {
      const p = d.patients.find((x) => x.id === id);
      if (!p) return;
      const { profile, ...rest } = patch;
      Object.assign(p, rest);
      if (profile) Object.assign(p.profile, profile);
      this.data.audit(d, 'patient.update', 'patient', id, `Actualizó el expediente de ${p.profile.firstName}`);
    });
  }

  setActive(id: string, active: boolean): void {
    if (this.apiMode) {
      this.fire(id, this.remote.setActive(id, active));
      return;
    }
    this.data.mutate((d) => {
      const p = d.patients.find((x) => x.id === id);
      if (!p) return;
      p.deletedAt = active ? undefined : new Date().toISOString();
      p.status = active ? (p.userId ? 'active' : 'invited') : 'inactive';
      this.data.audit(d, active ? 'patient.restore' : 'patient.deactivate', 'patient', id, `${active ? 'Restauró' : 'Desactivó'} a ${p.profile.firstName} ${p.profile.lastName}`);
    });
  }

  // ---------- Antropometría append-only (§3.2) ----------
  addMeasurement(id: string, input: MeasurementInput): void {
    if (this.apiMode) {
      this.fire(id, this.remote.addMeasurement(id, input));
      return;
    }
    this.data.mutate((d) => {
      const p = d.patients.find((x) => x.id === id);
      if (!p) return;
      const m: Measurement = {
        id: uid('m'), measuredAt: input.measuredAt, weightKg: input.weightKg, heightCm: input.heightCm,
        bmi: computeBmi(input.weightKg, input.heightCm), waistCm: input.waistCm || undefined, hipCm: input.hipCm || undefined,
        notes: input.notes || undefined, createdBy: this.data.actor(),
      };
      for (const f of COMPOSITION_FIELDS) m[f.key] = input[f.key] || undefined;
      const girths = Object.fromEntries(Object.entries(input.girths ?? {}).filter(([, v]) => v));
      if (Object.keys(girths).length) m.girths = girths;
      p.measurements.push(m);
      this.data.audit(d, 'measurement.create', 'patient', id, `Registró medición del ${input.measuredAt}`);
    });
  }

  // ---------- Colecciones clínicas ----------
  saveCondition(id: string, c: Omit<Condition, 'id'> & { id?: string }): void {
    if (this.apiMode) {
      this.fire(id, this.remote.saveItem(id, 'conditions', c.id, { name: c.name, details: c.details, status: c.status }));
      return;
    }
    this.upsert(id, 'conditions', { ...c, id: c.id ?? uid('c') });
  }
  saveAllergy(id: string, a: Omit<Allergy, 'id'> & { id?: string }): void {
    if (this.apiMode) {
      this.fire(id, this.remote.saveItem(id, 'allergies', a.id, { allergen: a.allergen, aliases: a.aliases, reaction: a.reaction, severity: a.severity, status: a.status }));
      return;
    }
    this.upsert(id, 'allergies', { ...a, id: a.id ?? uid('a') });
  }
  saveMedication(id: string, m: Omit<Medication, 'id'> & { id?: string }): void {
    if (this.apiMode) {
      this.fire(id, this.remote.saveItem(id, 'medications', m.id, { name: m.name, dose: m.dose, frequency: m.frequency, kind: m.kind || '', start_date: m.startDate || undefined, end_date: m.endDate || undefined, status: m.status }));
      return;
    }
    this.upsert(id, 'medications', { ...m, id: m.id ?? uid('md') });
  }
  savePreference(id: string, p: Omit<FoodPreference, 'id'> & { id?: string }): void {
    if (this.apiMode) {
      this.fire(id, this.remote.saveItem(id, 'preferences', p.id, { food_name: p.foodName, preference_type: p.type, notes: p.notes }));
      return;
    }
    this.upsert(id, 'preferences', { ...p, id: p.id ?? uid('pf') });
  }

  private upsert<K extends 'conditions' | 'allergies' | 'medications' | 'preferences'>(patientId: string, key: K, item: Patient[K][number]): void {
    this.data.mutate((d) => {
      const p = d.patients.find((x) => x.id === patientId);
      if (!p) return;
      const list = p[key] as { id: string }[];
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = item;
      else list.push(item);
      this.data.audit(d, `patient.${key}`, 'patient', patientId, `Actualizó ${key === 'conditions' ? 'condiciones' : key === 'allergies' ? 'alergias' : key === 'medications' ? 'medicamentos' : 'preferencias'}`);
    });
  }

  removeItem(patientId: string, key: 'conditions' | 'allergies' | 'medications' | 'preferences', itemId: string): void {
    if (this.apiMode) {
      this.fire(patientId, this.remote.removeItem(patientId, key, itemId));
      return;
    }
    this.data.mutate((d) => {
      const p = d.patients.find((x) => x.id === patientId);
      if (!p) return;
      (p[key] as { id: string }[]) = (p[key] as { id: string }[]).filter((x) => x.id !== itemId);
    });
  }

  // ---------- Notas privadas: nunca visibles al paciente (§2.2) ----------
  addNote(patientId: string, body: string): void {
    if (this.apiMode) {
      this.fire(patientId, this.remote.addNote(patientId, body.trim()));
      return;
    }
    this.data.mutate((d) => {
      d.patients.find((x) => x.id === patientId)?.notes.unshift({ id: uid('n'), body: body.trim(), createdAt: new Date().toISOString(), authorName: this.data.actor() });
    });
  }

  deleteNote(patientId: string, noteId: string): void {
    if (this.apiMode) {
      this.fire(patientId, this.remote.deleteNote(patientId, noteId));
      return;
    }
    this.data.mutate((d) => {
      const n = d.patients.find((x) => x.id === patientId)?.notes.find((x) => x.id === noteId);
      if (n) n.deletedAt = new Date().toISOString();
      this.data.audit(d, 'note.delete', 'patient', patientId, 'Eliminó (lógicamente) una nota');
    });
  }

  // ---------- Documentos y cuotas (§3.3, §18) ----------
  quota(p: Patient): { used: number; quota: number; pct: number; warn: boolean } {
    const quota = p.quotaOverrideBytes ?? this.data.db().settings.storage.defaultQuotaBytes;
    const pct = Math.min(100, Math.round((p.usedBytes / quota) * 100));
    return { used: p.usedBytes, quota, pct, warn: pct >= this.data.db().settings.storage.warnThresholdPct };
  }

  /** Valida y registra el PDF. Devuelve un mensaje de error o null. */
  validateUpload(p: Patient, file: File): string | null {
    const s = this.data.db().settings.storage;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'Solo se aceptan archivos PDF.';
    if (file.size > s.maxPdfBytes) return `El archivo supera el límite de ${(s.maxPdfBytes / MB).toFixed(0)} MB.`;
    const q = this.quota(p);
    if (q.used + file.size > q.quota) return 'La cuota de almacenamiento del paciente no alcanza para este archivo.';
    return null;
  }

  /** Modo API: documentos y cuota de almacenamiento del paciente. */
  loadDocuments(id: string): Observable<void> {
    return this.apiMode ? this.remote.loadDocuments(id) : of(void 0);
  }

  addDocument(p: Patient, file: File, meta: { name: string; category: DocumentCategory; documentDate: string; description: string; visibleToPatient: boolean }): Observable<void> {
    if (this.apiMode) return this.remote.uploadDocument(p.id, file, meta).pipe(switchMap(() => this.remote.loadDocuments(p.id)));
    this.addDocumentLocal(p, file, meta);
    return of(void 0);
  }

  private addDocumentLocal(p: Patient, file: File, meta: { name: string; category: DocumentCategory; documentDate: string; description: string; visibleToPatient: boolean }): string {
    const id = uid('doc');
    this.data.mutate((d) => {
      const pt = d.patients.find((x) => x.id === p.id);
      if (!pt) return;
      pt.documents.unshift({
        id, ...meta, sizeBytes: file.size, uploadedBy: this.data.actor(), uploadedAt: new Date().toISOString(), scanStatus: 'scanning',
      });
      pt.usedBytes += file.size;
      this.data.audit(d, 'document.upload', 'patient_document', id, `Cargó "${meta.name}"`);
    });
    // Análisis de seguridad antes de habilitar la descarga (§18.4).
    setTimeout(() => this.data.mutate((d) => {
      const doc = d.patients.find((x) => x.id === p.id)?.documents.find((x) => x.id === id);
      if (doc) doc.scanStatus = 'clean';
    }), 2200);
    return id;
  }

  updateDocument(patientId: string, docId: string, patch: Partial<Pick<PatientDocument, 'name' | 'category' | 'description' | 'documentDate' | 'visibleToPatient'>>): Observable<void> {
    if (this.apiMode) {
      const cur = this.get(patientId)?.documents.find((x) => x.id === docId);
      if (!cur) return of(void 0);
      return this.remote.updateDocument(patientId, docId, cur, patch).pipe(switchMap(() => this.remote.loadDocuments(patientId)));
    }
    this.updateDocumentLocal(patientId, docId, patch);
    return of(void 0);
  }

  private updateDocumentLocal(patientId: string, docId: string, patch: Partial<Pick<PatientDocument, 'name' | 'category' | 'description' | 'documentDate' | 'visibleToPatient'>>): void {
    this.data.mutate((d) => {
      const doc = d.patients.find((x) => x.id === patientId)?.documents.find((x) => x.id === docId);
      if (!doc) return;
      Object.assign(doc, patch);
      this.data.audit(d, 'document.update', 'patient_document', docId, `Modificó "${doc.name}"`);
    });
  }

  deleteDocument(patientId: string, docId: string): Observable<void> {
    if (this.apiMode) return this.remote.deleteDocument(patientId, docId).pipe(switchMap(() => this.remote.loadDocuments(patientId)));
    this.deleteDocumentLocal(patientId, docId);
    return of(void 0);
  }

  private deleteDocumentLocal(patientId: string, docId: string): void {
    this.data.mutate((d) => {
      const doc = d.patients.find((x) => x.id === patientId)?.documents.find((x) => x.id === docId);
      if (doc) doc.deletedAt = new Date().toISOString();
      this.data.audit(d, 'document.delete', 'patient_document', docId, `Eliminó (lógicamente) "${doc?.name}"`);
    });
  }

  logExport(patientId: string, what: string): void {
    if (this.apiMode) {
      const kind = what.startsWith('mediciones') ? 'measurements' : what.startsWith('reporte') ? 'report' : 'document';
      this.remote.logExport(patientId, kind).subscribe({ error: () => undefined });
      return;
    }
    this.data.mutate((d) => this.data.audit(d, 'export', 'patient', patientId, `Exportó ${what}`));
  }
}

export { sortAlerts };
