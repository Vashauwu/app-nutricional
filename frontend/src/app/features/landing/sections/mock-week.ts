import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Ilustración del calendario semanal con datos ficticios. Es decorativa: el texto que la rodea dice lo mismo. */
@Component({
  selector: 'app-lp-mock-week',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host { display: block; }
    .win { border: 1px solid var(--line); border-radius: var(--radius-l, 1rem); background: var(--surface); box-shadow: 0 18px 40px -18px rgb(78 52 76 / 28%); overflow: hidden; }
    .top { display: flex; align-items: center; gap: .5rem; padding: .75rem 1rem; border-block-end: 1px solid var(--line); font-size: .8125rem; color: var(--muted); }
    .top i { inline-size: .625rem; block-size: .625rem; border-radius: 50%; background: var(--line); }
    .top b { margin-inline-start: auto; color: var(--nutri-texto-fuerte); font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .625rem; padding: .875rem; }
    .day { display: grid; gap: .375rem; align-content: start; padding: .625rem; border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--nutri-marfil); }
    .day h4 { margin: 0; font-size: .8125rem; font-weight: 600; color: var(--nutri-texto-fuerte); }
    .kc { font-size: .75rem; color: var(--muted); font-variant-numeric: tabular-nums; }
    .bar { block-size: .375rem; border-radius: 999px; background: var(--line); overflow: hidden; }
    .bar i { display: block; block-size: 100%; background: var(--brand-ink); border-radius: inherit; }
    .slot { display: grid; gap: .25rem; }
    .slot span { font-size: .6875rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
    .it { padding: .375rem .5rem; border: 1px solid var(--line); border-radius: var(--radius-s); background: var(--surface); font-size: .75rem; line-height: 1.25; color: var(--nutri-texto-fuerte); }
    .it.off { border-style: dashed; color: var(--muted); background: transparent; }
    @media (max-width: 34rem) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .day:nth-child(3) { display: none; } }
  `,
  template: `
    <div class="win">
      <div class="top"><i></i><i></i><i></i><b>Plan semanal de ejemplo</b></div>
      <div class="grid">
        <div class="day"><h4>Lun 23 nov</h4><div class="bar"><i [style.inline-size.%]="94"></i></div><span class="kc">1,410 / 1,500 kcal</span>
          <div class="slot"><span>Desayuno</span><div class="it">Avena con fruta y nueces</div></div>
          <div class="slot"><span>Comida</span><div class="it">Pollo con arroz y verduras</div></div>
          <div class="slot"><span>Cena</span><div class="it off">Suelta un platillo aquí</div></div>
        </div>
        <div class="day"><h4>Mar 24 nov</h4><div class="bar"><i [style.inline-size.%]="71"></i></div><span class="kc">1,065 / 1,500 kcal</span>
          <div class="slot"><span>Desayuno</span><div class="it">Huevo con frijoles</div></div>
          <div class="slot"><span>Comida</span><div class="it">Ensalada de atún</div></div>
          <div class="slot"><span>Cena</span><div class="it">Sopa de verduras</div></div>
        </div>
        <div class="day"><h4>Mié 25 nov</h4><div class="bar"><i [style.inline-size.%]="38"></i></div><span class="kc">570 / 1,500 kcal</span>
          <div class="slot"><span>Desayuno</span><div class="it">Yogur con manzana</div></div>
          <div class="slot"><span>Comida</span><div class="it off">Suelta un platillo aquí</div></div>
          <div class="slot"><span>Cena</span><div class="it off">Suelta un platillo aquí</div></div>
        </div>
      </div>
    </div>
  `,
})
export class LpMockWeek {}
