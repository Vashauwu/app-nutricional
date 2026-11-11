import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap, tap } from 'rxjs';
import { BrandSettings, ClinicalRule, ConsentDocument, ConsentType, Settings } from '../../shared/models/domain';
import { DbService } from '../data/db.service';
import { API, ApiClient } from './api-client';

// ---------- Formas de la API (backend/internal/settings) ----------
interface ApiBrand {
  business_name: string; tagline: string; primary: string; secondary: string; logo_file_id: string | null; photo_file_id: string | null; phone: string; email: string;
  address: string; credentials: string; license_number: string;
}
interface ApiRule { id: string; keyword: string; triggers: string[] | null; level: ClinicalRule['level']; message: string; enabled: boolean }
interface ApiSettings {
  brand: ApiBrand;
  region: { timezone: string; week_start: 'mon' | 'sun' };
  storage: { default_quota_bytes: number; max_image_bytes: number; max_pdf_bytes: number; warn_threshold_pct: number };
  alerts: { energy_tolerance_pct: string; macro_tolerance_pct: string; equivalent_tolerance: string; clinical_rules: ApiRule[] | null };
}
interface ApiConsent { id: string; document_type: ConsentType; version: number; title: string; content: string; published_at: string; is_active: boolean; acceptances: number }

const fileUrl = (id: string | null): string | undefined => (id ? `${API}/files/${id}` : undefined);
export const fileIdFromUrl = (u: string | undefined): string | undefined => u?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];

function mapBrand(b: ApiBrand): BrandSettings {
  return {
    businessName: b.business_name, tagline: b.tagline, primary: b.primary, secondary: b.secondary, logoDataUrl: fileUrl(b.logo_file_id), photoDataUrl: fileUrl(b.photo_file_id),
    phone: b.phone, email: b.email, address: b.address, credentials: b.credentials, licenseNumber: b.license_number,
  };
}

const mapRule = (r: ApiRule): ClinicalRule => ({ id: r.id, keyword: r.keyword, triggers: r.triggers ?? [], level: r.level, message: r.message, enabled: r.enabled });

function mapAll(s: ApiSettings): Settings {
  return {
    brand: mapBrand(s.brand),
    region: { timezone: s.region.timezone, weekStart: s.region.week_start },
    storage: { defaultQuotaBytes: s.storage.default_quota_bytes, maxImageBytes: s.storage.max_image_bytes, maxPdfBytes: s.storage.max_pdf_bytes, warnThresholdPct: s.storage.warn_threshold_pct },
    alerts: {
      energyTolerancePct: Number(s.alerts.energy_tolerance_pct), macroTolerancePct: Number(s.alerts.macro_tolerance_pct), equivalentTolerance: Number(s.alerts.equivalent_tolerance),
      clinicalRules: (s.alerts.clinical_rules ?? []).map(mapRule),
    },
  };
}

@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly api = inject(ApiClient);
  private readonly data = inject(DbService);

  /** Configuración completa (solo nutrióloga). */
  load(): Observable<void> {
    return this.api.get<ApiSettings>('/settings').pipe(
      tap((s) => this.data.mutate((d) => { d.settings = mapAll(s); })),
      map(() => void 0),
    );
  }

  /** Marca visible para cualquier sesión (encabezados y datos de contacto). */
  loadBrand(): Observable<void> {
    return this.api.get<ApiBrand>('/brand').pipe(tap((b) => this.data.mutate((d) => { d.settings.brand = mapBrand(b); })), map(() => void 0));
  }

  /** Nombre y colores para la pantalla de ingreso (sin sesión). */
  loadPublicBrand(): Observable<void> {
    return this.api.get<{ business_name: string; tagline: string; primary: string; secondary: string }>('/public/brand').pipe(
      tap((b) => this.data.mutate((d) => { Object.assign(d.settings.brand, { businessName: b.business_name, tagline: b.tagline, primary: b.primary, secondary: b.secondary }); })),
      map(() => void 0),
    );
  }

  private uploadImage(dataUrl: string, kind: 'brand_logo' | 'brand_photo'): Observable<string> {
    return of(dataUrl).pipe(
      switchMap(async (u) => (await fetch(u)).blob()),
      switchMap((blob) => {
        const f = new FormData();
        f.append('kind', kind);
        f.append('file', blob, 'imagen.jpg');
        return this.api.post<{ id: string }>('/uploads/images', f);
      }),
      map((r) => r.id),
    );
  }

  private imageId(url: string | undefined, kind: 'brand_logo' | 'brand_photo'): Observable<string | null> {
    if (!url) return of(null);
    if (url.startsWith('data:')) return this.uploadImage(url, kind);
    return of(fileIdFromUrl(url) ?? null);
  }

  saveBrand(b: BrandSettings): Observable<void> {
    return this.imageId(b.logoDataUrl, 'brand_logo').pipe(
      switchMap((logo) => this.imageId(b.photoDataUrl, 'brand_photo').pipe(map((photo) => ({ logo, photo })))),
      switchMap(({ logo, photo }) =>
        this.api.put<ApiBrand>('/settings/brand', {
          business_name: b.businessName, tagline: b.tagline, primary: b.primary, secondary: b.secondary, logo_file_id: logo, photo_file_id: photo, phone: b.phone, email: b.email,
          address: b.address, credentials: b.credentials, license_number: b.licenseNumber,
        }),
      ),
      tap((r) => this.data.mutate((d) => { d.settings.brand = mapBrand(r); })),
      map(() => void 0),
    );
  }

  saveRegion(r: Settings['region']): Observable<void> {
    return this.api.put('/settings/region', { timezone: r.timezone, week_start: r.weekStart }).pipe(tap(() => this.data.mutate((d) => { d.settings.region = r; })), map(() => void 0));
  }

  saveStorage(s: Settings['storage']): Observable<void> {
    return this.api
      .put('/settings/storage', { default_quota_bytes: s.defaultQuotaBytes, max_image_bytes: s.maxImageBytes, max_pdf_bytes: s.maxPdfBytes, warn_threshold_pct: s.warnThresholdPct })
      .pipe(tap(() => this.data.mutate((d) => { d.settings.storage = s; })), map(() => void 0));
  }

  /** Los umbrales y las reglas se guardan juntos; el servidor asigna los ids de las reglas nuevas. */
  saveAlerts(a: Settings['alerts']): Observable<void> {
    return this.api
      .put<ApiSettings['alerts']>('/settings/alerts', {
        energy_tolerance_pct: String(a.energyTolerancePct), macro_tolerance_pct: String(a.macroTolerancePct), equivalent_tolerance: String(a.equivalentTolerance),
        clinical_rules: a.clinicalRules.map((r) => ({ id: r.id.startsWith('new-') ? '' : r.id, keyword: r.keyword, triggers: r.triggers, level: r.level, message: r.message, enabled: r.enabled })),
      })
      .pipe(
        tap((r) =>
          this.data.mutate((d) => {
            d.settings.alerts = { energyTolerancePct: Number(r.energy_tolerance_pct), macroTolerancePct: Number(r.macro_tolerance_pct), equivalentTolerance: Number(r.equivalent_tolerance), clinicalRules: (r.clinical_rules ?? []).map(mapRule) };
          }),
        ),
        map(() => void 0),
      );
  }

  /** Últimos 200 eventos de auditoría (solo lectura). */
  loadAudit(): Observable<void> {
    return this.api.get<{ items: { id: string; at: string; actor: string; action: string; resource_type: string; resource_id: string; request_id: string; metadata: Record<string, unknown> | null }[] }>('/audit', { page_size: 200 }).pipe(
      tap((r) =>
        this.data.mutate((d) => {
          d.audit = (r.items ?? []).map((a) => ({
            id: a.id, at: a.at, actor: a.actor, action: a.action, resourceType: a.resource_type, resourceId: a.resource_id,
            summary: a.metadata && Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : '', requestId: a.request_id,
          }));
        }),
      ),
      map(() => void 0),
    );
  }

  // ---------- Documentos legales ----------
  private readonly counts = new Map<string, number>();
  acceptances = (id: string): number => this.counts.get(id) ?? 0;

  loadConsents(): Observable<void> {
    return this.api.get<{ items: ApiConsent[] }>('/settings/consent-documents', { type: 'privacy' }).pipe(
      switchMap((p) => this.api.get<{ items: ApiConsent[] }>('/settings/consent-documents', { type: 'informed' }).pipe(map((i) => [...p.items, ...i.items]))),
      tap((all) => {
        for (const c of all) this.counts.set(c.id, c.acceptances);
        this.data.mutate((d) => {
          d.consentDocuments = all.map((c): ConsentDocument => ({ id: c.id, type: c.document_type, version: c.version, title: c.title, content: c.content, publishedAt: c.published_at, isActive: c.is_active }));
        });
      }),
      map(() => void 0),
    );
  }

  publishConsent(type: ConsentType, title: string, content: string): Observable<void> {
    return this.api.post('/settings/consent-documents', { type, title, content }).pipe(switchMap(() => this.loadConsents()));
  }
}
