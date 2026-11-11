import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../auth/auth.service';
import { DbService } from '../data/db.service';
import { PlansService } from '../services/plans.service';
import { CatalogService } from '../services/catalog.service';
import { DishesService } from '../services/dishes.service';
import { SettingsService } from '../services/settings.service';
import { Icon, IconName } from '../../shared/components/icon';
import { ThemeToggle } from '../../shared/components/theme-toggle';
import { initials } from '../../shared/utils/format';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  badge?: () => number;
}

@Component({
  selector: 'app-nutri-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, TuiButton, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shell.scss',
  template: `
    <a class="skip-link" href="#contenido">Saltar al contenido</a>
    <div class="shell" [class.nav-open]="navOpen()">
      <header class="app-topbar">
        <button type="button" class="icon-btn menu-btn" aria-label="Abrir menú" [attr.aria-expanded]="navOpen()" aria-controls="menu-principal" (click)="navOpen.set(!navOpen())">
          <app-icon name="menu" />
        </button>
        <a class="brand" routerLink="/" aria-label="Ir al inicio">
          @if (brand().logoDataUrl) { <img [src]="brand().logoDataUrl" alt="" class="logo" /> } @else { <span class="logo logo--text" aria-hidden="true">{{ brandInitial() }}</span> }
          <span class="brand-name">{{ brand().businessName }}</span>
        </a>
        <span class="grow"></span>
        @if (!data.isOnline()) {
          <span class="badge badge--warn" role="status"><app-icon name="wifi-off" [size]="14" /> Sin conexión</span>
        }
        <app-theme-toggle />
        <div class="user">
          <span class="avatar" aria-hidden="true">{{ userInitials() }}</span>
          <span class="user-name">{{ auth.user()?.name }}</span>
          <button tuiButton type="button" appearance="flat" size="s" (click)="logout()"><app-icon name="log-out" [size]="16" /> Salir</button>
        </div>
      </header>

      <nav class="app-sidebar" id="menu-principal" aria-label="Principal">
        <ul class="list-plain">
          @for (item of items; track item.path) {
            <li>
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }" (click)="navOpen.set(false)">
                <app-icon [name]="item.icon" />
                <span>{{ item.label }}</span>
                @if (item.badge && item.badge() > 0) { <span class="count" [attr.aria-label]="item.badge() + ' pendientes'">{{ item.badge() }}</span> }
              </a>
            </li>
          }
        </ul>
        <p class="foot small muted">Herramienta de apoyo profesional: no sustituye el criterio clínico.</p>
      </nav>
      @if (navOpen()) { <button type="button" class="scrim" aria-label="Cerrar menú" (click)="navOpen.set(false)"></button> }

      <main id="contenido" tabindex="-1"><router-outlet /></main>
    </div>
  `,
})
export class NutriShell {
  protected readonly auth = inject(AuthService);
  protected readonly data = inject(DbService);
  private readonly router = inject(Router);
  private readonly plans = inject(PlansService);
  private readonly catalog = inject(CatalogService);
  private readonly dishes = inject(DishesService);
  private readonly settings = inject(SettingsService);
  protected readonly navOpen = signal(false);
  protected readonly brand = computed(() => this.data.db().settings.brand);
  protected readonly brandInitial = computed(() => this.brand().businessName.trim()[0]?.toUpperCase() ?? 'N');
  protected readonly userInitials = computed(() => initials(...((this.auth.user()?.name ?? 'N').replace(/^Lic\.\s*/, '').split(' ') as [string, string])));
  private readonly toReview = computed(() => this.data.db().tracking.filter((t) => t.needsReview).length);

  protected readonly items: NavItem[] = [
    { path: '/', label: 'Inicio', icon: 'home', exact: true },
    { path: '/pacientes', label: 'Pacientes', icon: 'users' },
    { path: '/platillos', label: 'Platillos', icon: 'dish' },
    { path: '/catalogo', label: 'Catálogo SMAE', icon: 'book' },
    { path: '/planes', label: 'Planes', icon: 'calendar' },
    { path: '/seguimiento', label: 'Seguimiento', icon: 'activity', badge: () => this.toReview() },
    { path: '/reportes', label: 'Reportes', icon: 'chart' },
    { path: '/configuracion', label: 'Configuración', icon: 'settings' },
  ];

  constructor() {
    this.plans.finalizeExpired();
    // Modo API: catálogo y platillos (resumen) disponibles para selectores y planes. En modo simulado no hace nada.
    this.catalog.hydrate().subscribe({ error: () => undefined });
    this.dishes.loadAll().subscribe({ error: () => undefined });
    this.settings.load().subscribe({ error: () => undefined });
    // Al navegar se devuelve el foco al contenido (lectores de pantalla y teclado).
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.navOpen.set(false);
      document.getElementById('contenido')?.focus({ preventScroll: true });
    });
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/ingresar']);
  }
}
