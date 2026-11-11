import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { SettingsApi } from '../api/settings-api';
import { DbService } from '../data/db.service';
import { BrandSettings, ClinicalRule, ConsentDocument, ConsentType, Settings } from '../../shared/models/domain';
import { uid } from '../../shared/utils/format';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly data = inject(DbService);
  private readonly remote = inject(SettingsApi);
  readonly apiMode = inject(ApiClient).enabled;

  private op(api: () => Observable<unknown>, local: () => void): Observable<void> {
    if (this.apiMode) return new Observable<void>((sub) => api().subscribe({ error: (e) => sub.error(e), complete: () => { sub.next(); sub.complete(); } }));
    local();
    return of(void 0);
  }

  /** Modo API: configuración completa, documentos legales y auditoría (nutrióloga). */
  load(): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return new Observable<void>((sub) => {
      forkJoin([this.remote.load(), this.remote.loadConsents(), this.remote.loadAudit()]).subscribe({ error: (e) => sub.error(e), complete: () => { sub.next(); sub.complete(); } });
    });
  }

  /** Modo API: solo la marca (paciente) o la marca pública (pantalla de ingreso). */
  loadBrand(): Observable<void> { return this.apiMode ? this.remote.loadBrand() : of(void 0); }
  loadPublicBrand(): Observable<void> { return this.apiMode ? this.remote.loadPublicBrand() : of(void 0); }

  get = (): Settings => this.data.db().settings;

  saveBrand(brand: BrandSettings): Observable<void> {
    return this.op(() => this.remote.saveBrand(brand), () => this.saveBrandLocal(brand));
  }

  private saveBrandLocal(brand: BrandSettings): void {
    this.data.mutate((d) => {
      d.settings.brand = brand;
      this.data.audit(d, 'settings.brand', 'settings', 'brand', 'Actualizó la identidad visual');
    });
  }

  saveRegion(region: Settings['region']): Observable<void> {
    return this.op(() => this.remote.saveRegion(region), () => this.saveRegionLocal(region));
  }

  private saveRegionLocal(region: Settings['region']): void {
    this.data.mutate((d) => {
      d.settings.region = region;
      this.data.audit(d, 'settings.region', 'settings', 'region', 'Actualizó la configuración regional');
    });
  }

  saveStorage(storage: Settings['storage']): Observable<void> {
    return this.op(() => this.remote.saveStorage(storage), () => this.saveStorageLocal(storage));
  }

  private saveStorageLocal(storage: Settings['storage']): void {
    this.data.mutate((d) => {
      d.settings.storage = storage;
      this.data.audit(d, 'settings.storage', 'settings', 'storage', 'Actualizó cuotas y límites de carga');
    });
  }

  saveAlertThresholds(p: { energyTolerancePct: number; macroTolerancePct: number; equivalentTolerance: number }): Observable<void> {
    return this.op(() => this.remote.saveAlerts({ ...this.get().alerts, ...p }), () => this.saveThresholdsLocal(p));
  }

  private saveThresholdsLocal(p: { energyTolerancePct: number; macroTolerancePct: number; equivalentTolerance: number }): void {
    this.data.mutate((d) => {
      Object.assign(d.settings.alerts, p);
      this.data.audit(d, 'settings.alerts', 'settings', 'alerts', 'Actualizó los umbrales de alertas');
    });
  }

  saveRule(rule: Omit<ClinicalRule, 'id'> & { id?: string }): Observable<void> {
    return this.op(
      () => {
        const cur = this.get().alerts;
        const r: ClinicalRule = { ...rule, id: rule.id ?? `new-${uid('')}` };
        const rules = cur.clinicalRules.some((x) => x.id === r.id) ? cur.clinicalRules.map((x) => (x.id === r.id ? r : x)) : [...cur.clinicalRules, r];
        return this.remote.saveAlerts({ ...cur, clinicalRules: rules });
      },
      () => this.saveRuleLocal(rule),
    );
  }

  private saveRuleLocal(rule: Omit<ClinicalRule, 'id'> & { id?: string }): void {
    this.data.mutate((d) => {
      const r = { ...rule, id: rule.id ?? uid('r') };
      const i = d.settings.alerts.clinicalRules.findIndex((x) => x.id === r.id);
      if (i >= 0) d.settings.alerts.clinicalRules[i] = r;
      else d.settings.alerts.clinicalRules.push(r);
      this.data.audit(d, 'settings.rule', 'settings', r.id, `Guardó la regla clínica "${r.keyword}"`);
    });
  }

  deleteRule(id: string): Observable<void> {
    return this.op(() => this.remote.saveAlerts({ ...this.get().alerts, clinicalRules: this.get().alerts.clinicalRules.filter((r) => r.id !== id) }), () => this.deleteRuleLocal(id));
  }

  private deleteRuleLocal(id: string): void {
    this.data.mutate((d) => {
      d.settings.alerts.clinicalRules = d.settings.alerts.clinicalRules.filter((r) => r.id !== id);
    });
  }

  /** Cada edición del texto publica una versión nueva; las anteriores no se sobrescriben (§4.1). */
  publishConsentVersion(type: ConsentType, title: string, content: string): Observable<void> {
    return this.op(() => this.remote.publishConsent(type, title, content), () => this.publishLocal(type, title, content));
  }

  private publishLocal(type: ConsentType, title: string, content: string): void {
    this.data.mutate((d) => {
      const versions = d.consentDocuments.filter((c) => c.type === type);
      const next = Math.max(0, ...versions.map((v) => v.version)) + 1;
      for (const v of versions) v.isActive = false;
      const doc: ConsentDocument = { id: uid('cd-'), type, version: next, title, content, publishedAt: new Date().toISOString(), isActive: true };
      d.consentDocuments.push(doc);
      this.data.audit(d, 'consent.publish', 'consent_document', doc.id, `Publicó ${title} versión ${next}`);
    });
  }

  consentVersions = (type: ConsentType): ConsentDocument[] =>
    this.data.db().consentDocuments.filter((c) => c.type === type).sort((a, b) => b.version - a.version);

  acceptanceCount = (docId: string): number => this.apiMode ? this.remote.acceptances(docId) : this.data.db().consentAcceptances.filter((a) => a.consentDocumentId === docId && !a.revokedAt).length;

  resetDemo(): void {
    if (this.apiMode) return;
    this.data.reset();
  }
}
