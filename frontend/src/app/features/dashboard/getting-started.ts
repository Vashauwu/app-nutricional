import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { Icon } from '../../shared/components/icon';

const KEY = 'nutri.onboarding.dismissed';

export interface GettingStartedState {
  profileDone: boolean;
  hasPatient: boolean;
  hasPlan: boolean;
}

function dismissed(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/**
 * «Primeros pasos» para una cuenta nueva: guía a la nutrióloga por lo mínimo para empezar a atender.
 * Cada paso se marca solo cuando se cumple; desaparece al completarse todo o si ella la descarta.
 */
@Component({
  selector: 'app-getting-started',
  imports: [RouterLink, TuiButton, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    ol { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
    li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; padding: var(--space-3); border-radius: var(--radius-m); background: var(--surface); border: 1px solid var(--line); }
    li.done { background: transparent; }
    li.done .t { text-decoration: line-through; color: var(--nutri-texto-suave, inherit); opacity: .75; }
    .dot { display: grid; place-items: center; inline-size: 1.75rem; block-size: 1.75rem; border-radius: 50%; border: 2px solid var(--line); font-weight: 700; font-size: .8125rem; }
    li.done .dot { background: var(--nutri-salvia); border-color: var(--nutri-salvia); color: var(--nutri-texto-fuerte); }
    .t { font-weight: 600; margin: 0; } p { margin: 0; }
    .meter { margin-block: var(--space-2); }
  `,
  template: `
    @if (visible()) {
      <section class="panel" aria-labelledby="h-start">
        <div class="panel-head">
          <h2 id="h-start">Primeros pasos</h2>
          <button type="button" class="small" style="background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; color: inherit" (click)="dismiss()">Ocultar</button>
        </div>
        <p class="small muted">{{ doneCount() }} de {{ steps().length }} listos. Con esto tu consulta queda lista para atender.</p>
        <div class="meter" role="img" [attr.aria-label]="doneCount() + ' de ' + steps().length + ' pasos completados'"><span [style.inline-size.%]="(doneCount() / steps().length) * 100"></span></div>
        <ol>
          @for (s of steps(); track s.title; let i = $index) {
            <li [class.done]="s.done">
              <span class="dot" aria-hidden="true">@if (s.done) { <app-icon name="check" [size]="16" /> } @else { {{ i + 1 }} }</span>
              <div><p class="t">{{ s.title }}</p><p class="small muted">{{ s.text }}</p></div>
              @if (s.done) { <span class="visually-hidden">Completado</span> } @else { <a tuiButton size="s" appearance="secondary" [routerLink]="s.link">{{ s.cta }}</a> }
            </li>
          }
        </ol>
      </section>
    }
  `,
})
export class GettingStarted {
  readonly state = input.required<GettingStartedState>();
  private readonly hidden = signal(dismissed());

  protected readonly steps = computed(() => {
    const s = this.state();
    return [
      { title: 'Completa los datos de tu consulta', text: 'Nombre, contacto y logotipo: es lo que verán tus pacientes.', link: '/configuracion', cta: 'Configurar', done: s.profileDone },
      { title: 'Registra a tu primer paciente', text: 'Puedes invitarlo por correo o registrarlo tú misma.', link: '/pacientes/nuevo', cta: 'Crear paciente', done: s.hasPatient },
      { title: 'Crea su plan de alimentación', text: 'Arma el plan con platillos y publícalo para que lo vea.', link: '/planes/nuevo', cta: 'Crear plan', done: s.hasPlan },
    ];
  });
  protected readonly doneCount = computed(() => this.steps().filter((x) => x.done).length);
  protected readonly visible = computed(() => !this.hidden() && this.doneCount() < this.steps().length);

  protected dismiss(): void {
    this.hidden.set(true);
    try { localStorage.setItem(KEY, '1'); } catch { /* sin almacenamiento: se oculta solo en esta visita */ }
  }
}
