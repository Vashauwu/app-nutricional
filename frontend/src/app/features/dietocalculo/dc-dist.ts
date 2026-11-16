import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { Icon, IconName } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { Badge } from '../../shared/components/ui';
import { DEFAULT_SLOTS, Slot } from './engine';
import { DietoStore, numVal } from './dieto-store';

const THREE: Slot[] = [{ name: 'Desayuno', pct: 30, time: '08:00' }, { name: 'Comida', pct: 40, time: '14:30' }, { name: 'Cena', pct: 30, time: '20:00' }];

/** Ícono de cada tiempo de comida según su nombre. */
export function slotIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (n.includes('desayuno')) return 'sunrise';
  if (n.includes('colaci')) return 'apple';
  if (n.includes('cena')) return 'moon';
  return 'sun';
}

/** Hora «08:00» → «8:00 AM». */
export function fmtTime(t: string | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h)) return t;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m ?? 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Pestaña «Distribución»: equivalentes por tiempo de comida, editables, con lo que falta repartir y el balance de cada tiempo. */
@Component({
  selector: 'app-dc-dist',
  imports: [TuiButton, Icon, Badge, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: var(--space-5); align-content: start; min-inline-size: 0; }
    .cell { max-inline-size: 4.5rem; text-align: center; font-variant-numeric: tabular-nums; }
    tbody th[scope='row'], tfoot th[scope='row'] { background: transparent; text-transform: none; letter-spacing: 0; font-size: inherit; font-weight: 500; white-space: normal; min-inline-size: 9rem; }
    thead th.slot { text-align: center; white-space: normal; min-inline-size: 5.75rem; line-height: 1.25; }
    td.slot { text-align: center; }
    th .sub { display: block; font-weight: 400; font-size: .8125rem; color: var(--muted); }
    tfoot th, tfoot td { font-weight: 700; border-block-start: 2px solid var(--line); }
    .bal { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); }
    .bal .dc-tile h3 { margin: 0; font-size: 1.0625rem; font-family: var(--nutri-font-ui); }
    .gr { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); text-align: center; }
    .gr b { display: block; font-variant-numeric: tabular-nums; }
    .gr .mc { display: grid; gap: .125rem; justify-items: center; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-s); }
  `,
  template: `
    @let res = s.r();
    <section class="panel panel--flush" aria-labelledby="h-matriz">
      <div class="panel-head"><h2 id="h-matriz" class="m-0 u-h2-ui">Equivalentes por tiempo de comida</h2><span class="dc-sub">Escribe los equivalentes de cada tiempo; «Restante» muestra lo que falta repartir.</span></div>
      <div class="table-wrap" role="region" tabindex="0" aria-label="Equivalentes por grupo y tiempo de comida (desplazable)">
        <table class="table table--keep">
          <caption class="visually-hidden">Equivalentes por grupo y tiempo de comida</caption>
          <thead>
            <tr>
              <th scope="col">Equivalente</th><th scope="col" class="num">Total</th><th scope="col" class="num">Restante</th>
              @for (sl of res.distribution; track $index) {
                <th scope="col" class="slot"><app-icon [name]="icon(sl.name)" [size]="16" /> {{ sl.name }}<span class="sub">{{ time(sl.time) }}</span><span class="sub">{{ sl.pct }} %</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of used(); track row.code) {
              <tr>
                <th scope="row">{{ row.name }}</th>
                <td class="num">{{ row.equivalents }}</td>
                <td class="num">@if (rem(row.code) === 0) { <b><app-icon name="check" [size]="14" /> 0<span class="visually-hidden"> (todo repartido)</span></b> } @else { <b><app-icon name="alert" [size]="14" /> {{ rem(row.code) }}<span class="visually-hidden"> (por repartir)</span></b> }</td>
                @for (sl of res.distribution; track $index) {
                  <td class="slot"><input class="input cell" type="number" min="0" step="0.5" [value]="sl.equivalents[row.code] ?? ''" [attr.aria-label]="row.name + ' en ' + sl.name" placeholder="–" (change)="onCell(row.code, $index, $event)" /></td>
                }
              </tr>
            }
          </tbody>
          <tfoot>
            <tr><th scope="row">Totales (eq)</th><td class="num">{{ eqTotal() }}</td><td class="num">{{ restTotal() }}</td>@for (t of slotEq(); track $index) { <td class="slot">{{ t }}</td> }</tr>
            <tr><th scope="row">Energía (kcal)</th><td class="num">{{ res.dietosintetico.totals.kcal }}</td><td></td>@for (sl of res.distribution; track $index) { <td class="slot">{{ sl.totals.kcal }}</td> }</tr>
          </tfoot>
        </table>
      </div>
      <div class="row row--between u-pad-3-4 no-print">
        <div class="row">
          <div class="row" role="group" aria-label="Número de tiempos de comida">
            <button type="button" class="icon-btn" aria-label="Quitar un tiempo" [disabled]="slots().length <= 1" (click)="removeSlot()"><app-icon name="minus" [size]="18" /></button>
            <span aria-live="polite"><b>{{ slots().length }}</b> tiempos</span>
            <button type="button" class="icon-btn" aria-label="Agregar un tiempo" [disabled]="slots().length >= 8" (click)="addSlot()"><app-icon name="plus" [size]="18" /></button>
          </div>
          <div class="dc-seg" role="radiogroup" aria-label="Reparto predefinido">
            <button type="button" role="radio" [attr.aria-checked]="slots().length === 3" (click)="s.setSlots(three())">3 tiempos</button>
            <button type="button" role="radio" [attr.aria-checked]="slots().length === 5" (click)="s.setSlots(five())">5 tiempos</button>
          </div>
          <button tuiButton type="button" size="m" appearance="secondary" (click)="cfgOpen.set(true)"><app-icon name="clock" [size]="18" /> Horarios y metas</button>
        </div>
        <div class="row">
          <button type="button" class="icon-btn" aria-label="Borrar el reparto manual" title="Borrar el reparto manual" [disabled]="!hasOverride()" (click)="s.resetDist()"><app-icon name="refresh" [size]="18" /></button>
          <button tuiButton type="button" size="m" (click)="s.resetDist()"><app-icon name="zap" [size]="18" /> Distribuir tiempos</button>
        </div>
      </div>
    </section>

    <section class="stack" aria-labelledby="h-bal">
      <h2 id="h-bal" class="m-0 u-h2-ui"><app-icon name="activity" [size]="20" /> Balance por tiempo</h2>
      <div class="bal">
        @for (sl of res.distribution; track $index) {
          <article class="dc-tile" [attr.aria-label]="sl.name">
            <div class="t-row"><h3>{{ sl.name }} <span class="dc-sub">{{ time(sl.time) }}</span></h3><app-badge tone="accent">{{ sl.totals.kcal }} kcal</app-badge></div>
            <p class="dc-sub m-0">Meta {{ sl.pct }} % · Real {{ real(sl.totals.kcal) }} %</p>
            <div class="dc-bar" role="img" [attr.aria-label]="'Proteína, lípidos e hidratos de ' + sl.name"><i class="b-p" [style.inline-size.%]="share(sl.totals.protein_g * 4, sl.totals.kcal)"></i><i class="b-l" [style.inline-size.%]="share(sl.totals.lipids_g * 9, sl.totals.kcal)"></i><i class="b-c" [style.inline-size.%]="share(sl.totals.carbs_g * 4, sl.totals.kcal)"></i></div>
            <div class="gr"><span class="mc"><span class="mlab dc-sub"><i class="mdot m-p"></i>PRO</span><b>{{ round(sl.totals.protein_g) }} g</b></span><span class="mc"><span class="mlab dc-sub"><i class="mdot m-l"></i>LIP</span><b>{{ round(sl.totals.lipids_g) }} g</b></span><span class="mc"><span class="mlab dc-sub"><i class="mdot m-c"></i>HCO</span><b>{{ round(sl.totals.carbs_g) }} g</b></span></div>
          </article>
        }
      </div>
    </section>

    <app-modal [(open)]="cfgOpen" title="Horarios y metas" size="normal">
      <div class="stack">
        @for (sl of slots(); track $index) {
          <div class="dc-grid dc-grid--s">
            <div class="field"><label [for]="'sn-' + $index">Tiempo {{ $index + 1 }}</label><input [id]="'sn-' + $index" class="input" maxlength="40" [value]="sl.name" (change)="editSlot($index, { name: str($event) })" /></div>
            <div class="field"><label [for]="'st-' + $index">Hora</label><input [id]="'st-' + $index" class="input" type="time" [value]="sl.time ?? ''" (change)="editSlot($index, { time: str($event) })" /></div>
            <div class="field"><label [for]="'sp-' + $index">% de la energía</label><input [id]="'sp-' + $index" class="input" type="number" min="0" max="100" step="5" [value]="sl.pct" (change)="editSlot($index, { pct: num($event) })" /></div>
          </div>
        }
        <p class="small" [class.error]="!!s.err('slots')" [attr.role]="s.err('slots') ? 'alert' : null">Suma: <strong>{{ pctSum() }} %</strong>@if (s.err('slots')) { · {{ s.err('slots') }} }</p>
      </div>
      <button modalFooter tuiButton type="button" size="m" (click)="cfgOpen.set(false)">Listo</button>
    </app-modal>
  `,
})
export class DcDist {
  protected readonly s = inject(DietoStore);
  protected readonly cfgOpen = signal(false);
  protected readonly slots = this.s.slots;
  protected readonly num = numVal;
  protected readonly icon = slotIcon;
  protected readonly time = fmtTime;

  protected readonly used = computed(() => this.s.r().dietosintetico.rows.filter((r) => r.equivalents > 0));
  protected readonly hasOverride = computed(() => Object.keys(this.s.inp().dist_override ?? {}).length > 0);
  protected readonly pctSum = computed(() => this.slots().reduce((a, x) => a + (Number.isFinite(x.pct) ? x.pct : 0), 0));
  protected readonly slotEq = computed(() => this.s.r().distribution.map((sl) => Object.values(sl.equivalents).reduce((a, x) => a + x, 0)));
  protected readonly eqTotal = computed(() => this.used().reduce((a, r) => a + r.equivalents, 0));
  protected readonly restTotal = computed(() => Math.round(Object.values(this.s.r().distribution_remaining).reduce((a, x) => a + x, 0) * 10) / 10);
  private readonly totalKcal = computed(() => this.s.r().distribution.reduce((a, sl) => a + sl.totals.kcal, 0));

  protected rem(code: string): number { return this.s.r().distribution_remaining[code] ?? 0; }
  protected round(x: number): number { return Math.round(x); }
  protected real(kcal: number): number { const t = this.totalKcal(); return t > 0 ? Math.round((kcal / t) * 100) : 0; }
  protected share(part: number, whole: number): number { return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0; }
  protected str(e: Event): string { return (e.target as HTMLInputElement).value; }

  protected three(): Slot[] { return THREE.map((x) => ({ ...x })); }
  protected five(): Slot[] { return DEFAULT_SLOTS.map((x) => ({ ...x })); }

  protected onCell(code: string, idx: number, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.s.setCell(code, idx, v === '' ? 0 : Number(v));
  }

  protected editSlot(i: number, p: Partial<Slot>): void {
    this.s.setSlots(this.slots().map((x, idx) => (idx === i ? { ...x, ...p } : x)));
  }
  /** Agrega una colación de 5 % tomada del tiempo con más energía. */
  protected addSlot(): void {
    const list = this.slots().map((x) => ({ ...x }));
    const big = list.reduce((m, x, idx) => (x.pct > list[m].pct ? idx : m), 0);
    list[big].pct = Math.max(0, list[big].pct - 5);
    list.push({ name: `Colación ${list.length + 1}`, pct: 5, time: '16:00' });
    this.s.setSlots(list);
  }
  /** Quita el último tiempo y devuelve su % al que más energía tiene. */
  protected removeSlot(): void {
    const list = this.slots().map((x) => ({ ...x }));
    if (list.length <= 1) return;
    const last = list.pop() as Slot;
    const big = list.reduce((m, x, idx) => (x.pct > list[m].pct ? idx : m), 0);
    list[big].pct += last.pct;
    this.s.setSlots(list);
  }
}
