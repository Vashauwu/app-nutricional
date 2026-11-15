import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ThemeService, ThemePref } from '../../core/services/theme.service';
import { ActionMenu, MenuItem } from './action-menu';

/** Selector de tema: un menú con tres opciones con nombre (Claro, Oscuro, Sistema), en lugar de un icono que cicla. */
@Component({
  selector: 'app-theme-toggle',
  imports: [ActionMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-action-menu [items]="items()" label="Tema de la aplicación" [icon]="theme.dark() ? 'moon' : 'sun'" />`,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly items = computed<MenuItem[]>(() => {
    const pick = (p: ThemePref) => () => this.theme.set(p);
    const cur = this.theme.pref();
    return [
      { label: 'Claro', icon: 'sun', checked: cur === 'light', run: pick('light') },
      { label: 'Oscuro', icon: 'moon', checked: cur === 'dark', run: pick('dark') },
      { label: 'Igual que el sistema', icon: 'layout', checked: cur === 'system', run: pick('system') },
    ];
  });
}
