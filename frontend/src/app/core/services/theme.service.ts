import { Injectable, effect, inject, signal } from '@angular/core';
import { TUI_DARK_MODE } from '@taiga-ui/core';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'nutri-theme';

/**
 * Tema claro/oscuro. Por defecto sigue el sistema; la elección se recuerda en el
 * dispositivo (preferencia de interfaz, no un dato clínico). Un script en index.html
 * aplica el tema antes de Angular para evitar el parpadeo.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly tuiDark = inject(TUI_DARK_MODE);
  readonly pref = signal<ThemePref>(this.read());
  readonly dark = signal(false);

  constructor() {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const system = signal(mq.matches);
    mq.addEventListener('change', (e) => system.set(e.matches));
    effect(() => {
      const isDark = this.pref() === 'dark' || (this.pref() === 'system' && system());
      this.dark.set(isDark);
      document.documentElement.dataset['theme'] = isDark ? 'dark' : 'light';
      this.tuiDark.set(isDark);
      document.getElementById('app-favicon')?.setAttribute('href', `icons/favicon-${isDark ? 'dark' : 'light'}.png`);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#1D181F' : '#FAF7F2');
    });
  }

  private read(): ThemePref {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  }

  set(p: ThemePref): void {
    this.pref.set(p);
    try {
      if (p === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      /* sin almacenamiento: el cambio vale para esta sesión */
    }
  }

  cycle(): void {
    this.set(this.pref() === 'system' ? 'light' : this.pref() === 'light' ? 'dark' : 'system');
  }
}
