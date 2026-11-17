import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Action } from '../landing.content';
import { scrollToAnchor } from '../scroll';

/** Botón de la landing: ruta de la aplicación (`/ingresar`) o ancla de la misma página (`#preguntas`). */
@Component({
  selector: 'app-lp-action',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (action().to.startsWith('#')) {
      <a class="lp-btn" [class.lp-btn--ghost]="action().kind === 'ghost'" [href]="action().to" (click)="go($event)">{{ action().label }}</a>
    } @else {
      <a class="lp-btn" [class.lp-btn--ghost]="action().kind === 'ghost'" [routerLink]="action().to">{{ action().label }}</a>
    }
  `,
})
export class LpAction {
  readonly action = input.required<Action>();

  protected go(e: Event): void {
    e.preventDefault();
    scrollToAnchor(this.action().to.slice(1));
  }
}
