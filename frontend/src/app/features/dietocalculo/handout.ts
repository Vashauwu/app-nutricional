import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BrandSettings } from '../../shared/models/domain';
import { DietInputs, DietResult, GROUPS } from './engine';
import { fmtTime } from './dc-dist';

export type HandoutStyle = 'clasico' | 'minimalista' | 'editorial' | 'amigable';
export const HANDOUT_STYLES: { id: HandoutStyle; name: string; hint: string }[] = [
  { id: 'clasico', name: 'Clásico', hint: 'Títulos con serifa y líneas finas' },
  { id: 'minimalista', name: 'Minimalista', hint: 'Mucho aire, solo lo esencial' },
  { id: 'editorial', name: 'Editorial', hint: 'Cabecera grande, como una revista' },
  { id: 'amigable', name: 'Amigable', hint: 'Bloques redondeados y suaves' },
];

const GOAL_TEXT: Record<DietInputs['goal'], string> = { maintain: 'Mantener tu peso', lose: 'Bajar de peso con salud', gain: 'Ganar masa y peso' };

/**
 * Documento que se lleva el paciente: energía, porciones por tiempo de comida, platillos, indicaciones y suplementación.
 * Es presentacional y se dibuja igual en pantalla (vista previa) que al imprimir o guardar como PDF.
 */
@Component({
  selector: 'app-handout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .ho { --ink: var(--ho-ink, #4e344c); --paper: #fff; --text: #2f2830; --muted: #6b6270; --line: #e4dde2; --soft: color-mix(in srgb, var(--ink) 8%, #fff); box-sizing: border-box; background: var(--paper); color: var(--text); padding: 2.25rem 2.5rem; font-family: var(--nutri-font-ui); font-size: .9375rem; line-height: 1.5; inline-size: 100%; }
    .ho * { box-sizing: border-box; }
    h1, h2, h3, p, ul, ol { margin: 0; }
    header { display: flex; justify-content: space-between; gap: 1.5rem; align-items: flex-start; padding-block-end: .875rem; border-block-end: 2px solid var(--ink); margin-block-end: 1.5rem; }
    .brand { display: flex; gap: .75rem; align-items: center; min-inline-size: 0; }
    .brand img { inline-size: 2.5rem; block-size: 2.5rem; object-fit: contain; border-radius: .5rem; }
    .brand b { display: block; font-size: 1.0625rem; color: var(--ink); }
    .brand span, .meta { font-size: .75rem; color: var(--muted); }
    .meta { text-align: end; white-space: nowrap; }
    .who h1 { font-size: 1.875rem; line-height: 1.15; color: var(--ink); margin-block-end: .25rem; }
    .who p { color: var(--muted); }
    .energy { display: grid; grid-template-columns: auto 1fr; gap: 1.25rem; align-items: center; margin-block: 1.25rem; padding: 1.25rem 1.5rem; background: var(--soft); border-radius: .75rem; }
    .energy .k { font-size: 2.75rem; line-height: 1; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
    .energy .k small { font-size: .9375rem; font-weight: 500; color: var(--muted); margin-inline-start: .25rem; }
    .energy .goal { font-weight: 600; color: var(--ink); }
    .macros { display: flex; flex-wrap: wrap; gap: .25rem 1rem; margin-block-start: .375rem; font-size: .8125rem; color: var(--muted); }
    .macros i { display: inline-block; inline-size: .625rem; block-size: .625rem; border-radius: 50%; margin-inline-end: .375rem; border: 1.5px solid var(--ink); }
    .macros .c { background: var(--ink); } .macros .l { background: color-mix(in srgb, var(--ink) 55%, #fff); } .macros .p { background: color-mix(in srgb, var(--ink) 25%, #fff); }
    h2 { font-size: 1.125rem; color: var(--ink); margin-block: 1.5rem .625rem; }
    .slots { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .slot { break-inside: avoid; padding: .875rem 1rem; border: 1px solid var(--line); border-radius: .625rem; }
    .slot h3 { display: flex; justify-content: space-between; gap: .5rem; font-size: .9375rem; margin-block-end: .375rem; }
    .slot h3 span { font-weight: 400; color: var(--muted); font-size: .8125rem; }
    .slot ul { list-style: none; padding: 0; display: grid; gap: .125rem; }
    .slot li { display: flex; justify-content: space-between; gap: .75rem; font-size: .875rem; }
    .slot li b { font-variant-numeric: tabular-nums; color: var(--ink); }
    .slot .dish { margin-block-start: .5rem; padding-block-start: .5rem; border-block-start: 1px dashed var(--line); font-size: .8125rem; color: var(--muted); }
    .note { white-space: pre-line; }
    table { inline-size: 100%; border-collapse: collapse; font-size: .875rem; }
    th, td { text-align: start; padding: .5rem .625rem; border-block-end: 1px solid var(--line); vertical-align: top; }
    th { font-size: .75rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
    footer { margin-block-start: 2rem; padding-block-start: .75rem; border-block-start: 1px solid var(--line); font-size: .75rem; color: var(--muted); display: grid; gap: .25rem; }
    /* —— Estilos —— */
    .ho--clasico h1, .ho--clasico h2, .ho--clasico .energy .k { font-family: var(--nutri-font-display); }
    .ho--minimalista { font-weight: 400; }
    .ho--minimalista header { border-block-end: 1px solid var(--line); }
    .ho--minimalista .energy { background: transparent; padding-inline: 0; border-block: 1px solid var(--line); border-radius: 0; }
    .ho--minimalista .slot { border: 0; border-block-end: 1px solid var(--line); border-radius: 0; padding-inline: 0; }
    .ho--minimalista h2 { font-size: .8125rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .ho--editorial header { background: var(--ink); color: #fff; margin: -2.25rem -2.5rem 1.75rem; padding: 1.5rem 2.5rem; border: 0; }
    .ho--editorial .brand b, .ho--editorial .brand span, .ho--editorial .meta { color: #fff; opacity: .92; }
    .ho--editorial .who h1 { font-family: var(--nutri-font-display); font-size: 2.5rem; }
    .ho--editorial .energy { background: transparent; padding: 0; border-block-end: 1px solid var(--line); border-radius: 0; padding-block-end: 1.25rem; }
    .ho--editorial h2 { font-family: var(--nutri-font-display); font-size: 1.375rem; border-block-end: 1px solid var(--line); padding-block-end: .375rem; }
    .ho--amigable { background: color-mix(in srgb, var(--ink) 3%, #fff); }
    .ho--amigable header { border: 0; background: var(--soft); border-radius: 1rem; padding: 1rem 1.25rem; }
    .ho--amigable .energy { background: #fff; border: 2px solid var(--soft); border-radius: 1.25rem; }
    .ho--amigable .slot { background: #fff; border: 0; border-radius: 1rem; box-shadow: 0 1px 0 var(--line); }
    .ho--amigable h2 { display: inline-block; background: var(--soft); padding: .25rem .875rem; border-radius: 999px; font-size: .9375rem; }
    @media print { .ho--editorial header { margin: 0 0 1.75rem; } }
    @media (max-width: 40rem) { .ho { padding: 1.25rem; } .slots { grid-template-columns: 1fr; } .energy { grid-template-columns: 1fr; } .ho--editorial header { margin: -1.25rem -1.25rem 1.25rem; padding: 1rem 1.25rem; } .ho--editorial .who h1 { font-size: 1.875rem; } }
  `,
  template: `
    <article class="ho" [class]="'ho ho--' + style()" [style.--ho-ink]="accent()">
      <header>
        <div class="brand">
          @if (brand().logoDataUrl) { <img [src]="brand().logoDataUrl" alt="" /> } @else { <img src="icons/icon-96x96.png" alt="" /> }
          <div><b>{{ brand().businessName }}</b><span>{{ brand().credentials }}@if (brand().licenseNumber) { · Cédula {{ brand().licenseNumber }} }</span></div>
        </div>
        <div class="meta">{{ today() }}</div>
      </header>

      <section class="who">
        <h1>{{ patientName() || 'Tu plan' }}</h1>
        <p>{{ summary() }}</p>
      </section>

      <section class="energy" aria-label="Tu energía diaria">
        <div class="k">{{ res().energy.prescription_kcal }}<small>kcal al día</small></div>
        <div>
          <p class="goal">{{ goal() }}</p>
          <div class="macros">
            <span><i class="c"></i>Hidratos {{ res().macros.carbs_g }} g</span>
            <span><i class="l"></i>Grasas {{ res().macros.lipids_g }} g</span>
            <span><i class="p"></i>Proteína {{ res().macros.protein_g }} g</span>
          </div>
        </div>
      </section>

      <h2>Tus porciones de cada día</h2>
      <div class="slots">
        @for (sl of slots(); track $index) {
          <section class="slot">
            <h3>{{ sl.name }}<span>{{ time(sl.time) }}</span></h3>
            <ul>@for (g of groups; track g.code) { @if (sl.equivalents[g.code]) { <li><span>{{ g.name }}</span><b>{{ sl.equivalents[g.code] }}</b></li> } }</ul>
            @if (menu(sl.name); as m) { <p class="dish">{{ m }}</p> }
          </section>
        }
      </div>

      @if (inp().indications?.trim()) { <h2>Indicaciones</h2><p class="note">{{ inp().indications }}</p> }

      @if (inp().supplements?.length) {
        <h2>Suplementación</h2>
        <table>
          <thead><tr><th scope="col">Suplemento</th><th scope="col">Cuánto</th><th scope="col">Cuándo</th><th scope="col">Cómo</th></tr></thead>
          <tbody>@for (s of inp().supplements; track $index) { <tr><td><b>{{ s.name }}</b></td><td>{{ s.dose }}</td><td>{{ s.when }}</td><td>{{ s.how }}</td></tr> }</tbody>
        </table>
      }

      <footer>
        @if (contact()) { <span>{{ contact() }}</span> }
        <span>Estas porciones son una guía personalizada y no sustituyen la valoración de tu nutriólogo. Ante cualquier duda, consúltalo.</span>
      </footer>
    </article>
  `,
})
export class Handout {
  readonly res = input.required<DietResult>();
  readonly inp = input.required<DietInputs>();
  readonly brand = input.required<BrandSettings>();
  readonly patientName = input('');
  readonly style = input<HandoutStyle>('clasico');
  readonly accent = input('#4e344c');

  protected readonly groups = GROUPS;
  protected readonly time = fmtTime;
  protected readonly slots = computed(() => this.res().distribution.filter((s) => s.pct > 0));
  protected readonly goal = computed(() => GOAL_TEXT[this.inp().goal] ?? '');
  protected readonly today = computed(() => new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }));
  protected readonly summary = computed(() => {
    const i = this.inp();
    return `Plan de alimentación · ${Math.round(i.age)} años · ${i.weight_kg} kg · ${i.height_cm} cm`;
  });
  protected readonly contact = computed(() => [this.brand().phone, this.brand().email, this.brand().address].filter(Boolean).join(' · '));

  protected menu(slot: string): string {
    return (this.inp().menu?.[slot] ?? []).map((x) => `${x.name} (${x.qty_n} ${x.qty ?? 'porción'})`).join(' · ');
  }
}
