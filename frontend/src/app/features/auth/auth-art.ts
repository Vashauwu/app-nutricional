import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Composición decorativa de la portada de ingreso y registro: un día de plan y la distribución de macronutrimentos.
 * Es ilustración (aria-hidden), hecha solo con la paleta del sistema, y se adapta sola al tema claro y oscuro.
 */
@Component({
  selector: 'app-auth-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host { display: block; position: relative; inline-size: min(100%, 24rem); block-size: 17.5rem; }
    .card {
      position: absolute;
      padding: 1rem 1.125rem;
      border-radius: 1.25rem;
      background: var(--surface);
      color: var(--nutri-texto);
      box-shadow: 0 1px 2px rgb(40 20 40 / 8%), 0 18px 40px -12px rgb(40 20 40 / 28%);
      animation: rise 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .plan { inset-block-start: 0; inset-inline-start: 0; inline-size: 82%; animation-delay: 0.05s; }
    .macros { inset-block-end: 0; inset-inline-end: 0; inline-size: 66%; animation-delay: 0.25s; }
    h4 { margin: 0 0 0.625rem; font-size: 0.8125rem; font-weight: 600; letter-spacing: 0; color: var(--nutri-texto-suave); }
    .meal { display: grid; grid-template-columns: 0.625rem minmax(0, 1fr) auto; gap: 0.625rem; align-items: center; padding-block: 0.4375rem; font-size: 0.875rem; }
    .meal + .meal { border-block-start: 1px solid var(--nutri-borde); }
    .dot { inline-size: 0.625rem; block-size: 0.625rem; border-radius: 50%; background: var(--c); }
    .meal b { font-weight: 600; }
    .eq { font-size: 0.75rem; font-variant-numeric: tabular-nums; color: var(--nutri-texto-suave); }
    .bar { display: grid; grid-template-columns: 2rem minmax(0, 1fr) 2rem; gap: 0.5rem; align-items: center; font-size: 0.75rem; font-variant-numeric: tabular-nums; padding-block: 0.25rem; }
    .track { block-size: 0.5rem; border-radius: 999px; background: var(--nutri-marfil); overflow: hidden; }
    .fill { display: block; block-size: 100%; border-radius: inherit; background: var(--c); inline-size: var(--w); transform-origin: left; animation: grow 1.1s cubic-bezier(0.16, 1, 0.3, 1) 0.55s both; }
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes grow { from { transform: scaleX(0); } to { transform: none; } }
    @media (prefers-reduced-motion: reduce) { .card, .fill { animation: none; } }
  `,
  template: `
    <div class="card plan">
      <h4>Lunes</h4>
      <div class="meal" style="--c: color-mix(in srgb, var(--nutri-mantequilla) 70%, var(--brand-ink))"><span class="dot"></span><b>Desayuno · Avena con fruta</b><span class="eq">2 · 1</span></div>
      <div class="meal" style="--c: color-mix(in srgb, var(--nutri-salvia) 70%, var(--brand-ink))"><span class="dot"></span><b>Comida · Pollo con verduras</b><span class="eq">3 · 2</span></div>
      <div class="meal" style="--c: color-mix(in srgb, var(--nutri-lavanda) 70%, var(--brand-ink))"><span class="dot"></span><b>Cena · Ensalada con atún</b><span class="eq">2 · 3</span></div>
    </div>
    <div class="card macros">
      <h4>Distribución</h4>
      <div class="bar"><span>HCO</span><span class="track"><span class="fill" style="--w: 55%; --c: color-mix(in srgb, var(--nutri-lavanda) 60%, var(--brand-ink))"></span></span><span>55</span></div>
      <div class="bar"><span>LIP</span><span class="track"><span class="fill" style="--w: 25%; --c: color-mix(in srgb, var(--nutri-rosa) 60%, var(--brand-ink))"></span></span><span>25</span></div>
      <div class="bar"><span>PRO</span><span class="track"><span class="fill" style="--w: 20%; --c: color-mix(in srgb, var(--nutri-salvia) 60%, var(--brand-ink))"></span></span><span>20</span></div>
    </div>
  `,
})
export class AuthArt {}
