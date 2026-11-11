import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { DbService } from '../../core/data/db.service';
import { ConflictError, PlansService, newSlot } from '../../core/services/plans.service';
import { ToastService } from '../../core/services/ui.services';
import { MealPlan, PlanDay, PlanItem, PlanSlot, PlanTargets } from '../../shared/models/domain';
import { addDays, uid, uuid } from '../../shared/utils/format';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict';

interface Snapshot {
  days: PlanDay[];
  targets: PlanTargets;
  name: string;
}

const PENDING_KEY = (id: string): string => `nutri-plan-pending-${id}`;
const MAX_UNDO = 40;
const DEBOUNCE_MS = 1200;

/**
 * Estado del editor de un plan (§9). Copia de trabajo local con:
 * - autoguardado con debounce e indicadores (guardando / guardado / error),
 * - deshacer/rehacer de cambios recientes,
 * - cola de operaciones pendientes que se recupera al volver la conexión
 *   (también tras recargar: el pendiente se conserva en el dispositivo),
 * - control de concurrencia por número de revisión: nunca sobrescribe en silencio.
 */
@Injectable()
export class PlanEditorStore {
  private readonly plans = inject(PlansService);
  private readonly data = inject(DbService);
  private readonly toast = inject(ToastService);

  readonly working = signal<Snapshot | null>(null);
  readonly meta = signal<Pick<MealPlan, 'id' | 'patientId' | 'status' | 'publications' | 'history'> | null>(null);
  readonly saveState = signal<SaveState>('idle');
  readonly lastSavedAt = signal<Date | null>(null);
  readonly remote = signal<MealPlan | null>(null);
  readonly recovered = signal(false);

  private baseRevision = 0;
  private undo: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  private saving = false;
  private planId = '';

  readonly days = computed(() => this.working()?.days ?? []);
  readonly targets = computed(() => this.working()?.targets ?? null);
  readonly name = computed(() => this.working()?.name ?? '');
  readonly hasUnsavedChanges = computed(() => ['dirty', 'saving', 'error', 'offline', 'conflict'].includes(this.saveState()));

  constructor() {
    const onOnline = (): void => {
      if (this.saveState() === 'offline') void this.flush();
    };
    window.addEventListener('online', onOnline);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', onOnline);
      clearTimeout(this.timer);
    });
  }

  // ---------- Carga ----------
  load(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;
    this.planId = planId;
    this.baseRevision = plan.revision;
    this.meta.set({ id: plan.id, patientId: plan.patientId, status: plan.status, publications: plan.publications, history: plan.history });
    this.working.set({ days: structuredClone(plan.days), targets: structuredClone(plan.targets), name: plan.name });
    this.undo = [];
    this.redoStack = [];
    this.syncStacks();
    // Recuperación de operaciones pendientes tras recarga/pérdida de conexión.
    try {
      const raw = localStorage.getItem(PENDING_KEY(planId));
      if (raw) {
        const pending = JSON.parse(raw) as { base: number; snap: Snapshot };
        this.working.set(pending.snap);
        this.baseRevision = pending.base;
        this.recovered.set(true);
        this.saveState.set(this.data.isOnline() ? 'dirty' : 'offline');
        if (this.data.isOnline()) this.schedule(300);
        return true;
      }
    } catch {
      /* sin almacenamiento local: no hay pendientes que recuperar */
    }
    this.saveState.set('idle');
    return true;
  }

  /** Refresca los metadatos cuando otro proceso cambia el plan (SSE simulado). */
  refreshMeta(): void {
    const plan = this.plans.get(this.planId);
    if (!plan) return;
    this.meta.set({ id: plan.id, patientId: plan.patientId, status: plan.status, publications: plan.publications, history: plan.history });
    const clean = this.saveState() === 'idle' || this.saveState() === 'saved';
    if (clean && !this.saving && plan.revision !== this.baseRevision) {
      // Sin cambios locales: se adopta la versión remota de forma visible, no silenciosa.
      this.baseRevision = plan.revision;
      this.working.set({ days: structuredClone(plan.days), targets: structuredClone(plan.targets), name: plan.name });
      this.toast.info(`El plan se actualizó (${plan.updatedBy}).`);
    }
  }

  // ---------- Mutaciones con historial ----------
  private snapshot(): Snapshot {
    return structuredClone(this.working()!);
  }

  private syncStacks(): void {
    this.canUndo.set(this.undo.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
  }

  mutate(fn: (draft: Snapshot) => void): void {
    const cur = this.working();
    if (!cur) return;
    this.undo.push(this.snapshot());
    if (this.undo.length > MAX_UNDO) this.undo.shift();
    this.redoStack = [];
    const next = this.snapshot();
    fn(next);
    this.working.set(next);
    this.syncStacks();
    this.markDirty();
  }

  undoLast(): void {
    const prev = this.undo.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.working.set(prev);
    this.syncStacks();
    this.markDirty();
  }

  redoLast(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undo.push(this.snapshot());
    this.working.set(next);
    this.syncStacks();
    this.markDirty();
  }

  // ---------- Guardado ----------
  private markDirty(): void {
    this.persistPending();
    if (this.saveState() === 'conflict') return;
    this.saveState.set(this.data.isOnline() ? 'dirty' : 'offline');
    if (this.data.isOnline()) this.schedule(DEBOUNCE_MS);
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private persistPending(): void {
    try {
      localStorage.setItem(PENDING_KEY(this.planId), JSON.stringify({ base: this.baseRevision, snap: this.working() }));
    } catch {
      /* ignorado */
    }
  }

  private clearPending(): void {
    try {
      localStorage.removeItem(PENDING_KEY(this.planId));
    } catch {
      /* ignorado */
    }
  }

  /** Guarda ahora. Devuelve true si el estado quedó persistido. */
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    const snap = this.working();
    if (!snap || this.saving) return Promise.resolve(this.saveState() === 'saved' || this.saveState() === 'idle');
    if (!this.data.isOnline()) {
      this.saveState.set('offline');
      return Promise.resolve(false);
    }
    this.saving = true;
    this.saveState.set('saving');
    const sent = JSON.stringify(snap);
    return new Promise<boolean>((resolve) => {
      this.plans.save(this.planId, { days: snap.days, targets: snap.targets, name: snap.name }, this.baseRevision).subscribe({
        next: (saved) => {
          this.saving = false;
          this.baseRevision = saved.revision;
          this.meta.set({ id: saved.id, patientId: saved.patientId, status: saved.status, publications: saved.publications, history: saved.history });
          this.lastSavedAt.set(new Date());
          // Si llegaron cambios mientras se guardaba, se vuelve a programar.
          if (JSON.stringify(this.working()) !== sent) {
            this.persistPending();
            this.saveState.set('dirty');
            this.schedule(400);
            resolve(false);
          } else {
            this.clearPending();
            this.recovered.set(false);
            this.saveState.set('saved');
            resolve(true);
          }
        },
        error: (e: unknown) => {
          this.saving = false;
          if (e instanceof ConflictError) {
            this.remote.set(e.current);
            this.saveState.set('conflict');
          } else {
            this.saveState.set(this.data.isOnline() ? 'error' : 'offline');
          }
          resolve(false);
        },
      });
    });
  }

  retry(): void {
    void this.flush();
  }

  /** Resolución de conflicto: descartar lo local o conservar lo local conscientemente. */
  resolveConflict(choice: 'theirs' | 'mine'): void {
    const remote = this.remote();
    if (!remote) return;
    if (choice === 'theirs') {
      this.baseRevision = remote.revision;
      this.working.set({ days: structuredClone(remote.days), targets: structuredClone(remote.targets), name: remote.name });
      this.clearPending();
      this.undo = [];
      this.redoStack = [];
      this.syncStacks();
      this.saveState.set('saved');
      this.toast.info('Se cargó la versión más reciente. Tus cambios locales se descartaron.');
    } else {
      this.baseRevision = remote.revision;
      this.saveState.set('dirty');
      void this.flush();
      this.toast.info('Tus cambios reemplazaron la versión remota. La anterior queda en el historial del plan.');
    }
    this.remote.set(null);
  }

  /** Recarga desde el almacén después de operaciones del servicio (publicar, sustituir…). */
  reloadFromServer(): void {
    this.load(this.planId);
    this.clearPending();
    this.recovered.set(false);
    this.saveState.set('saved');
  }

  // ---------- Operaciones de calendario (§9.2) ----------
  private findSlot(draft: Snapshot, date: string, slotId: string): PlanSlot | undefined {
    return draft.days.find((d) => d.date === date)?.slots.find((s) => s.id === slotId);
  }

  addItem(date: string, slotId: string, dishId: string, dishVersion: number, index?: number, servings = '1'): void {
    this.mutate((d) => {
      const slot = this.findSlot(d, date, slotId);
      if (!slot) return;
      const item: PlanItem = { id: uuid(), dishId, dishVersion, servings };
      slot.items.splice(index ?? slot.items.length, 0, item);
    });
  }

  /** Reemplaza el platillo en borradores (en planes publicados se usa PlansService.substitute para dejar historial). */
  replaceItem(date: string, slotId: string, itemId: string, dishId: string, dishVersion: number): void {
    this.mutate((d) => {
      const slot = this.findSlot(d, date, slotId);
      const i = slot?.items.findIndex((x) => x.id === itemId) ?? -1;
      if (slot && i >= 0) slot.items[i] = { ...slot.items[i], id: uuid(), dishId, dishVersion };
    });
  }

  moveItem(from: { date: string; slotId: string; index: number }, to: { date: string; slotId: string; index: number }): void {
    this.mutate((d) => {
      const src = this.findSlot(d, from.date, from.slotId);
      const dst = this.findSlot(d, to.date, to.slotId);
      if (!src || !dst) return;
      const [item] = src.items.splice(from.index, 1);
      if (item) dst.items.splice(to.index, 0, item);
    });
  }

  removeItem(date: string, slotId: string, itemId: string): void {
    this.mutate((d) => {
      const slot = this.findSlot(d, date, slotId);
      if (slot) slot.items = slot.items.filter((i) => i.id !== itemId);
    });
  }

  nudge(date: string, slotId: string, itemId: string, dir: -1 | 1): void {
    this.mutate((d) => {
      const slot = this.findSlot(d, date, slotId);
      if (!slot) return;
      const i = slot.items.findIndex((x) => x.id === itemId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= slot.items.length) return;
      [slot.items[i], slot.items[j]] = [slot.items[j], slot.items[i]];
    });
  }

  updateItem(date: string, slotId: string, itemId: string, patch: Partial<Pick<PlanItem, 'servings' | 'instructions' | 'dishVersion'>>): void {
    this.mutate((d) => {
      const it = this.findSlot(d, date, slotId)?.items.find((x) => x.id === itemId);
      if (it) Object.assign(it, patch);
    });
  }

  /** Copia un platillo al mismo tiempo de comida de otros días. */
  copyItemToDays(date: string, slotId: string, itemId: string, targets: string[]): void {
    this.mutate((d) => {
      const src = this.findSlot(d, date, slotId);
      const it = src?.items.find((x) => x.id === itemId);
      if (!src || !it) return;
      for (const t of targets) {
        const slot = d.days.find((x) => x.date === t)?.slots.find((s) => s.name === src.name);
        if (slot) slot.items.push({ ...it, id: uuid() });
      }
    });
  }

  duplicateDay(fromDate: string, targets: string[]): void {
    this.mutate((d) => {
      const src = d.days.find((x) => x.date === fromDate);
      if (!src) return;
      for (const t of targets) {
        const dst = d.days.find((x) => x.date === t);
        if (!dst) continue;
        dst.slots = src.slots.map((s) => ({ id: uuid(), name: s.name, items: s.items.map((i) => ({ ...i, id: uuid() })) }));
        dst.notes = src.notes;
      }
    });
  }

  /** Duplica la semana que inicia en `weekStart` hacia la que inicia en `toStart` (crea días si faltan). */
  duplicateWeek(weekStart: string, toStart: string): void {
    this.mutate((d) => {
      for (let i = 0; i < 7; i++) {
        const src = d.days.find((x) => x.date === addDays(weekStart, i));
        if (!src) continue;
        const date = addDays(toStart, i);
        const copy: PlanDay = { date, notes: src.notes, slots: src.slots.map((s) => ({ id: uuid(), name: s.name, items: s.items.map((it) => ({ ...it, id: uuid() })) })) };
        const at = d.days.findIndex((x) => x.date === date);
        if (at >= 0) d.days[at] = copy;
        else d.days.push(copy);
      }
      d.days.sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  clearDay(date: string): void {
    this.mutate((d) => {
      const day = d.days.find((x) => x.date === date);
      if (day) for (const s of day.slots) s.items = [];
    });
  }

  setDayNotes(date: string, notes: string): void {
    this.mutate((d) => {
      const day = d.days.find((x) => x.date === date);
      if (day) day.notes = notes;
    });
  }

  addSlot(name: string, dates: string[]): void {
    this.mutate((d) => {
      for (const day of d.days) if (dates.includes(day.date) && !day.slots.some((s) => s.name === name)) day.slots.push(newSlot(name));
    });
  }

  removeSlot(date: string, slotId: string): void {
    this.mutate((d) => {
      const day = d.days.find((x) => x.date === date);
      if (day) day.slots = day.slots.filter((s) => s.id !== slotId);
    });
  }

  extendPeriod(count: number): void {
    this.mutate((d) => {
      const last = d.days[d.days.length - 1];
      const names = last ? last.slots.map((s) => s.name) : ['Desayuno', 'Colación matutina', 'Comida', 'Colación vespertina', 'Cena'];
      const start = last ? addDays(last.date, 1) : new Date().toISOString().slice(0, 10);
      for (let i = 0; i < count; i++) d.days.push({ date: addDays(start, i), notes: '', slots: names.map(newSlot) });
    });
  }

  removeLastDay(): void {
    this.mutate((d) => {
      if (d.days.length > 1) d.days.pop();
    });
  }

  setTargets(targets: PlanTargets): void {
    this.mutate((d) => {
      d.targets = { ...targets, version: (d.targets.version ?? 1) + 1 };
    });
  }

  rename(name: string): void {
    this.mutate((d) => {
      d.name = name;
    });
  }
}
