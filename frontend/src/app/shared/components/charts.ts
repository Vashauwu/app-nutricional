import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatDate, shortDate } from '../utils/format';

export interface LinePoint {
  date: string;
  value: number;
}

export interface LineSeries {
  label: string;
  color?: string;
  points: LinePoint[];
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const DASH = ['', '6 4', '2 4', '10 3 2 3'];

/**
 * Gráfica de líneas en SVG (solo presentación: los cálculos nutricionales usan
 * decimal.js, §7.3). Cada serie se distingue por color Y trazo, y hay una tabla
 * equivalente para lectores de pantalla (§20.1).
 */
@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    svg { inline-size: 100%; block-size: auto; overflow: visible; }
    .grid { stroke: var(--nutri-borde); stroke-width: 1; }
    text { font-size: 11px; fill: var(--nutri-texto-suave); font-family: var(--nutri-font-ui); }
    .legend { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin-block-start: .5rem; font-size: .875rem; }
    .legend span { display: inline-flex; align-items: center; gap: .4rem; }
    .legend svg { inline-size: 24px; block-size: 8px; }
  `,
  template: `
    <figure style="margin: 0">
      <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" role="img" [attr.aria-label]="title()">
        @for (t of yTicks(); track t.y) {
          <line class="grid" [attr.x1]="padL" [attr.x2]="w - padR" [attr.y1]="t.y" [attr.y2]="t.y" />
          <text [attr.x]="padL - 8" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
        }
        @for (t of xTicks(); track t.x) {
          <text [attr.x]="t.x" [attr.y]="h - 8" text-anchor="middle">{{ t.label }}</text>
        }
        @for (s of drawn(); track s.label; let i = $index) {
          <path [attr.d]="s.path" fill="none" [attr.stroke]="s.color" stroke-width="2.5" [attr.stroke-dasharray]="s.dash" stroke-linejoin="round" stroke-linecap="round" />
          @for (p of s.pts; track p.date) {
            <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4" [attr.fill]="s.color" stroke="var(--surface)" stroke-width="1.5"><title>{{ s.label }}: {{ p.value }} {{ unit() }} · {{ p.dateLabel }}</title></circle>
          }
        }
      </svg>
      @if (series().length > 1) {
        <figcaption class="legend">
          @for (s of drawn(); track s.label) {
            <span><svg viewBox="0 0 24 8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" [attr.stroke]="s.color" stroke-width="3" [attr.stroke-dasharray]="s.dash" /></svg>{{ s.label }}</span>
          }
        </figcaption>
      }
      <table class="visually-hidden">
        <caption>{{ title() }}</caption>
        <thead><tr><th>Fecha</th>@for (s of series(); track s.label) { <th>{{ s.label }} ({{ unit() }})</th> }</tr></thead>
        <tbody>
          @for (d of allDates(); track d) {
            <tr><td>{{ fmt(d) }}</td>@for (s of series(); track s.label) { <td>{{ valueAt(s, d) }}</td> }</tr>
          }
        </tbody>
      </table>
    </figure>
  `,
})
export class LineChart {
  readonly series = input.required<LineSeries[]>();
  readonly unit = input('');
  readonly title = input('Gráfica de evolución');
  readonly yMin = input<number | null>(null);
  readonly yMax = input<number | null>(null);

  protected readonly w = 640;
  protected readonly h = 260;
  protected readonly padL = 44;
  protected readonly padR = 16;
  private readonly padT = 12;
  private readonly padB = 30;

  protected readonly allDates = computed(() => [...new Set(this.series().flatMap((s) => s.points.map((p) => p.date)))].sort());
  protected readonly fmt = formatDate;

  private readonly bounds = computed(() => {
    const vals = this.series().flatMap((s) => s.points.map((p) => p.value));
    if (!vals.length) return { min: 0, max: 1 };
    let min = this.yMin() ?? Math.min(...vals);
    let max = this.yMax() ?? Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.12;
    return { min: this.yMin() ?? min - pad, max: this.yMax() ?? max + pad };
  });

  private readonly xOf = computed(() => {
    const dates = this.allDates();
    const first = dates.length ? new Date(dates[0]).getTime() : 0;
    const last = dates.length ? new Date(dates[dates.length - 1]).getTime() : 1;
    const span = Math.max(last - first, 1);
    return (d: string): number =>
      dates.length <= 1 ? (this.w + this.padL - this.padR) / 2 : this.padL + ((new Date(d).getTime() - first) / span) * (this.w - this.padL - this.padR);
  });

  private yOf(v: number): number {
    const { min, max } = this.bounds();
    return this.padT + (1 - (v - min) / (max - min)) * (this.h - this.padT - this.padB);
  }

  protected readonly yTicks = computed(() => {
    const { min, max } = this.bounds();
    return Array.from({ length: 5 }, (_, i) => {
      const v = min + ((max - min) * i) / 4;
      return { y: this.yOf(v), label: v.toFixed(Math.abs(max - min) < 10 ? 1 : 0) };
    });
  });

  protected readonly xTicks = computed(() => {
    const dates = this.allDates();
    const step = Math.max(1, Math.ceil(dates.length / 6));
    return dates.filter((_, i) => i % step === 0).map((d) => ({ x: this.xOf()(d), label: shortDate(d) }));
  });

  protected readonly drawn = computed(() =>
    this.series().map((s, i) => {
      const pts = [...s.points].sort((a, b) => a.date.localeCompare(b.date)).map((p) => ({ ...p, x: this.xOf()(p.date), y: this.yOf(p.value), dateLabel: formatDate(p.date) }));
      return {
        label: s.label,
        color: s.color ?? COLORS[i % COLORS.length],
        dash: DASH[i % DASH.length],
        pts,
        path: pts.map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
      };
    }),
  );

  protected valueAt(s: LineSeries, date: string): string {
    const p = s.points.find((x) => x.date === date);
    return p ? String(p.value) : '—';
  }
}

export interface BarDatum {
  label: string;
  a: number;
  b?: number;
}

@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    svg { inline-size: 100%; block-size: auto; }
    .grid { stroke: var(--nutri-borde); }
    text { font-size: 11px; fill: var(--nutri-texto-suave); font-family: var(--nutri-font-ui); }
    .legend { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin-block-start: .5rem; font-size: .875rem; }
    .sw { display: inline-block; inline-size: .9rem; block-size: .9rem; border-radius: 3px; vertical-align: -2px; margin-inline-end: .35rem; }
  `,
  template: `
    <figure style="margin: 0">
      <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" role="img" [attr.aria-label]="title()">
        @for (t of ticks(); track t.y) {
          <line class="grid" [attr.x1]="padL" [attr.x2]="w - 8" [attr.y1]="t.y" [attr.y2]="t.y" />
          <text [attr.x]="padL - 6" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
        }
        @for (b of bars(); track b.label) {
          <rect [attr.x]="b.xa" [attr.y]="b.ya" [attr.width]="b.bw" [attr.height]="b.ha" fill="var(--chart-soft)" stroke="var(--chart-1)" stroke-width="1.5" rx="2"><title>{{ aLabel() }} · {{ b.label }}: {{ b.a }}</title></rect>
          @if (b.hb !== null) {
            <rect [attr.x]="b.xb" [attr.y]="b.yb" [attr.width]="b.bw" [attr.height]="b.hb" fill="var(--chart-1)" rx="2"><title>{{ bLabel() }} · {{ b.label }}: {{ b.b }}</title></rect>
          }
          <text [attr.x]="b.cx" [attr.y]="h - 8" text-anchor="middle">{{ b.label }}</text>
        }
      </svg>
      <figcaption class="legend">
        <span><i class="sw" style="background:var(--chart-soft);border:1.5px solid var(--chart-1)"></i>{{ aLabel() }}</span>
        @if (bLabel()) { <span><i class="sw" style="background:var(--chart-1)"></i>{{ bLabel() }}</span> }
      </figcaption>
    </figure>
  `,
})
export class BarChart {
  readonly data = input.required<BarDatum[]>();
  readonly aLabel = input('Planeado');
  readonly bLabel = input('');
  readonly title = input('Gráfica de barras');
  protected readonly w = 640;
  protected readonly h = 240;
  protected readonly padL = 44;

  private readonly max = computed(() => Math.max(1, ...this.data().flatMap((d) => [d.a, d.b ?? 0])) * 1.1);
  private y(v: number): number {
    return 10 + (1 - v / this.max()) * (this.h - 40);
  }
  protected readonly ticks = computed(() => Array.from({ length: 5 }, (_, i) => { const v = (this.max() * i) / 4; return { y: this.y(v), label: Math.round(v).toString() }; }));
  protected readonly bars = computed(() => {
    const n = this.data().length;
    const slot = (this.w - this.padL - 8) / Math.max(n, 1);
    const bw = Math.min(26, slot / 2.6);
    return this.data().map((d, i) => {
      const cx = this.padL + slot * i + slot / 2;
      const hasB = d.b !== undefined;
      const xa = hasB ? cx - bw - 1 : cx - bw / 2;
      return {
        label: d.label, a: d.a, b: d.b, cx, bw,
        xa, ya: this.y(d.a), ha: this.y(0) - this.y(d.a),
        xb: cx + 1, yb: this.y(d.b ?? 0), hb: hasB ? this.y(0) - this.y(d.b ?? 0) : null,
      };
    });
  });
}

@Component({
  selector: 'app-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-grid; place-items: center; position: relative; }
    .c { position: absolute; display: grid; text-align: center; line-height: 1.1; }
    .c strong { font-family: var(--nutri-font-display); font-size: 1.5rem; }
    .c span { font-size: .75rem; color: var(--nutri-texto-suave); }
  `,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 100 100" role="img" [attr.aria-label]="label() + ': ' + pct() + ' %'">
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--nutri-borde)" stroke-width="10" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--brand-primary)" stroke-width="10" stroke-linecap="round" [attr.stroke-dasharray]="dash()" transform="rotate(-90 50 50)" />
    </svg>
    <div class="c"><strong>{{ pct() }}%</strong><span>{{ label() }}</span></div>
  `,
})
export class Ring {
  readonly pct = input.required<number>();
  readonly label = input('');
  readonly size = input(120);
  protected readonly dash = computed(() => {
    const c = 2 * Math.PI * 42;
    return `${(Math.max(0, Math.min(100, this.pct())) / 100) * c} ${c}`;
  });
}
