import { ChangeDetectionStrategy, Component, model } from '@angular/core';

/** Interruptor accesible (role="switch"): el texto va como contenido y es la etiqueta. */
@Component({
  selector: 'app-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-flex; }
    label { display: inline-flex; align-items: center; gap: .625rem; min-block-size: var(--tap); cursor: pointer; }
    input { position: absolute; opacity: 0; inline-size: 1px; block-size: 1px; }
    .track { position: relative; flex: none; inline-size: 2.5rem; block-size: 1.5rem; border-radius: 999px; background: transparent;
      border: 2px solid color-mix(in srgb, var(--nutri-texto) 60%, var(--surface)); transition: background .15s, border-color .15s; }
    .track::after { content: ''; position: absolute; inset-block-start: 50%; inset-inline-start: .15rem; inline-size: .875rem; block-size: .875rem; border-radius: 50%;
      background: color-mix(in srgb, var(--nutri-texto) 60%, var(--surface)); transform: translateY(-50%); transition: transform .15s, background .15s; }
    input:checked + .track { background: var(--brand-ink); border-color: var(--brand-ink); }
    input:checked + .track::after { background: var(--surface); transform: translate(1rem, -50%); }
    input:focus-visible + .track { outline: 2px solid var(--brand-ink); outline-offset: 2px; }
    input:disabled + .track { opacity: .5; }
    @media (prefers-reduced-motion: reduce) { .track, .track::after { transition: none; } }
  `,
  template: `<label><input type="checkbox" role="switch" [checked]="checked()" (change)="onChange($event)" /><span class="track" aria-hidden="true"></span><span><ng-content /></span></label>`,
})
export class Switch {
  readonly checked = model(false);
  protected onChange(e: Event): void { this.checked.set((e.target as HTMLInputElement).checked); }
}
