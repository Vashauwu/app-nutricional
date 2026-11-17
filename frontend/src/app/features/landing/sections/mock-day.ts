import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Ilustración del resumen de un día (energía, macros y equivalentes) con datos ficticios. Decorativa. */
@Component({
  selector: 'app-lp-mock-day',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host { display: block; }
    .win { display: grid; gap: .875rem; padding: 1.25rem; border: 1px solid var(--line); border-radius: var(--radius-l, 1rem); background: var(--surface); box-shadow: 0 18px 40px -18px rgb(78 52 76 / 28%); }
    h4 { margin: 0; font-size: 1rem; font-weight: 600; color: var(--nutri-texto-fuerte); display: flex; justify-content: space-between; gap: 1rem; }
    h4 span { font-weight: 400; font-size: .8125rem; color: var(--muted); }
    .row { display: grid; gap: .25rem; }
    .t { display: flex; justify-content: space-between; font-size: .8125rem; font-variant-numeric: tabular-nums; }
    .bar { block-size: .5rem; border-radius: 999px; background: var(--line); overflow: hidden; }
    .bar i { display: block; block-size: 100%; border-radius: inherit; background: var(--brand-ink); }
    .bar i.l { background: color-mix(in srgb, var(--brand-ink) 60%, var(--surface)); }
    .bar i.p { background: color-mix(in srgb, var(--brand-ink) 28%, var(--surface)); }
    .eq { margin: 0; padding: 0; list-style: none; display: grid; }
    .eq li { display: flex; justify-content: space-between; align-items: center; padding-block: .375rem; border-block-start: 1px solid var(--line); font-size: .8125rem; }
    .st { display: inline-flex; align-items: center; gap: .375rem; padding: .0625rem .5rem; border-radius: 999px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .ok { background: var(--nutri-salvia); color: var(--nutri-texto-fuerte); }
    .warn { background: var(--nutri-mantequilla); color: var(--nutri-texto-fuerte); }
    .cap { margin: 0; font-size: .75rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  `,
  template: `
    <div class="win">
      <h4>Lunes 23 de noviembre <span>Resumen del día</span></h4>
      <div class="row"><div class="t"><span>Energía</span><b>1,410 / 1,500 kcal</b></div><div class="bar"><i [style.inline-size.%]="94"></i></div></div>
      <div class="row"><div class="t"><span>Proteínas</span><b>86 / 90 g</b></div><div class="bar"><i class="p" [style.inline-size.%]="96"></i></div></div>
      <div class="row"><div class="t"><span>Carbohidratos</span><b>176 / 190 g</b></div><div class="bar"><i [style.inline-size.%]="93"></i></div></div>
      <div class="row"><div class="t"><span>Lípidos</span><b>45 / 40 g</b></div><div class="bar"><i class="l" [style.inline-size.%]="100"></i></div></div>
      <p class="cap">Equivalentes SMAE · planeado / meta</p>
      <ul class="eq">
        <li><span>Verduras</span><span class="st ok">4 / 4</span></li>
        <li><span>Frutas</span><span class="st warn">1 / 2 · faltan</span></li>
        <li><span>Cereales sin grasa</span><span class="st ok">6 / 6</span></li>
      </ul>
    </div>
  `,
})
export class LpMockDay {}
