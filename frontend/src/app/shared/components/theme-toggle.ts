import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';
import { Icon } from './icon';

const LABEL = { system: 'Sistema', light: 'Claro', dark: 'Oscuro' } as const;

@Component({
  selector: 'app-theme-toggle',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="icon-btn" [attr.aria-label]="'Tema: ' + label() + '. Cambiar tema'" [title]="'Tema: ' + label()" (click)="theme.cycle()">
      <app-icon [name]="icon()" />
    </button>
    <span class="visually-hidden" role="status">Tema {{ label() }}</span>
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly label = computed(() => LABEL[this.theme.pref()]);
  protected readonly icon = computed(() => (this.theme.pref() === 'system' ? 'layout' : this.theme.pref() === 'light' ? 'sun' : 'moon'));
}
