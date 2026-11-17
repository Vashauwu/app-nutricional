import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { ApiError } from '../../core/api/api-client';
import { BRAND_PALETTES } from '../../core/data/brand-palettes';
import { DbService } from '../../core/data/db.service';
import { SettingsService } from '../../core/services/settings.service';
import { ToastService } from '../../core/services/ui.services';
import { FileDrop } from '../../shared/components/file-drop';
import { Icon } from '../../shared/components/icon';
import { ThemeToggle } from '../../shared/components/theme-toggle';
import { PROFESSIONAL_TYPE_LABEL, ProfessionalType } from '../../shared/models/domain';
import { processImage } from '../../shared/utils/image';

const STEPS = ['Tu cuenta profesional', 'Tu marca'];

/**
 * Inicio guiado de una cuenta nueva: dos pasos con barra de avance y una vista previa en vivo del documento que
 * recibirán los pacientes. Se puede omitir: todo se edita después en «Mi perfil profesional» y en Configuración.
 */
@Component({
  selector: 'app-onboarding',
  imports: [TuiButton, Icon, FileDrop, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; background: var(--nutri-marfil); min-block-size: 100dvh; }
    .wrap { inline-size: min(100% - 2rem, 70rem); margin-inline: auto; padding-block: var(--space-5) var(--space-7); display: grid; gap: var(--space-5); }
    .top { display: grid; gap: var(--space-2); }
    .top .row { justify-content: space-between; }
    .bar { block-size: .5rem; border-radius: 999px; background: var(--line); overflow: hidden; }
    .bar i { display: block; block-size: 100%; background: var(--brand-ink); border-radius: inherit; transition: inline-size .35s cubic-bezier(.22, 1, .36, 1); }
    .grid { display: grid; gap: var(--space-5); grid-template-columns: minmax(0, 1fr); align-items: start; }
    @media (min-width: 62rem) { .grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .pv-wrap { position: sticky; inset-block-start: var(--space-5); } }
    .card { padding: clamp(1.25rem, 3vw, 2rem); display: grid; gap: var(--space-4); }
    h1 { font-family: var(--nutri-font-display); font-size: clamp(1.75rem, 1.3rem + 1.6vw, 2.25rem); color: var(--brand-ink); line-height: 1.15; }
    .sw { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .sw button { inline-size: 2.5rem; block-size: 2.5rem; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1.5px var(--line); cursor: pointer; padding: 0; }
    .sw button[aria-checked='true'] { box-shadow: 0 0 0 3px var(--brand-ink); }
    .actions { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding-block-start: var(--space-4); border-block-start: 1px solid var(--line); }
    .pv-wrap { background: color-mix(in srgb, var(--brand-secondary) 35%, var(--nutri-marfil)); border-radius: var(--radius-l, 1rem); padding: var(--space-5); display: grid; gap: var(--space-3); }
    .pv-wrap > p { margin: 0; text-align: center; }
    .doc { background: #fff; color: #2f2830; border-radius: var(--radius-m); padding: 1.25rem; display: grid; gap: .875rem; box-shadow: 0 12px 28px -14px rgb(0 0 0 / 30%); font-size: .875rem; }
    .doc header { display: flex; gap: .75rem; align-items: center; padding-block-end: .75rem; border-block-end: 2px solid var(--ink); }
    .doc .lg { inline-size: 2.5rem; block-size: 2.5rem; border-radius: .5rem; object-fit: contain; display: grid; place-items: center; background: color-mix(in srgb, var(--ink) 12%, #fff); color: var(--ink); font-weight: 700; flex: none; }
    .doc b { color: var(--ink); } .doc small { color: #6b6270; display: block; }
    .doc .st { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; }
    .doc .st div { background: color-mix(in srgb, var(--ink) 7%, #fff); border-radius: .5rem; padding: .5rem; text-align: center; }
    .doc .st strong { display: block; font-size: 1.0625rem; }
    .doc h2 { font-size: .75rem; letter-spacing: .06em; text-transform: uppercase; color: var(--ink); font-family: var(--nutri-font-ui); border-block-end: 1px solid #e4dde2; padding-block-end: .25rem; }
    .doc .meal { display: flex; justify-content: space-between; gap: .75rem; padding-block: .25rem; border-block-end: 1px solid #f0eaee; }
    .doc .meal span:last-child { color: #6b6270; text-align: end; }
    @media (prefers-reduced-motion: reduce) { .bar i { transition: none; } }
  `,
  template: `
    <main class="wrap" id="contenido" tabindex="-1">
      <div class="top">
        <div class="row"><span id="ob-step">Paso {{ step() }} de 2</span><span class="row"><span>{{ stepName() }}</span><app-theme-toggle /></span></div>
        <div class="bar" role="progressbar" aria-labelledby="ob-step" aria-valuemin="1" aria-valuemax="2" [attr.aria-valuenow]="step()" [attr.aria-valuetext]="'Paso ' + step() + ' de 2: ' + stepName()"><i [style.inline-size.%]="step() * 50"></i></div>
      </div>

      <div class="grid">
        <section class="panel card" [attr.aria-labelledby]="'ob-h' + step()">
          @if (step() === 1) {
            <div><h1 id="ob-h1">Te damos la bienvenida</h1><p class="muted m-0">Vamos a configurar tu cuenta profesional. Son dos pasos y puedes cambiarlo todo después.</p></div>
            <div class="field"><label for="ob-name">Nombre completo</label><input id="ob-name" class="input" maxlength="100" autocomplete="name" [value]="name()" (input)="name.set(val($event))" />@if (showErr() && !name().trim()) { <p class="error" role="alert">Escribe tu nombre.</p> }</div>
            <div class="field"><label for="ob-type">Tipo de profesional</label>
              <select id="ob-type" class="select" [value]="type()" (change)="type.set(val($event))"><option value="">Elige uno</option>@for (t of types; track t.id) { <option [value]="t.id" [selected]="type() === t.id">{{ t.label }}</option> }</select></div>
            <div class="field"><label for="ob-spec">Especialidad principal <span class="muted">(opcional)</span></label><input id="ob-spec" class="input" maxlength="80" placeholder="Ej. Nutrición deportiva" [value]="specialty()" (input)="specialty.set(val($event))" /></div>
            <div class="field"><label for="ob-lic">Cédula profesional <span class="muted">(opcional)</span></label><input id="ob-lic" class="input" inputmode="numeric" maxlength="40" placeholder="########" [value]="license()" (input)="license.set(val($event))" /></div>
          } @else {
            <div><h1 id="ob-h2">Tu marca personal</h1><p class="muted m-0">Así verán tus pacientes tus documentos.</p></div>
            <div class="field"><label for="ob-biz">Nombre de tu consultorio o marca</label><input id="ob-biz" class="input" maxlength="80" placeholder="Ej. Nutrición Sol" [value]="business()" (input)="business.set(val($event))" />@if (showErr() && !business().trim()) { <p class="error" role="alert">Escribe el nombre de tu consultorio.</p> }</div>
            <app-file-drop label="Logotipo (opcional)" hint="PNG con fondo transparente o JPG. Del tamaño nos encargamos." [current]="logo() ?? ''" (picked)="pick($event)" (cleared)="logo.set(undefined)" />
            @if (imgError()) { <p class="error" role="alert">{{ imgError() }}</p> }
            <div class="field"><span id="ob-col" class="label">Color de tu marca</span>
              <div class="sw" role="radiogroup" aria-labelledby="ob-col">@for (p of palettes; track p.id) { <button type="button" role="radio" [attr.aria-checked]="primary() === p.primary" [attr.aria-label]="p.name" [style.background]="p.primary" (click)="primary.set(p.primary)"></button> }</div></div>
          }
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          <div class="actions">
            @if (step() === 1) { <button type="button" class="link-btn" [disabled]="saving()" (click)="skip()">Completar después</button> } @else { <button tuiButton type="button" size="m" appearance="secondary" (click)="step.set(1)"><app-icon name="arrow-left" [size]="18" /> Atrás</button> }
            @if (step() === 1) { <button tuiButton type="button" size="m" (click)="next()">Siguiente <app-icon name="arrow-right" [size]="18" /></button> }
            @else { <button tuiButton type="button" size="m" [disabled]="saving()" (click)="finish()">{{ saving() ? 'Guardando…' : 'Entrar a la plataforma' }} <app-icon name="arrow-right" [size]="18" /></button> }
          </div>
        </section>

        <aside class="pv-wrap" aria-label="Vista previa del documento">
          <p><b>Vista previa del documento</b><br /><span class="small muted">Así se verán tus documentos con tu marca</span></p>
          <div class="doc" [style.--ink]="primary()" aria-hidden="true">
            <header>
              @if (logo()) { <img class="lg" [src]="logo()" alt="" /> } @else { <span class="lg">{{ initial() }}</span> }
              <div><b>{{ business().trim() || 'Nombre de tu consultorio' }}</b><small>{{ name().trim() || 'Tu nombre' }}@if (typeLabel()) { · {{ typeLabel() }} }@if (specialty().trim()) { · {{ specialty().trim() }} }</small></div>
            </header>
            <div><small>Paciente de ejemplo</small><b>María González</b></div>
            <div class="st"><div><small>Peso</small><strong>65.2 kg</strong></div><div><small>IMC</small><strong>22.4</strong></div><div><small>Energía</small><strong>1,800 kcal</strong></div></div>
            <h2>Tus porciones de cada día</h2>
            <div><div class="meal"><span><b>Desayuno</b></span><span>Verduras 1 · Cereales 3</span></div><div class="meal"><span><b>Comida</b></span><span>Verduras 2 · Leguminosas 1</span></div></div>
          </div>
          <p class="small muted">Datos ficticios, solo para que veas el diseño.</p>
        </aside>
      </div>
    </main>
  `,
})
export class Onboarding {
  private readonly data = inject(DbService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly palettes = BRAND_PALETTES;
  protected readonly types = (Object.keys(PROFESSIONAL_TYPE_LABEL) as Exclude<ProfessionalType, ''>[]).map((id) => ({ id, label: PROFESSIONAL_TYPE_LABEL[id] }));
  protected readonly step = signal<1 | 2>(1);
  protected readonly stepName = computed(() => STEPS[this.step() - 1]);

  private readonly s0 = this.data.db().settings;
  protected readonly name = signal(this.s0.profile.fullName);
  protected readonly type = signal<string>(this.s0.profile.professionalType);
  protected readonly specialty = signal(this.s0.profile.specialty);
  protected readonly license = signal(this.s0.brand.licenseNumber);
  protected readonly business = signal(this.s0.brand.businessName === 'Nutrición' ? '' : this.s0.brand.businessName);
  protected readonly logo = signal<string | undefined>(this.s0.brand.logoDataUrl);
  protected readonly primary = signal(this.s0.brand.primary);
  protected readonly showErr = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly imgError = signal('');

  protected readonly initial = computed(() => (this.business().trim()[0] ?? 'N').toUpperCase());
  protected readonly typeLabel = computed(() => PROFESSIONAL_TYPE_LABEL[this.type() as Exclude<ProfessionalType, ''>] ?? '');

  protected val(e: Event): string { return (e.target as HTMLInputElement).value; }

  protected next(): void {
    if (!this.name().trim()) { this.showErr.set(true); document.getElementById('ob-name')?.focus(); return; }
    this.showErr.set(false);
    this.step.set(2);
    queueMicrotask(() => document.getElementById('ob-biz')?.focus());
  }

  protected async pick(f: File): Promise<void> {
    this.imgError.set('');
    try { this.logo.set((await processImage(f, this.s0.storage.maxImageBytes)).dataUrl); } catch (e) { this.imgError.set(e instanceof Error ? e.message : 'No se pudo procesar la imagen.'); }
  }

  private profile(): typeof this.s0.profile {
    return { ...this.data.db().settings.profile, fullName: this.name().trim(), professionalType: this.type() as ProfessionalType, specialty: this.specialty().trim(), onboardingDone: true };
  }

  /** Sale sin llenar nada más: la cuenta queda iniciada y todo se completa después. */
  protected skip(): void {
    this.saving.set(true);
    this.settings.saveProfile({ ...this.data.db().settings.profile, fullName: this.name().trim(), onboardingDone: true }).subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (e: unknown) => { this.saving.set(false); this.error.set(e instanceof Error ? e.message : 'No se pudo guardar.'); },
    });
  }

  protected finish(): void {
    if (!this.business().trim()) { this.showErr.set(true); document.getElementById('ob-biz')?.focus(); return; }
    this.saving.set(true);
    this.error.set('');
    const pal = this.palettes.find((p) => p.primary === this.primary());
    const brand = { ...this.data.db().settings.brand, businessName: this.business().trim(), licenseNumber: this.license().trim(), logoDataUrl: this.logo(), primary: this.primary(), secondary: pal?.secondary ?? this.data.db().settings.brand.secondary };
    this.settings.saveBrand(brand).subscribe({
      next: () => this.settings.saveProfile(this.profile()).subscribe({
        next: () => { this.toast.ok('Tu cuenta está lista.'); void this.router.navigateByUrl('/'); },
        error: (e: unknown) => this.fail(e),
      }),
      error: (e: unknown) => this.fail(e),
    });
  }

  private fail(e: unknown): void {
    this.saving.set(false);
    this.error.set(e instanceof ApiError && Object.values(e.fields).length ? Object.values(e.fields)[0] : e instanceof Error ? e.message : 'No se pudo guardar.');
  }
}
