import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { ConfirmService } from '../../core/services/ui.services';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { Badge, Tone } from '../../shared/components/ui';
import { GROUPS } from './engine';
import { DietoStore, numVal, optVal } from './dieto-store';

interface DietoConfig { step: number; max: Record<string, number> }
const STORE_KEY = 'nutri-dieto-config';
const DEFAULT_MAX: Record<string, number> = { 'CER-SG': 20, LEG: 5 };
const maxOf = (c: DietoConfig, code: string): number => c.max[code] ?? DEFAULT_MAX[code] ?? 10;

function loadConfig(): DietoConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const c = JSON.parse(raw) as DietoConfig; if ((c.step === 0.5 || c.step === 1) && c.max) return c; }
  } catch { /* sin almacenamiento: valores por omisión */ }
  return { step: 0.5, max: {} };
}

// [hidratos, lípidos, proteína]
const PRESETS: [number, number, number][] = [[60, 25, 15], [55, 25, 20], [50, 30, 20], [45, 30, 25]];

/** Pestaña «Dietocálculo»: equivalentes por grupo con deslizadores y el resumen de adecuación contra la meta. */
@Component({
  selector: 'app-dc-dieto',
  imports: [TuiButton, Icon, Badge, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: var(--space-5); align-content: start; min-inline-size: 0; }
    .layout { display: grid; gap: var(--space-5); grid-template-columns: minmax(0, 1fr); align-items: start; }
    @media (min-width: 64rem) { .layout { grid-template-columns: minmax(0, 1fr) 24rem; } .side { position: sticky; inset-block-start: var(--space-4); } }
    .row-g { display: grid; grid-template-columns: minmax(8rem, 11rem) minmax(8rem, 1fr) 5.5rem repeat(4, 3.25rem); gap: var(--space-3); align-items: center; padding: .375rem var(--space-4); border-block-end: 1px solid var(--line); }
    .row-g.head { font-size: .75rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
    .row-g.zero .n { color: var(--muted); }
    .row-g .n { text-align: end; font-variant-numeric: tabular-nums; }
    .row-g.fixed { background: color-mix(in srgb, var(--nutri-lavanda) 30%, transparent); }
    @media (max-width: 47.99rem) {
      .row-g { grid-template-columns: 1fr 5rem; grid-template-areas: 'name num' 'range range' 'vals vals'; }
      .row-g.head { display: none; }
      .row-g .name { grid-area: name; } .row-g .rg { grid-area: range; } .row-g .num { grid-area: num; }
      .row-g .vals { grid-area: vals; display: flex; gap: var(--space-4); font-size: .8125rem; color: var(--muted); }
      .row-g .n { display: none; }
    }
    @media (min-width: 48rem) { .row-g .vals { display: contents; } }
    table.mini { inline-size: 100%; border-collapse: collapse; } table.mini td, table.mini th { padding: .25rem .25rem; white-space: nowrap; }
  `,
  template: `
    @let res = s.r();
    @let d = res.dietosintetico;
    <div class="layout">
      <section class="panel panel--flush" aria-labelledby="h-eqs">
        <div class="panel-head"><h2 id="h-eqs" class="m-0 u-h2-ui">Equivalentes por grupo</h2><span class="dc-sub">Mover un grupo lo fija; los demás se reajustan solos.</span></div>
        <div class="row-g head" aria-hidden="true"><span>Grupo</span><span>Equivalentes</span><span class="n">Eq.</span><span class="n">kcal</span><span class="n">PRO</span><span class="n">LIP</span><span class="n">HCO</span></div>
        @for (row of d.rows; track row.code) {
          <div class="row-g" [class.zero]="row.equivalents === 0" [class.fixed]="row.fixed">
            <span class="name">{{ row.name }}@if (row.fixed) { <app-badge tone="accent">Fijo</app-badge> }</span>
            <span class="rg"><input class="dc-range" type="range" min="0" [max]="max(row.code, row.equivalents)" [step]="cfg().step" [value]="row.equivalents" [attr.aria-label]="'Equivalentes de ' + row.name" (input)="s.setEq(row.code, num($event))" /></span>
            <span class="num"><input class="input dc-num-in" type="number" min="0" [step]="cfg().step" [value]="row.equivalents" [attr.aria-label]="'Número de equivalentes de ' + row.name" (change)="onNum(row.code, $event)" /></span>
            <span class="vals"><span class="n">{{ dash(row.kcal) }}</span><span class="n">{{ dash(row.protein_g) }}</span><span class="n">{{ dash(row.lipids_g) }}</span><span class="n">{{ dash(row.carbs_g) }}</span></span>
          </div>
        }
      </section>

      <aside class="stack side" aria-label="Resumen del cuadro dietosintético">
        <section class="panel stack" aria-labelledby="h-cuadro">
          <div class="row row--between"><h2 id="h-cuadro" class="m-0 u-h2-ui">Cuadro dietosintético</h2><app-badge [tone]="adqTone(kcalPct())">{{ kcalPct() }} %</app-badge></div>
          <div class="field"><label for="f-meta">Calorías totales (meta)</label><div class="dc-unit"><input id="f-meta" class="input" type="number" step="10" [value]="res.energy.prescription_kcal" (change)="s.patch({ kcal_target: opt($event) })" /><span>kcal</span></div></div>
          <div class="dc-pills no-print" role="group" aria-label="Distribuciones habituales (HCO-LIP-PRO)">
            @for (p of presets; track p.join()) { <button type="button" class="dc-pill" (click)="s.setPercentMacros(p[0], p[1], p[2])">{{ p[0] }}-{{ p[1] }}-{{ p[2] }}</button> }
          </div>
          <div class="dc-bar" role="img" [attr.aria-label]="'Proteína ' + res.macros.protein_pct + ' %, lípidos ' + res.macros.lipids_pct + ' %, hidratos ' + res.macros.carbs_pct + ' %'"><i class="b-p" [style.inline-size.%]="res.macros.protein_pct"></i><i class="b-l" [style.inline-size.%]="res.macros.lipids_pct"></i><i class="b-c" [style.inline-size.%]="res.macros.carbs_pct"></i></div>
          <table class="mini">
            <caption class="visually-hidden">Macronutrimentos de la meta</caption>
            <thead><tr><th scope="col" class="small muted">Macro</th><th scope="col" class="small muted">%</th><th scope="col" class="small muted num">kcal</th><th scope="col" class="small muted num">Gramos</th></tr></thead>
            <tbody>
              <tr><th scope="row">HCO</th><td><input class="input dc-num-in" type="number" step="1" aria-label="Hidratos de carbono (%)" [value]="res.macros.carbs_pct" (change)="setPct('carbs_pct', $event)" /></td><td class="num">{{ rnd(res.macros.carbs_g * 4) }}</td><td class="num">{{ res.macros.carbs_g }} g</td></tr>
              <tr><th scope="row">LIP</th><td><input class="input dc-num-in" type="number" step="1" aria-label="Lípidos (%)" [value]="res.macros.lipids_pct" (change)="setPct('lipids_pct', $event)" /></td><td class="num">{{ rnd(res.macros.lipids_g * 9) }}</td><td class="num">{{ res.macros.lipids_g }} g</td></tr>
              <tr><th scope="row">PRO</th><td><input class="input dc-num-in" type="number" step="1" aria-label="Proteína (%)" [value]="res.macros.protein_pct" (change)="setPct('protein_pct', $event)" /></td><td class="num">{{ rnd(res.macros.protein_g * 4) }}</td><td class="num">{{ res.macros.protein_g }} g</td></tr>
            </tbody>
          </table>
          <p class="small" [class.error]="!!s.err('macros')" [attr.role]="s.err('macros') ? 'alert' : null">Suma: <strong>{{ macroSum() }} %</strong>@if (s.err('macros')) { · {{ s.err('macros') }} }</p>

          <h3 class="m-0 t-sm">Resumen de adecuación</h3>
          <table class="mini">
            <caption class="visually-hidden">Meta contra suma de equivalentes</caption>
            <thead><tr><th scope="col"></th><th scope="col" class="small muted num">kcal</th><th scope="col" class="small muted num">PRO</th><th scope="col" class="small muted num">LIP</th><th scope="col" class="small muted num">HCO</th></tr></thead>
            <tbody>
              <tr><th scope="row">Meta</th><td class="num">{{ d.target.kcal }}</td><td class="num">{{ d.target.protein_g }} g</td><td class="num">{{ d.target.lipids_g }} g</td><td class="num">{{ d.target.carbs_g }} g</td></tr>
              <tr><th scope="row">Suma</th><td class="num">{{ d.totals.kcal }}</td><td class="num">{{ d.totals.protein_g }} g</td><td class="num">{{ d.totals.lipids_g }} g</td><td class="num">{{ d.totals.carbs_g }} g</td></tr>
              <tr><th scope="row">%</th>
                @for (c of adq(); track c.k) { <td class="num"><b>@if (c.ok) { <app-icon name="check" [size]="14" /><span class="visually-hidden">Dentro del margen: </span> } @else { <app-icon name="alert" [size]="14" /><span class="visually-hidden">Fuera del margen: </span> }{{ c.pct }} %</b></td> }
              </tr>
            </tbody>
          </table>
          <p class="small" [class.error]="absPct() > 5"><strong>Diferencia:</strong> {{ d.diff_kcal }} kcal ({{ d.diff_pct }} %)@if (absPct() <= 5) { · dentro de ±5 % } @else { · fuera de ±5 % }</p>

          <div class="row no-print">
            <button tuiButton type="button" size="m" appearance="secondary" [disabled]="!hasFixed()" (click)="s.resetEq()"><app-icon name="zap" [size]="18" /> Automático</button>
            <button tuiButton type="button" size="m" appearance="secondary" (click)="clear()"><app-icon name="trash" [size]="18" /> Limpiar</button>
            <button type="button" class="icon-btn" aria-label="Configuración del Dietocálculo" title="Configuración" (click)="cfgOpen.set(true)"><app-icon name="sliders" [size]="20" /></button>
          </div>
        </section>
        @if (res.warnings.length) {
          @for (w of res.warnings; track w.code) { <div class="callout" [class.callout--crit]="w.level === 'critical'" [class.callout--warn]="w.level === 'warn'" role="status"><app-icon [name]="w.level === 'info' ? 'info' : 'alert'" /><div class="callout-body">{{ w.message }}</div></div> }
        }
      </aside>
    </div>

    <app-modal [(open)]="cfgOpen" title="Configuración del Dietocálculo" size="normal">
      <div class="stack">
        <div class="field"><label for="cfg-step">Precisión de los deslizadores (paso)</label>
          <select id="cfg-step" class="select" [value]="cfg().step" (change)="setStep($event)"><option value="0.5">0.5 equivalentes</option><option value="1">1 equivalente</option></select>
        </div>
        <h3 class="m-0 t-sm">Límite máximo por grupo</h3>
        @for (g of groups; track g.code) {
          <div class="row row--between">
            <span id="mx-{{ g.code }}">{{ g.name }}</span>
            <div class="dc-seg" role="radiogroup" [attr.aria-labelledby]="'mx-' + g.code">
              @for (m of maxOptions; track m) { <button type="button" role="radio" [attr.aria-checked]="cfgMax(g.code) === m" (click)="setMax(g.code, m)">{{ m }}</button> }
            </div>
          </div>
        }
      </div>
      <button modalFooter tuiButton type="button" size="m" (click)="cfgOpen.set(false)">Listo</button>
    </app-modal>
  `,
})
export class DcDieto {
  protected readonly s = inject(DietoStore);
  private readonly confirm = inject(ConfirmService);
  protected readonly groups = GROUPS;
  protected readonly presets = PRESETS;
  protected readonly maxOptions = [5, 10, 20, 30];
  protected readonly cfg = signal<DietoConfig>(loadConfig());
  protected readonly cfgOpen = signal(false);
  protected readonly num = numVal;
  protected readonly opt = optVal;

  protected readonly hasFixed = computed(() => Object.keys(this.s.inp().equivalents ?? {}).length > 0);
  protected readonly absPct = computed(() => Math.abs(this.s.r().dietosintetico.diff_pct));
  protected readonly kcalPct = computed(() => { const d = this.s.r().dietosintetico; return d.target.kcal > 0 ? Math.round((d.totals.kcal / d.target.kcal) * 100) : 0; });
  protected readonly adq = computed(() => {
    const d = this.s.r().dietosintetico;
    return ([['kcal', d.totals.kcal, d.target.kcal], ['p', d.totals.protein_g, d.target.protein_g], ['l', d.totals.lipids_g, d.target.lipids_g], ['c', d.totals.carbs_g, d.target.carbs_g]] as [string, number, number][])
      .map(([k, a, b]) => { const pct = this.pct(a, b); return { k, pct, ok: pct >= 95 && pct <= 105 }; });
  });
  protected readonly macroSum = computed(() => { const m = this.s.inp().macros; return Math.round((m.carbs_pct + m.lipids_pct + m.protein_pct) * 10) / 10; });

  protected max(code: string, current: number): number { return Math.max(maxOf(this.cfg(), code), Math.ceil(current)); }
  protected cfgMax(code: string): number { return maxOf(this.cfg(), code); }
  protected dash(v: number): string { return v === 0 ? '–' : String(v); }
  protected rnd(x: number): number { return Math.round(x); }
  protected pct(a: number, b: number): number { return b > 0 ? Math.round((a / b) * 1000) / 10 : 0; }
  protected adqTone(p: number): Tone { return p >= 95 && p <= 105 ? 'ok' : 'warn'; }

  protected onNum(code: string, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.s.setEq(code, v === '' ? null : Number(v));
  }
  protected setPct(k: 'carbs_pct' | 'lipids_pct' | 'protein_pct', e: Event): void {
    const m = this.s.inp().macros;
    this.s.patch({ macros: { carbs_pct: m.carbs_pct || this.s.r().macros.carbs_pct, lipids_pct: m.lipids_pct || this.s.r().macros.lipids_pct, protein_pct: m.protein_pct || this.s.r().macros.protein_pct, [k]: numVal(e) } });
  }
  protected async clear(): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Limpiar el cuadro', message: 'Todos los equivalentes quedan en 0. Puedes volver al cálculo automático con «Automático».', confirmLabel: 'Limpiar', tone: 'danger' }))) return;
    this.s.clearEq();
  }

  // ---------- Configuración (preferencia de este navegador) ----------
  private save(c: DietoConfig): void {
    this.cfg.set(c);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(c)); } catch { /* se conserva en memoria */ }
  }
  protected setStep(e: Event): void { this.save({ ...this.cfg(), step: Number((e.target as HTMLSelectElement).value) }); }
  protected setMax(code: string, m: number): void { this.save({ ...this.cfg(), max: { ...this.cfg().max, [code]: m } }); }
}
