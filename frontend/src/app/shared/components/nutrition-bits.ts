import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DbService } from '../../core/data/db.service';
import { MetricComparison } from '../../core/nutrition/engine';
import { EquivalentsMap, Nutrients } from '../models/domain';
import { fmtCompact } from '../utils/format';
import { Icon, IconName } from './icon';

/** Energía y macros en una línea compacta; siempre con etiqueta textual. */
@Component({
  selector: 'app-macros',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-flex; flex-wrap: wrap; gap: .25rem .75rem; font-size: .8125rem; font-variant-numeric: tabular-nums; }
    b { font-weight: 600; }
    span { white-space: nowrap; }
  `,
  template: `
    <span><b>{{ f(n().energy) }}</b> kcal</span>
    <span>P <b>{{ f(n().protein, 1) }}</b> g</span>
    <span>C <b>{{ f(n().carbs, 1) }}</b> g</span>
    <span>L <b>{{ f(n().lipids, 1) }}</b> g</span>
  `,
})
export class Macros {
  readonly n = input.required<Nutrients>();
  protected readonly f = fmtCompact;
}

@Component({
  selector: 'app-eq-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `:host { display: flex; flex-wrap: wrap; gap: .375rem; } .badge { font-weight: 500; }`,
  template: `
    @for (e of entries(); track e.code) {
      <span class="badge" [class]="'badge tone-' + e.tone" [title]="e.name">{{ e.short }} <b>{{ e.value }}</b></span>
    } @empty {
      <span class="small muted">Sin equivalentes SMAE</span>
    }
  `,
})
export class EqChips {
  private readonly data = inject(DbService);
  readonly eq = input.required<EquivalentsMap>();
  protected readonly entries = computed(() =>
    Object.entries(this.eq())
      .filter(([, v]) => Number(v) > 0)
      .map(([code, v]) => ({
        code,
        name: this.data.subgroupName(code),
        short: code,
        tone: this.data.groupOfSubgroup(code)?.tone ?? 'lavanda',
        value: fmtCompact(v, 1),
      })),
  );
}

const CATEGORY_ICON: Record<string, IconName> = { Desayuno: 'leaf', Comida: 'dish', Cena: 'dish', Colación: 'heart', Guarnición: 'leaf' };
const CATEGORY_TONE: Record<string, string> = { Desayuno: 'mantequilla', Comida: 'salvia', Cena: 'lavanda', Colación: 'rosa', Guarnición: 'cielo' };

/** Miniatura del platillo: fotografía si existe; si no, una superficie pastel por categoría. */
@Component({
  selector: 'app-dish-thumb',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .t { display: grid; place-items: center; inline-size: 100%; aspect-ratio: 4 / 3; border-radius: var(--radius-s); color: var(--nutri-texto-fuerte); overflow: hidden; }
    img { inline-size: 100%; block-size: 100%; object-fit: cover; }
  `,
  template: `
    <div class="t" [class]="'t tone-' + tone()">
      @if (src()) { <img [src]="src()" [alt]="alt()" loading="lazy" /> } @else { <app-icon [name]="icon()" [size]="size()" /> }
    </div>
  `,
})
export class DishThumb {
  readonly category = input('Comida');
  readonly src = input<string | undefined>(undefined);
  readonly alt = input('');
  readonly size = input(32);
  protected readonly icon = computed(() => CATEGORY_ICON[this.category()] ?? 'dish');
  protected readonly tone = computed(() => CATEGORY_TONE[this.category()] ?? 'salvia');
}

/** Barra de comparación planeado vs objetivo con texto, no solo color (§20.1). */
@Component({
  selector: 'app-compare-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: .25rem; }
    .top { display: flex; justify-content: space-between; gap: .5rem; font-size: .875rem; }
    .st { font-size: .8125rem; font-weight: 600; }
    .meter > span.over { background: var(--danger); } .meter > span.under { background: var(--warn); } .meter > span.ok { background: var(--ok); }
  `,
  template: `
    <div class="top"><span>{{ m().label }}</span><span class="mono"><b>{{ f(m().planned, 1) }}</b> / {{ f(m().target, 1) }} {{ m().unit }}</span></div>
    <div class="meter" role="img" [attr.aria-label]="m().label + ': ' + status()"><span [class]="m().status" [style.inline-size.%]="width()"></span></div>
    <span class="st" [style.color]="color()">{{ status() }}</span>
  `,
})
export class CompareRow {
  readonly m = input.required<MetricComparison>();
  protected readonly f = fmtCompact;
  protected readonly width = computed(() => {
    const t = Number(this.m().target);
    return t > 0 ? Math.min(100, (Number(this.m().planned) / t) * 100) : 0;
  });
  protected readonly status = computed(() => {
    const m = this.m();
    if (m.status === 'none') return 'Sin objetivo';
    if (m.status === 'ok') return 'Dentro de la tolerancia';
    const d = Math.abs(Number(m.diff));
    const dd = d >= 10 ? d.toFixed(0) : d.toFixed(1);
    return m.status === 'over' ? `${dd} ${m.unit} por encima` : `${dd} ${m.unit} por debajo`;
  });
  protected readonly color = computed(() => (this.m().status === 'ok' ? 'var(--ok)' : this.m().status === 'over' ? 'var(--danger)' : this.m().status === 'under' ? 'var(--warn)' : 'var(--nutri-texto-suave)'));
}
