import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../auth/auth.service';
import { DbService } from '../data/db.service';
import { isApiMode } from '../api/api-client';
import { PatientAppApi } from '../api/patient-app-api';
import { SettingsService } from '../services/settings.service';
import { Icon, IconName } from '../../shared/components/icon';
import { ThemeToggle } from '../../shared/components/theme-toggle';
import { formatDateTime } from '../../shared/utils/format';

/** Experiencia móvil de la paciente (PWA, §12). Navegación inferior y estado de conexión visible. */
@Component({
  selector: 'app-patient-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, TuiButton, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-block-size: 100dvh; background: var(--nutri-marfil); }
    header { position: sticky; inset-block-start: 0; z-index: 20; display: flex; align-items: center; gap: .75rem; padding: .625rem 1rem;
      background: color-mix(in srgb, var(--nutri-marfil) 94%, transparent); backdrop-filter: blur(8px); border-block-end: 1px solid var(--line); }
    .logo { inline-size: 2.25rem; block-size: 2.25rem; border-radius: .625rem; background: var(--brand-secondary); display: grid; place-items: center; font-family: var(--nutri-font-display); object-fit: cover; }
    .name { font-weight: 600; line-height: 1.2; } .name small { display: block; font-weight: 400; color: var(--muted); font-size: .75rem; }
    .status { display: flex; align-items: center; gap: .5rem; padding: .5rem 1rem; font-size: .875rem; background: var(--nutri-mantequilla); border-block-end: 1px solid var(--line); }
    main { max-inline-size: 44rem; margin-inline: auto; padding: 1rem 1rem 6.5rem; outline: none; }
    nav { position: fixed; inset-inline: 0; inset-block-end: 0; z-index: 30; background: var(--surface); border-block-start: 1px solid var(--line); padding-block-end: env(safe-area-inset-bottom); }
    nav ul { display: grid; grid-template-columns: repeat(5, 1fr); max-inline-size: 44rem; margin-inline: auto; margin-block: 0; padding: 0; list-style: none; }
    nav a { display: grid; justify-items: center; gap: .125rem; padding: .5rem .25rem; min-block-size: 3.5rem; color: var(--muted); text-decoration: none; font-size: .75rem; font-weight: 500; }
    nav a.active { color: var(--nutri-texto-fuerte); font-weight: 700; } nav a.active app-icon { background: var(--brand-secondary); border-radius: 999px; padding: .15rem .9rem; box-sizing: content-box; }
    @media (min-width: 48rem) { main { padding-block-end: 7rem; } }
  `,
  template: `
    <a class="skip-link" href="#contenido">Saltar al contenido</a>
    <header class="app-topbar">
      @if (brand().logoDataUrl) { <img class="logo" [src]="brand().logoDataUrl" alt="" /> } @else { <span class="logo" aria-hidden="true">{{ brand().businessName.trim()[0] }}</span> }
      <div class="name">{{ brand().businessName }}<small>Hola, {{ firstName() }}</small></div>
      <span class="grow" style="flex: 1"></span>
      <app-theme-toggle />
      <button tuiButton type="button" appearance="flat" size="s" (click)="logout()"><app-icon name="log-out" [size]="16" /> Salir</button>
    </header>
    @if (!data.isOnline()) {
      <div class="status" role="status"><app-icon name="wifi-off" [size]="18" /> <span>Sin conexión. Puedes consultar tu menú; registrar comidas requiere conexión. <strong>Última sincronización: {{ lastSync() }}</strong></span></div>
    }
    <main id="contenido" tabindex="-1"><router-outlet /></main>
    @if (showNav()) {
      <nav class="patient-nav" aria-label="Principal">
        <ul>
          @for (i of items; track i.path) {
            <li><a [routerLink]="i.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: i.exact ?? false }"><app-icon [name]="i.icon" /><span>{{ i.label }}</span></a></li>
          }
        </ul>
      </nav>
    }
  `,
})
export class PatientShell {
  protected readonly auth = inject(AuthService);
  protected readonly data = inject(DbService);
  private readonly router = inject(Router);
  private readonly app = inject(PatientAppApi);
  private readonly settingsSvc = inject(SettingsService);
  protected readonly brand = computed(() => this.data.db().settings.brand);
  protected readonly firstName = computed(() => this.auth.user()?.name.split(' ')[0] ?? '');
  private readonly synced = signal(new Date().toISOString());
  protected readonly lastSync = computed(() => formatDateTime(this.synced()));
  protected readonly showNav = computed(() => this.auth.pendingConsents(this.auth.patientId()).length === 0);

  protected readonly items: { path: string; label: string; icon: IconName; exact?: boolean }[] = [
    { path: '/paciente', label: 'Hoy', icon: 'home', exact: true },
    { path: '/paciente/semana', label: 'Semana', icon: 'calendar' },
    { path: '/paciente/progreso', label: 'Progreso', icon: 'chart' },
    { path: '/paciente/documentos', label: 'Archivos', icon: 'file' },
    { path: '/paciente/perfil', label: 'Perfil', icon: 'user' },
  ];

  constructor() {
    // Modo API: plan vigente, seguimiento, mediciones y documentos de la paciente, desde /me/*.
    if (isApiMode()) {
      this.app.load().subscribe({ error: () => undefined });
      this.settingsSvc.loadBrand().subscribe({ error: () => undefined });
    }
    // Al reconectar (o cuando la nutrióloga cambia el plan) se actualiza la hora de sincronización.
    effect(() => {
      this.data.version();
      if (this.data.isOnline()) this.synced.set(new Date().toISOString());
    });
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/ingresar']);
  }
}
