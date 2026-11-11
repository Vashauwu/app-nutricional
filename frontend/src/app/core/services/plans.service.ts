import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap, tap, throwError } from 'rxjs';
import { ApiClient, ApiError } from '../api/api-client';
import { PlansApi, toBody } from '../api/plans-api';
import { DbService } from '../data/db.service';
import {
  DEFAULT_SLOTS, MealPlan, NutriAlert, PlanDay, PlanEvent, PlanItem, PlanSlot, PlanStatus, PlanTargets, PlanTemplate,
} from '../../shared/models/domain';
import { DishLookup, Tolerances } from '../nutrition/engine';
import { evaluatePlanAlerts, sortAlerts } from '../nutrition/alerts';
import { Page, paginate } from '../../shared/utils/loadable';
import { addDays, diffDays, normalizeText, todayIso, uid, uuid } from '../../shared/utils/format';

export class ConflictError extends Error {
  constructor(readonly current: MealPlan) {
    super('El plan fue modificado por otra persona o sesión.');
    this.name = 'ConflictError';
  }
}

export interface PlanQuery {
  search: string;
  status: PlanStatus | '';
  patientId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

export const emptyTargets = (): PlanTargets => ({ energy: '1800', protein: '90', carbs: '220', lipids: '60', equivalents: {}, version: 1 });

export const newSlot = (name: string): PlanSlot => ({ id: uuid(), name, items: [] });

export function buildEmptyDays(start: string, end: string, slotNames: readonly string[] = DEFAULT_SLOTS): PlanDay[] {
  const n = Math.max(1, diffDays(end, start) + 1);
  return Array.from({ length: Math.min(n, 120) }, (_, i) => ({ date: addDays(start, i), notes: '', slots: slotNames.map(newSlot) }));
}

/** Copia con ids nuevos: los planes asignados son independientes de su origen (§10). */
export function cloneDays(days: PlanDay[], shiftDays = 0): PlanDay[] {
  return days.map((d) => ({
    date: addDays(d.date, shiftDays),
    notes: d.notes,
    slots: d.slots.map((s) => ({ id: uuid(), name: s.name, items: s.items.map((i) => ({ ...i, id: uuid() })) })),
  }));
}

@Injectable({ providedIn: 'root' })
export class PlansService {
  private readonly data = inject(DbService);
  private readonly remote = inject(PlansApi);
  readonly apiMode = inject(ApiClient).enabled;
  /** Modo API: alertas calculadas por el servidor (§14), por plan, y las de todos los planes publicados. */
  private readonly alertCache = signal<Record<string, NutriAlert[]>>({});
  private readonly publishedAlerts = signal<NutriAlert[]>([]);

  private op(api: () => Observable<unknown>, local: () => void): Observable<void> {
    if (this.apiMode) return api().pipe(map(() => void 0));
    local();
    return of(void 0);
  }

  /** Modo API: carga el plan completo, su historial y sus alertas. En modo simulado no hace nada. */
  load(id: string): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.remote.load(id).pipe(
      tap(() => this.refreshAlerts(id)),
      map(() => void 0),
    );
  }

  /** Modo API: vuelve a pedir al servidor las alertas del plan (tras guardar o cambiar de estado). */
  refreshAlerts(id: string): void {
    if (!this.apiMode) return;
    this.remote.alerts(id).subscribe({ next: (l) => this.alertCache.update((c) => ({ ...c, [id]: l })), error: () => undefined });
  }

  /** Modo API: alertas de todos los planes publicados (tablero). */
  loadPublishedAlerts(): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.remote.allAlerts().pipe(tap((l) => this.publishedAlerts.set(l)), map(() => void 0));
  }

  /** Modo API: mete en DbService un resumen (sin días) de los planes, para elegir cuál copiar. */
  loadAllSummaries(): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.remote.list({ search: '', status: '', patientId: '', from: '', to: '', page: 1, pageSize: 100 }).pipe(
      tap((page) =>
        this.data.mutate((d) => {
          for (const p of page.items) if (!d.plans.some((x) => x.id === p.id)) d.plans.push(p);
        }),
      ),
      map(() => void 0),
    );
  }

  /** Modo API: carga los planes (con días) de un paciente, para reportes y comparativas. */
  loadForPatient(patientId: string): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.remote.list({ search: '', status: '', patientId, from: '', to: '', page: 1, pageSize: 50 }).pipe(
      switchMap((page) => {
        const ids = page.items.filter((p) => p.status !== 'draft').map((p) => p.id);
        return ids.length ? forkJoin(ids.map((id) => this.remote.load(id))).pipe(map(() => void 0)) : of(void 0);
      }),
    );
  }

  loadTemplates(patientId?: string): Observable<void> {
    return this.apiMode ? this.remote.loadTemplates(patientId) : of(void 0);
  }

  get = (id: string): MealPlan | undefined => this.data.db().plans.find((p) => p.id === id && !p.deletedAt);
  plansOf = (patientId: string): MealPlan[] => this.data.db().plans.filter((p) => p.patientId === patientId && !p.deletedAt);

  lookup: DishLookup = (id, v) => this.data.dishVersion(id, v);

  tolerances(): Tolerances {
    const a = this.data.db().settings.alerts;
    return { energyPct: a.energyTolerancePct, macroPct: a.macroTolerancePct, equivalent: a.equivalentTolerance };
  }

  /** Plan vigente para el paciente: publicado y dentro de periodo (o el más reciente). */
  currentFor(patientId: string): MealPlan | undefined {
    const t = todayIso();
    const published = this.plansOf(patientId).filter((p) => p.status === 'published');
    return published.find((p) => p.startDate <= t && p.endDate >= t) ?? published.sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  }

  list(q: PlanQuery): Observable<Page<MealPlan>> {
    if (this.apiMode) return this.remote.list(q);
    return this.data.respond(() => {
      const term = normalizeText(q.search);
      const rows = this.data.db().plans
        .filter((p) => !p.deletedAt)
        .filter((p) => (q.status ? p.status === q.status : true))
        .filter((p) => (q.patientId ? p.patientId === q.patientId : true))
        .filter((p) => (q.from ? p.endDate >= q.from : true))
        .filter((p) => (q.to ? p.startDate <= q.to : true))
        .filter((p) => !term || normalizeText(`${p.name} ${this.data.patientName(p.patientId)}`).includes(term))
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
      return paginate(rows, q.page, q.pageSize);
    });
  }

  // ---------- Creación ----------
  create(opts: { patientId: string; name: string; startDate: string; endDate: string; targets?: PlanTargets; templateId?: string; copyFromPlanId?: string }): Observable<string> {
    if (!this.apiMode) return of(this.createLocal(opts));
    return this.remote.create({
      patient_id: opts.patientId, name: opts.name.trim(), start_date: opts.startDate, end_date: opts.endDate,
      targets: opts.targets ? toBody('', opts.targets, []).targets : undefined, template_id: opts.templateId, copy_from_plan_id: opts.copyFromPlanId,
    });
  }

  private createLocal(opts: { patientId: string; name: string; startDate: string; endDate: string; targets?: PlanTargets; templateId?: string; copyFromPlanId?: string }): string {
    const id = uid('pl-');
    const now = new Date().toISOString();
    this.data.mutate((d) => {
      let days = buildEmptyDays(opts.startDate, opts.endDate);
      let summary = 'Plan creado en blanco';
      let targets = opts.targets ?? emptyTargets();
      const tpl = opts.templateId ? d.templates.find((t) => t.id === opts.templateId) : undefined;
      const src = opts.copyFromPlanId ? d.plans.find((p) => p.id === opts.copyFromPlanId) : undefined;
      if (tpl) {
        days = days.map((day, i) => {
          const t = tpl.days[i % tpl.days.length];
          return { ...day, slots: t.slots.map((s) => ({ id: uuid(), name: s.name, items: s.items.map((it) => ({ ...it, id: uuid() })) })) };
        });
        summary = `Plan creado desde la plantilla "${tpl.name}"`;
      } else if (src) {
        const shift = diffDays(opts.startDate, src.startDate);
        const copied = cloneDays(src.days, shift).filter((x) => x.date >= opts.startDate && x.date <= opts.endDate);
        days = days.map((day) => copied.find((c) => c.date === day.date) ?? day);
        targets = opts.targets ?? { ...structuredClone(src.targets), version: 1 };
        summary = `Plan duplicado de "${src.name}" (independiente del original)`;
      }
      const ev: PlanEvent = { id: uid('e'), at: now, by: this.data.actor(), type: src ? 'duplicated' : 'created', summary };
      d.plans.push({
        id, patientId: opts.patientId, name: opts.name.trim(), status: 'draft', startDate: opts.startDate, endDate: opts.endDate,
        revision: 1, updatedAt: now, updatedBy: this.data.actor(), createdAt: now, createdBy: this.data.actor(),
        targets, days, publications: [], history: [ev],
      });
      this.data.audit(d, 'plan.create', 'meal_plan', id, `Creó "${opts.name}"`);
    });
    return id;
  }

  // ---------- Guardado con control de concurrencia (§9.3) ----------
  save(planId: string, patch: { days: PlanDay[]; targets: PlanTargets; name?: string }, expectedRevision: number): Observable<MealPlan> {
    if (this.apiMode) {
      const name = patch.name ?? this.get(planId)?.name ?? '';
      return this.remote.save(planId, expectedRevision, toBody(name, patch.targets, patch.days)).pipe(
        tap(() => this.refreshAlerts(planId)),
        catchError((e: unknown) => {
          if (e instanceof ApiError && e.status === 409) {
            // Otra sesión guardó antes: se trae la versión actual para que la persona decida.
            return this.remote.load(planId).pipe(switchMap((cur) => throwError(() => new ConflictError(cur))));
          }
          return throwError(() => e);
        }),
      );
    }
    return new Observable<MealPlan>((sub) => {
      const timer = setTimeout(() => {
        if (!this.data.isOnline()) {
          sub.error(new Error('Sin conexión'));
          return;
        }
        const current = this.get(planId);
        if (!current) {
          sub.error(new Error('El plan ya no existe.'));
          return;
        }
        if (current.revision !== expectedRevision) {
          sub.error(new ConflictError(structuredClone(current)));
          return;
        }
        const saved = this.data.mutate((d) => {
          const p = d.plans.find((x) => x.id === planId)!;
          p.days = structuredClone(patch.days).sort((a, b) => a.date.localeCompare(b.date));
          if (p.days.length) {
            p.startDate = p.days[0].date;
            p.endDate = p.days[p.days.length - 1].date;
          }
          p.targets = structuredClone(patch.targets);
          if (patch.name) p.name = patch.name;
          p.revision += 1;
          p.updatedAt = new Date().toISOString();
          p.updatedBy = this.data.actor();
          // Coalesce eventos de edición para no inundar el historial.
          const last = p.history[p.history.length - 1];
          if (last?.type === 'edited' && Date.now() - new Date(last.at).getTime() < 15 * 60_000) last.at = p.updatedAt;
          else p.history.push({ id: uid('e'), at: p.updatedAt, by: this.data.actor(), type: 'edited', summary: 'Editó el menú' });
          // Un plan publicado muestra los cambios de inmediato; se conserva un snapshot de lo visible (§11).
          if (p.status === 'published') {
            const lastPub = p.publications[p.publications.length - 1];
            if (lastPub && Date.now() - new Date(lastPub.publishedAt).getTime() < 30 * 60_000) {
              lastPub.days = structuredClone(p.days);
              lastPub.targets = structuredClone(p.targets);
            } else {
              p.publications.push({ versionNumber: (lastPub?.versionNumber ?? 0) + 1, publishedAt: p.updatedAt, by: this.data.actor(), summary: 'Cambios aplicados al plan publicado', days: structuredClone(p.days), targets: structuredClone(p.targets) });
            }
          }
          return structuredClone(p);
        });
        sub.next(saved);
        sub.complete();
      }, 450);
      return () => clearTimeout(timer);
    });
  }

  /** Resolución de conflicto: se descarta la versión local y se carga la remota. */
  reload = (planId: string): MealPlan | undefined => {
    const p = this.get(planId);
    return p ? structuredClone(p) : undefined;
  };

  // ---------- Ciclo de vida (§11) ----------
  publish(planId: string, summary: string): Observable<void> {
    return this.op(() => this.remote.transition(planId, 'publish', summary).pipe(tap(() => this.refreshAlerts(planId))), () => this.publishLocal(planId, summary));
  }

  private publishLocal(planId: string, summary: string): void {
    this.data.mutate((d) => {
      const p = d.plans.find((x) => x.id === planId);
      if (!p) return;
      p.status = 'published';
      const n = (p.publications[p.publications.length - 1]?.versionNumber ?? 0) + 1;
      p.publications.push({ versionNumber: n, publishedAt: new Date().toISOString(), by: this.data.actor(), summary: summary || (n === 1 ? 'Publicación inicial' : 'Nueva publicación'), days: structuredClone(p.days), targets: structuredClone(p.targets) });
      p.history.push({ id: uid('e'), at: new Date().toISOString(), by: this.data.actor(), type: 'published', summary: `Publicado como versión ${n}` });
      p.revision += 1;
      this.data.audit(d, 'plan.publish', 'meal_plan', planId, `Publicó "${p.name}" (v${n})`);
    });
  }

  unpublish(planId: string): Observable<void> {
    return this.op(() => this.remote.transition(planId, 'unpublish'), () => this.setStatus(planId, 'draft', 'edited', 'Regresó a borrador (deja de ser visible para el paciente)'));
  }

  finalize(planId: string): Observable<void> {
    return this.op(() => this.remote.transition(planId, 'finalize'), () => this.setStatus(planId, 'finished', 'finished', 'Finalizado manualmente'));
  }

  archive(planId: string): Observable<void> {
    return this.op(() => this.remote.transition(planId, 'archive'), () => this.setStatus(planId, 'archived', 'archived', 'Archivado'));
  }

  restore(planId: string): Observable<void> {
    return this.op(() => this.remote.transition(planId, 'restore'), () => this.setStatus(planId, 'finished', 'restored', 'Restaurado desde el archivo'));
  }

  private setStatus(planId: string, status: PlanStatus, type: PlanEvent['type'], summary: string): void {
    this.data.mutate((d) => {
      const p = d.plans.find((x) => x.id === planId);
      if (!p) return;
      p.status = status;
      p.revision += 1;
      p.updatedAt = new Date().toISOString();
      p.history.push({ id: uid('e'), at: p.updatedAt, by: this.data.actor(), type, summary });
      this.data.audit(d, `plan.${status}`, 'meal_plan', planId, `${summary}: "${p.name}"`);
    });
  }

  softDelete(planId: string): Observable<void> {
    return this.op(() => this.remote.remove(planId), () => this.softDeleteLocal(planId));
  }

  private softDeleteLocal(planId: string): void {
    this.data.mutate((d) => {
      const p = d.plans.find((x) => x.id === planId);
      if (p) p.deletedAt = new Date().toISOString();
      this.data.audit(d, 'plan.delete', 'meal_plan', planId, `Eliminó (lógicamente) "${p?.name}"`);
    });
  }

  /** Al terminar el periodo el plan pasa a finalizado (§11). */
  finalizeExpired(): void {
    if (this.apiMode) return; // el servidor finaliza los planes vencidos al consultarlos
    const t = todayIso();
    const expired = this.data.db().plans.filter((p) => p.status === 'published' && p.endDate < t && !p.deletedAt);
    if (!expired.length) return;
    this.data.mutate((d) => {
      for (const e of expired) {
        const p = d.plans.find((x) => x.id === e.id)!;
        p.status = 'finished';
        p.history.push({ id: uid('e'), at: new Date().toISOString(), by: 'Sistema', type: 'finished', summary: 'Finalizado automáticamente al terminar el periodo' });
      }
    });
  }

  // ---------- Sustituciones en planes publicados (§8) ----------
  substitute(planId: string, date: string, slotId: string, itemId: string, to: { dishId: string; dishVersion: number }, reason: string): Observable<void> {
    return this.op(() => this.remote.substitute(planId, itemId, to.dishId, to.dishVersion, reason).pipe(tap(() => this.refreshAlerts(planId))), () => this.substituteLocal(planId, date, slotId, itemId, to, reason));
  }

  private substituteLocal(planId: string, date: string, slotId: string, itemId: string, to: { dishId: string; dishVersion: number }, reason: string): void {
    this.data.mutate((d) => {
      const p = d.plans.find((x) => x.id === planId);
      const slot = p?.days.find((x) => x.date === date)?.slots.find((s) => s.id === slotId);
      const idx = slot?.items.findIndex((i) => i.id === itemId) ?? -1;
      if (!p || !slot || idx < 0) return;
      const old = slot.items[idx];
      const oldName = d.dishes.find((x) => x.id === old.dishId)?.name ?? 'Platillo';
      const newName = d.dishes.find((x) => x.id === to.dishId)?.name ?? 'Platillo';
      // Elemento nuevo: los seguimientos previos quedan ligados al platillo y versión originales.
      slot.items[idx] = { id: uuid(), dishId: to.dishId, dishVersion: to.dishVersion, servings: old.servings, instructions: old.instructions };
      p.revision += 1;
      p.updatedAt = new Date().toISOString();
      p.history.push({ id: uid('e'), at: p.updatedAt, by: this.data.actor(), type: 'substitution', summary: `${oldName} v${old.dishVersion} → ${newName} v${to.dishVersion} (${date}, ${slot.name}). Motivo: ${reason || 'sin especificar'}` });
      if (p.status === 'published') {
        const lastPub = p.publications[p.publications.length - 1];
        p.publications.push({ versionNumber: (lastPub?.versionNumber ?? 0) + 1, publishedAt: p.updatedAt, by: this.data.actor(), summary: `Sustitución: ${oldName} → ${newName}`, days: structuredClone(p.days), targets: structuredClone(p.targets) });
      }
      this.data.audit(d, 'plan.substitution', 'meal_plan', planId, `Sustituyó ${oldName} por ${newName}`);
    });
  }

  // ---------- Plantillas (§10) ----------
  templates = (patientId?: string): PlanTemplate[] =>
    this.data.db().templates.filter((t) => t.scope === 'global' || (patientId && t.patientId === patientId));

  allTemplates = (): PlanTemplate[] => this.data.db().templates;

  saveTemplateFromPlan(planId: string, opts: { name: string; description: string; scope: 'global' | 'patient'; fromDate: string; toDate: string }): Observable<string> {
    if (!this.apiMode) return of(this.saveTemplateLocal(planId, opts));
    return this.remote.saveTemplate(planId, { name: opts.name.trim(), description: opts.description, scope: opts.scope, from_date: opts.fromDate, to_date: opts.toDate }).pipe(
      switchMap((id) => this.remote.loadTemplates().pipe(map(() => id))),
    );
  }

  private saveTemplateLocal(planId: string, opts: { name: string; description: string; scope: 'global' | 'patient'; fromDate: string; toDate: string }): string {
    const id = uid('tpl-');
    this.data.mutate((d) => {
      const p = d.plans.find((x) => x.id === planId);
      if (!p) return;
      const days = p.days.filter((x) => x.date >= opts.fromDate && x.date <= opts.toDate);
      d.templates.push({
        id, name: opts.name.trim(), description: opts.description, scope: opts.scope, patientId: opts.scope === 'patient' ? p.patientId : undefined,
        days: days.map((day, i) => ({ offset: i, slots: day.slots.map((s) => ({ name: s.name, items: s.items.map(({ dishId, dishVersion, servings, instructions }) => ({ dishId, dishVersion, servings, instructions })) })) })),
        createdAt: new Date().toISOString(), createdBy: this.data.actor(),
      });
      this.data.audit(d, 'template.create', 'template', id, `Guardó la plantilla "${opts.name}"`);
    });
    return id;
  }

  duplicateTemplate(id: string): Observable<void> {
    return this.op(() => this.remote.duplicateTemplate(id).pipe(switchMap(() => this.remote.loadTemplates())), () => this.duplicateTemplateLocal(id));
  }

  private duplicateTemplateLocal(id: string): void {
    this.data.mutate((d) => {
      const t = d.templates.find((x) => x.id === id);
      if (t) d.templates.push({ ...structuredClone(t), id: uid('tpl-'), name: `Copia de ${t.name}`, createdAt: new Date().toISOString() });
    });
  }

  deleteTemplate(id: string): Observable<void> {
    return this.op(() => this.remote.deleteTemplate(id).pipe(switchMap(() => this.remote.loadTemplates())), () => this.deleteTemplateLocal(id));
  }

  private deleteTemplateLocal(id: string): void {
    this.data.mutate((d) => {
      d.templates = d.templates.filter((t) => t.id !== id);
    });
  }

  // ---------- Alertas (§14) ----------
  alertsFor(plan: MealPlan, days?: PlanDay[]): NutriAlert[] {
    if (this.apiMode) {
      const dates = days ? new Set(days.map((x) => x.date)) : null;
      return (this.alertCache()[plan.id] ?? []).filter((a) => !dates || !a.date || dates.has(a.date));
    }
    const d = this.data.db();
    const patient = d.patients.find((p) => p.id === plan.patientId);
    if (!patient) return [];
    return evaluatePlanAlerts({ patient, plan, settings: d.settings, dishes: d.dishes, lookup: this.lookup, subgroupName: this.data.subgroupName, days });
  }

  /** Alertas relevantes de todos los pacientes activos: planes en borrador completos; publicados, ventana de ±7 días. */
  allAlerts(): NutriAlert[] {
    if (this.apiMode) return this.publishedAlerts();
    const t = todayIso();
    const out: NutriAlert[] = [];
    for (const p of this.data.db().plans) {
      if (p.deletedAt || p.status === 'archived' || p.status === 'finished') continue;
      const patient = this.data.patient(p.patientId);
      if (!patient || patient.deletedAt) continue;
      const days = p.status === 'draft' ? p.days : p.days.filter((x) => x.date >= addDays(t, -1) && x.date <= addDays(t, 7));
      out.push(...this.alertsFor(p, days));
    }
    return sortAlerts(out);
  }

  slotNamesOf(plan: MealPlan): string[] {
    return [...new Set(plan.days.flatMap((d) => d.slots.map((s) => s.name)))];
  }

  itemCount = (plan: MealPlan): number => plan.itemCount ?? plan.days.reduce((a, d) => a + d.slots.reduce((b, s) => b + s.items.length, 0), 0);
}

export const itemKey = (it: PlanItem): string => it.id;
void throwError;
