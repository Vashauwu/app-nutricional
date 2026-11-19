import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { DbService } from '../data/db.service';
import { PlansService } from '../services/plans.service';
import { CatalogService } from '../services/catalog.service';
import { DishesService } from '../services/dishes.service';
import { PlatformService } from '../services/platform.service';
import { SettingsService } from '../services/settings.service';
import { ThemeService } from '../services/theme.service';
import { ActionMenu, MenuItem } from '../../shared/components/action-menu';
import { CommandPalette, CommandPaletteService } from '../../shared/components/command-palette';
import { Icon, IconName } from '../../shared/components/icon';
import { ThemeToggle } from '../../shared/components/theme-toggle';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  badge?: () => number;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const RAIL_KEY = 'nutri-rail';

@Component({
  selector: 'app-nutri-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, ThemeToggle, ActionMenu, CommandPalette],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shell.scss',
  template: `
    <a class="skip-link" href="#contenido">Saltar al contenido</a>
    <div class="shell" [class.nav-open]="navOpen()" [class.rail]="rail()">
      <header class="app-topbar">
        <button type="button" class="icon-btn menu-btn" aria-label="Abrir menú" [attr.aria-expanded]="navOpen()" aria-controls="menu-principal" (click)="navOpen.set(!navOpen())">
          <app-icon name="menu" />
        </button>
        <a class="brand" routerLink="/" aria-label="Ir al inicio">
          @if (brand().logoDataUrl) { <img [src]="brand().logoDataUrl" alt="" class="logo" /> } @else { <img class="logo logo--default" src="icons/icon-96x96.png" alt="" width="36" height="36" /> }
          <span class="brand-name">{{ brand().businessName }}</span>
        </a>
        <button type="button" class="search-btn" (click)="palette.open()" aria-label="Buscar en toda la aplicación">
          <app-icon name="search" [size]="18" /><span class="search-text">Buscar paciente, plan o platillo</span><kbd>{{ shortcut }}</kbd>
        </button>
        <span class="grow"></span>
        @if (!data.isOnline()) {
          <span class="badge badge--warn" role="status"><app-icon name="wifi-off" [size]="14" /> Sin conexión</span>
        }
        <app-theme-toggle />
        <app-action-menu class="user-menu" [items]="userMenu()" label="Menú de la cuenta" [text]="firstName()" icon="user" />
      </header>

      <nav class="app-sidebar" id="menu-principal" aria-label="Principal">
        <div class="side-head">
          <button type="button" class="burger" (click)="toggleRail()" [attr.aria-expanded]="!rail()" aria-controls="menu-principal" [attr.aria-label]="rail() ? 'Expandir menú lateral' : 'Contraer menú lateral'" [attr.title]="rail() ? 'Expandir menú' : 'Contraer menú'">
            <span class="bars" aria-hidden="true"></span>
          </button>
          <a class="side-brand" routerLink="/" aria-label="Ir al inicio">
            @if (brand().logoDataUrl) { <img [src]="brand().logoDataUrl" alt="" class="logo" /> } @else { <img class="logo logo--default" src="icons/icon-96x96.png" alt="" width="36" height="36" /> }
            <span class="label">{{ brand().businessName }}</span>
          </a>
        </div>
        @for (g of groups(); track g.title) {
          <div class="group" role="group" [attr.aria-label]="g.title || 'General'">
            @if (g.title) { <p class="group-title label">{{ g.title }}</p> }
            <ul class="list-plain">
              @for (item of g.items; track item.path) {
                <li>
                  <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }" (click)="navOpen.set(false)" [attr.title]="rail() ? item.label : null">
                    <app-icon [name]="item.icon" />
                    <span class="label">{{ item.label }}</span>
                    @if (item.badge && item.badge() > 0) { <span class="count" [attr.aria-label]="item.badge() + ' pendientes'">{{ item.badge() }}</span> }
                  </a>
                </li>
              }
            </ul>
          </div>
        }
        <div class="side-foot">
          <ul class="list-plain">
            @if (auth.apiMode) {
              <li>
                <a routerLink="/facturacion" routerLinkActive="active" (click)="navOpen.set(false)" [attr.title]="rail() ? 'Facturación' : null"><app-icon name="gem" /><span class="label">Facturación</span></a>
              </li>
            }
            <li>
              <a routerLink="/configuracion" routerLinkActive="active" (click)="navOpen.set(false)" [attr.title]="rail() ? 'Configuración' : null"><app-icon name="settings" /><span class="label">Configuración</span></a>
            </li>
          </ul>
          <p class="foot small muted label">Herramienta de apoyo profesional: no sustituye el criterio clínico.</p>
        </div>
      </nav>
      @if (navOpen()) { <button type="button" class="scrim" aria-label="Cerrar menú" (click)="navOpen.set(false)"></button> }

      <main id="contenido" tabindex="-1"><router-outlet /></main>
    </div>
    <app-command-palette />
  `,
})
export class NutriShell {
  protected readonly auth = inject(AuthService);
  protected readonly data = inject(DbService);
  protected readonly palette = inject(CommandPaletteService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly plans = inject(PlansService);
  private readonly catalog = inject(CatalogService);
  private readonly platform = inject(PlatformService);
  private readonly dishes = inject(DishesService);
  private readonly settings = inject(SettingsService);
  protected readonly navOpen = signal(false);
  private readonly railPref = signal(this.readRail());
  /** Modo enfoque: en el editor de un plan el menú se contrae solo para dar ancho al calendario. */
  private readonly focusMode = signal(false);
  protected readonly rail = computed(() => this.railPref() || this.focusMode());
  protected readonly shortcut = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl K';
  protected readonly brand = computed(() => this.data.db().settings.brand);
  protected readonly brandInitial = computed(() => this.brand().businessName.trim()[0]?.toUpperCase() ?? 'N');
  protected readonly firstName = computed(() => (this.auth.user()?.name ?? 'Cuenta').replace(/^Lic\.\s*/, '').split(' ')[0]);
  private readonly toReview = computed(() => this.data.db().tracking.filter((t) => t.needsReview).length);

  protected readonly userMenu = computed<MenuItem[]>(() => [
    { label: 'Mi perfil profesional', icon: 'user', run: () => void this.router.navigateByUrl('/perfil') },
    ...(this.auth.can('platform:read') ? [{ label: 'Panel de plataforma', icon: 'layout' as const, run: () => void this.router.navigateByUrl('/plataforma') }] : []),
    ...(this.auth.apiMode ? [{ label: 'Facturación y plan', icon: 'gem' as const, run: () => void this.router.navigateByUrl('/facturacion') }] : []),
    { label: 'Tablas cómodas', icon: 'list', checked: this.theme.density() === 'comfortable', run: () => this.theme.setDensity('comfortable') },
    { label: 'Tablas compactas', icon: 'list', checked: this.theme.density() === 'compact', run: () => this.theme.setDensity('compact') },
    { label: 'Salir', icon: 'log-out', separator: true, run: () => this.logout() },
  ]);

  // Agrupación por tarea (≤ 4 elementos por grupo): la clínica, la biblioteca y el análisis.
  protected readonly groups = computed<NavGroup[]>(() => [
    { title: '', items: [{ path: '/', label: 'Inicio', icon: 'home', exact: true }] },
    {
      title: 'Clínica',
      items: [
        { path: '/pacientes', label: 'Pacientes', icon: 'users' },
        { path: '/consultas', label: 'Consultas', icon: 'clock' },
        { path: '/planes', label: 'Planes', icon: 'calendar' },
        { path: '/dietocalculo', label: 'Dietocálculo', icon: 'scale' },
        { path: '/seguimiento', label: 'Seguimiento', icon: 'activity', badge: () => this.toReview() },
      ],
    },
    {
      title: 'Biblioteca',
      items: [
        { path: '/platillos', label: 'Platillos', icon: 'dish' },
        { path: '/catalogo', label: this.platform.smaeEnabled() ? 'Catálogo SMAE' : 'Mis alimentos', icon: 'book' },
      ],
    },
    { title: 'Análisis', items: [{ path: '/reportes', label: 'Reportes', icon: 'chart' }] },
  ]);

  constructor() {
    this.plans.finalizeExpired();
    this.platform.load();
    // Modo API: catálogo y platillos (resumen) disponibles para selectores y planes. En modo simulado no hace nada.
    this.catalog.hydrate().subscribe({ error: () => undefined });
    this.dishes.loadAll().subscribe({ error: () => undefined });
    // Una cuenta nueva empieza por el inicio guiado (el servidor dice si ya lo hizo).
    this.settings.load().subscribe({ error: () => undefined, complete: () => { if (!this.data.db().settings.profile.onboardingDone) void this.router.navigateByUrl('/bienvenida'); } });
    this.focusMode.set(this.isEditor(this.router.url));
    // Al navegar se devuelve el foco al contenido (lectores de pantalla y teclado).
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.navOpen.set(false);
      this.focusMode.set(this.isEditor((e as NavigationEnd).urlAfterRedirects));
      document.getElementById('contenido')?.focus({ preventScroll: true });
    });
  }

  private isEditor(url: string): boolean {
    return /^\/planes\/(?!nuevo)[^/?#]+/.test(url);
  }

  private readRail(): boolean {
    try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
  }

  protected toggleRail(): void {
    const v = !this.railPref();
    this.railPref.set(v);
    try { localStorage.setItem(RAIL_KEY, v ? '1' : '0'); } catch { /* solo esta sesión */ }
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/ingresar']);
  }
}
