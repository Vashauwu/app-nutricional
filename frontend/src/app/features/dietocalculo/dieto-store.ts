import { Injectable, computed, signal } from '@angular/core';
import { Tone } from '../../shared/components/ui';
import { DEFAULT_SLOTS, DietInputs, DietResult, Slot, compute, defaultInputs, normalize } from './engine';

export const TONE: Record<string, Tone> = { ok: 'ok', warn: 'warn', critical: 'crit', info: 'info' };

/** Número de un <input>; vacío → NaN (para que la validación lo marque). */
export const numVal = (e: Event): number => { const v = (e.target as HTMLInputElement).value; return v === '' ? NaN : Number(v); };
/** Número opcional de un <input>; vacío → undefined. */
export const optVal = (e: Event): number | undefined => { const v = (e.target as HTMLInputElement).value; return v === '' ? undefined : Number(v); };

/**
 * Estado compartido de una dieta en edición: entradas, resultado vigente y las operaciones que usan las cuatro pestañas.
 * Se provee en el editor (una instancia por dieta abierta).
 */
@Injectable()
export class DietoStore {
  readonly inp = signal<DietInputs>(defaultInputs());
  readonly errors = computed(() => normalize(structuredClone(this.inp())) ?? {});
  readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);
  private last: DietResult | null = null;
  /** Resultado vigente: se recalcula al instante; si los datos son inválidos se conserva el último válido. */
  readonly r = computed<DietResult>(() => {
    if (!this.hasErrors() || !this.last) {
      const c = structuredClone(this.inp());
      normalize(c);
      this.last = compute(c);
    }
    return this.last;
  });
  readonly slots = computed<Slot[]>(() => this.inp().slots?.length ? (this.inp().slots as Slot[]) : DEFAULT_SLOTS);

  patch(p: Partial<DietInputs>): void { this.inp.update((i) => ({ ...i, ...p })); }
  err(k: string): string { return this.errors()[k] ?? ''; }
  set(i: DietInputs): void { this.inp.set(i); }

  // ---------- Macros ----------
  setPercentMacros(c: number, l: number, p: number): void { this.patch({ macros: { carbs_pct: c, lipids_pct: l, protein_pct: p } }); }
  setProteinPerKg(v: number | undefined): void {
    const m = this.inp().macros;
    this.patch({ macros: { ...m, protein_g_per_kg: v, lipids_pct: m.lipids_pct > 0 ? m.lipids_pct : 25 } });
  }

  // ---------- Equivalentes ----------
  setEq(code: string, v: number | null): void {
    const eq = { ...(this.inp().equivalents ?? {}) };
    if (v === null || !Number.isFinite(v)) delete eq[code]; else eq[code] = v;
    this.patch({ equivalents: Object.keys(eq).length ? eq : undefined });
  }
  resetEq(): void { this.patch({ equivalents: undefined }); }
  clearEq(): void {
    const eq: Record<string, number> = {};
    for (const row of this.r().dietosintetico.rows) eq[row.code] = 0;
    this.patch({ equivalents: eq });
  }

  // ---------- Distribución ----------
  setCell(code: string, idx: number, v: number): void {
    const row = this.r().distribution.map((s) => s.equivalents[code] ?? 0);
    row[idx] = Number.isFinite(v) ? Math.max(0, v) : 0;
    this.patch({ dist_override: { ...(this.inp().dist_override ?? {}), [code]: row } });
  }
  resetDist(): void { this.patch({ dist_override: undefined }); }
  setSlots(slots: Slot[]): void { this.patch({ slots, dist_override: undefined }); }
}
