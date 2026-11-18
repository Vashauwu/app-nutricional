import { ChangeDetectionStrategy, Component, OnInit, ViewEncapsulation, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiButton } from '@taiga-ui/core/components/button';
import { PlatformApi } from '../../core/api/platform-api';
import { Icon, IconName } from '../../shared/components/icon';
import { ThemeToggle } from '../../shared/components/theme-toggle';
import { PfStyles } from './styles-host';

interface Item { path: string; label: string; icon: IconName; exact?: boolean; badge?: () => number }

/**
 * Marco del panel de plataforma. Es una zona aparte de la consulta: mismo sistema visual (marfil, ciruela, Inter y
 * Playfair), pero con su propio menú y una marca que dice dónde estás, para no confundir esta operación con la de una cuenta.
 */
@Component({
  selector: 'app-platform-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TuiAppearance, TuiButton, TuiBadge, Icon, ThemeToggle, PfStyles],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './platform.scss',
  encapsulation: ViewEncapsulation.None,
  template: `
    <app-pf-styles />
    <a class="skip-link" href="#panel">Saltar al contenido</a>
    <div class="frame">
      <header>
        <a class="brand" routerLink="/plataforma" aria-label="Panel de plataforma">
          <img src="icons/icon-96x96.png" alt="" width="32" height="32" />
          <span class="name">Nutrición Integral</span>
        </a>
        <span tuiBadge tuiAppearance="neutral" size="m">Plataforma</span>
        @if (env) { <span tuiBadge [tuiAppearance]="env.tone" size="m">{{ env.label }}</span> }
        <span class="grow"></span>
        <app-theme-toggle />
        <a tuiButton appearance="secondary" size="s" routerLink="/" class="back"><app-icon name="arrow-left" [size]="16" /> <span class="lbl">Mi consulta</span></a>
      </header>
      <nav aria-label="Plataforma">
        <ul>
          @for (i of items; track i.path) {
            <li>
              <a [routerLink]="i.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!i.exact }">
                <app-icon [name]="i.icon" /> <span>{{ i.label }}</span>
                @if (i.badge && i.badge() > 0) { <span class="count" tuiBadge tuiAppearance="warning" size="s" [attr.aria-label]="i.badge() + ' pendientes'">{{ i.badge() }}</span> }
              </a>
            </li>
          }
        </ul>
        <p class="hint foot">Operación interna: cada cambio queda en la bitácora de la cuenta.</p>
      </nav>
      <main id="panel" tabindex="-1"><div class="inner"><router-outlet /></div></main>
    </div>
  `,
})
export class PlatformShell implements OnInit {
  private readonly api = inject(PlatformApi);
  /** Nombre del ambiente según el dominio, para no confundir staging con producción. */
  protected readonly env: { label: string; tone: string } | null = typeof location === 'undefined' ? null
    : location.hostname.startsWith('staging') ? { label: 'Staging', tone: 'warning' }
    : /^(localhost|127\.)/.test(location.hostname) ? { label: 'Local', tone: 'info' }
    : { label: 'Producción', tone: 'negative' };
  protected readonly items: Item[] = [
    { path: '/plataforma', label: 'Resumen', icon: 'layout', exact: true },
    { path: '/plataforma/cuentas', label: 'Cuentas', icon: 'users' },
    { path: '/plataforma/aprobaciones', label: 'Aprobaciones', icon: 'shield', badge: () => this.api.pending() },
  ];

  ngOnInit(): void {
    this.api.overview().subscribe({ error: () => undefined });
  }
}
