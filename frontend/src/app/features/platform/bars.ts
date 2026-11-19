import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { fd } from './labels';

export interface Bar { day: string; total: number }

/**
 * Conteos por día. Son cifras discretas (casi siempre 0, 1, 2…), así que se dibujan como barras y no como una línea que
 * inventa una pendiente entre días. Eje de enteros, hoy resaltado y una tabla equivalente para lectores de pantalla.
 * La entrada de las barras es el único movimiento del panel: se anima una vez y se respeta «reducir movimiento».
 */
@Component({
  selector: 'app-pf-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .plot { position: relative; padding-inline-start: 1.75rem; }
    .y { position: absolute; inset-inline-start: 0; font-size: 0.75rem; color: var(--nutri-texto-suave); font-variant-numeric: tabular-nums; line-height: 1; }
    .y.top { inset-block-start: 0; } .y.zero { inset-block-end: 0; }
    .cols { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; align-items: end; gap: 3px; block-size: 8rem; border-block-end: 1px solid var(--nutri-borde); background: linear-gradient(to bottom, var(--nutri-borde) 1px, transparent 1px) top / 100% 100% no-repeat; }
    .col { block-size: max(calc(var(--h) * 100%), 3px); background: color-mix(in srgb, var(--brand-ink) 62%, transparent); border-radius: 2px 2px 0 0; transform-origin: bottom; animation: rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards; animation-delay: calc(var(--i) * 14ms); }
    .col.zero { background: var(--nutri-borde); }
    .col.today { background: var(--brand-ink); }
    .x { display: flex; justify-content: space-between; margin-block-start: 0.375rem; padding-inline-start: 1.75rem; font-size: 0.75rem; color: var(--nutri-texto-suave); }
    @keyframes rise { from { transform: scaleY(0); } }
    @media (prefers-reduced-motion: reduce) { .col { animation: none; } }
    .sr { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
  `,
  template: `
    <figure style="margin:0">
      <div class="plot">
        <span class="y top" aria-hidden="true">{{ max() }}</span><span class="y zero" aria-hidden="true">0</span>
        <div class="cols" role="img" [attr.aria-label]="label()">
          @for (d of data(); track d.day; let i = $index) {
            <span class="col" [class.zero]="d.total === 0" [class.today]="i === data().length - 1" [style.--h]="d.total / max()" [style.--i]="i" [attr.title]="fd(d.day) + ': ' + d.total"></span>
          }
        </div>
      </div>
      <div class="x" aria-hidden="true"><span>{{ fd(first()) }}</span><span>{{ fd(mid()) }}</span><span>hoy</span></div>
      <div class="sr"><table><caption>{{ label() }}</caption><thead><tr><th>Día</th><th>Altas</th></tr></thead>
        <tbody>@for (d of data(); track d.day) { <tr><td>{{ fd(d.day) }}</td><td>{{ d.total }}</td></tr> }</tbody></table></div>
    </figure>
  `,
})
export class PfBars {
  readonly data = input.required<Bar[]>();
  readonly label = input('Altas por día');
  protected readonly fd = fd;
  protected readonly max = computed(() => Math.max(2, ...this.data().map((d) => d.total)));
  protected readonly first = computed(() => this.data()[0]?.day ?? '');
  protected readonly mid = computed(() => this.data()[Math.floor(this.data().length / 2)]?.day ?? '');
}
