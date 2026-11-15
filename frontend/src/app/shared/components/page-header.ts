import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Encabezado de página: título, apoyo y acciones. Regla del sistema: UNA acción primaria; el resto va
 * como secundaria o dentro de un menú «Más» (app-action-menu). Las acciones se proyectan al final.
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <div class="heading">
        <h1>{{ title() }}</h1>
        @if (sub()) { <p class="sub">{{ sub() }}</p> }
        <ng-content select="[heading]" />
      </div>
      <div class="actions"><ng-content /></div>
    </header>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly sub = input('');
}
