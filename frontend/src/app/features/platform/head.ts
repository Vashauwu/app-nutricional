import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Encabezado de pantalla del panel: título pequeño (es una herramienta de trabajo), apoyo y acciones a la derecha. */
@Component({
  selector: 'app-pf-head',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="pf-head">
      <div>
        <ng-content select="[before]" />
        <h1>{{ title() }}</h1>
        @if (sub()) { <p class="sub">{{ sub() }}</p> }
        <ng-content select="[meta]" />
      </div>
      <div class="acts"><ng-content /></div>
    </header>
  `,
})
export class PfHead {
  readonly title = input.required<string>();
  readonly sub = input('');
}
