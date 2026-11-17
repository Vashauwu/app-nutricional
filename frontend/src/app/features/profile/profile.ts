import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { ApiError } from '../../core/api/api-client';
import { DbService } from '../../core/data/db.service';
import { SettingsService } from '../../core/services/settings.service';
import { ToastService } from '../../core/services/ui.services';
import { HasUnsavedChanges } from '../../core/guards/unsaved.guard';
import { Icon } from '../../shared/components/icon';
import { PageHeader } from '../../shared/components/page-header';
import { Switch } from '../../shared/components/switch';
import { CareModality, MODALITY_LABEL, PROFESSIONAL_TYPE_LABEL, ProfessionalProfile, ProfessionalType } from '../../shared/models/domain';
import { MX_STATES } from './mx-states';

const MODES: { id: CareModality; hint: string }[] = [
  { id: 'in_person', hint: 'En tu consultorio' }, { id: 'online', hint: 'Por videollamada' }, { id: 'both', hint: 'Consultorio y en línea' },
];

/** «Mi perfil profesional»: lo que ven los pacientes, cómo atiende y su cédula. La marca visual vive en Configuración. */
@Component({
  selector: 'app-profile',
  imports: [PageHeader, TuiButton, Icon, Switch, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .cols { display: grid; gap: var(--space-5); grid-template-columns: minmax(0, 1fr); max-inline-size: 52rem; }
    h2 { font-size: 1.125rem; display: flex; align-items: center; gap: var(--space-2); }
    .modes { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); }
    .modes button { display: grid; text-align: start; padding: var(--space-3); border: 1.5px solid var(--line); border-radius: var(--radius-m); background: var(--surface); color: inherit; font: inherit; cursor: pointer; min-block-size: var(--tap); }
    .modes button[aria-checked='true'] { border-color: var(--brand-ink); background: color-mix(in srgb, var(--brand-secondary) 40%, var(--surface)); }
    .modes small { color: var(--muted); }
    .cmp { display: grid; gap: var(--space-2); }
    .cmp .bar { block-size: .5rem; border-radius: 999px; background: var(--line); overflow: hidden; }
    .cmp .bar i { display: block; block-size: 100%; background: var(--brand-ink); border-radius: inherit; transition: inline-size .3s cubic-bezier(.22, 1, .36, 1); }
    .addr { color: var(--nutri-texto-fuerte); font-weight: 600; margin: 0; }
    .savebar { position: sticky; inset-block-end: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3) 0; background: var(--nutri-marfil); border-block-start: 1px solid var(--line); margin-block-start: var(--space-4); }
    @media (prefers-reduced-motion: reduce) { .cmp .bar i { transition: none; } }
  `,
  template: `
    <section class="page" aria-labelledby="pf-title">
      <app-page-header title="Mi perfil profesional" sub="Lo que ven tus pacientes y cómo trabajas." />

      <section class="panel cmp cols" aria-labelledby="pf-pct">
        <div class="row row--between"><h2 id="pf-pct" class="m-0 u-h2-ui"><app-icon name="check-circle" [size]="20" /> Tu perfil está al {{ pct() }} %</h2>
          <a class="link-btn" routerLink="/configuracion">Logotipo y colores</a></div>
        <div class="bar" role="progressbar" aria-labelledby="pf-pct" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pct()"><i [style.inline-size.%]="pct()"></i></div>
        @if (missing().length) { <p class="dc-sub m-0">Te falta: {{ missing().join(', ') }}.</p> } @else { <p class="dc-sub m-0">Listo: tu perfil está completo.</p> }
      </section>

      <div class="cols">
        <section class="panel stack" aria-labelledby="pf-gen">
          <h2 id="pf-gen" class="m-0 u-h2-ui"><app-icon name="user" [size]="20" /> Información general</h2>
          <div class="field"><label for="pf-name">Nombre completo</label><input id="pf-name" class="input" maxlength="100" autocomplete="name" [value]="f().fullName" (input)="set('fullName', val($event))" />@if (err('full_name')) { <p class="error" role="alert">{{ err('full_name') }}</p> }</div>
          <div class="field"><label for="pf-about">Sobre ti</label><textarea id="pf-about" class="textarea" rows="3" maxlength="250" placeholder="En dos líneas: a quién atiendes y qué te distingue." [value]="f().about" (input)="set('about', val($event))"></textarea><span class="small muted u-end">{{ f().about.length }} / 250 caracteres</span></div>
          <div class="form-grid">
            <div class="field"><label for="pf-spec">Especialidad principal</label><input id="pf-spec" class="input" maxlength="80" placeholder="Ej. Nutrición deportiva" [value]="f().specialty" (input)="set('specialty', val($event))" /></div>
            <div class="field"><label for="pf-clinic">Nombre de la clínica</label><input id="pf-clinic" class="input" maxlength="80" placeholder="Ej. Clínica Sol" [value]="f().clinicName" (input)="set('clinicName', val($event))" /></div>
          </div>
        </section>

        <section class="panel stack" aria-labelledby="pf-id">
          <h2 id="pf-id" class="m-0 u-h2-ui"><app-icon name="clipboard" [size]="20" /> Identidad y contacto</h2>
          <div class="form-grid">
            <div class="field"><label for="pf-type">Tipo de profesional</label>
              <select id="pf-type" class="select" [value]="f().professionalType" (change)="set('professionalType', val($event))">
                <option value="">Elige uno</option>@for (t of types; track t.id) { <option [value]="t.id" [selected]="f().professionalType === t.id">{{ t.label }}</option> }
              </select></div>
            <div class="field"><label for="pf-phone">Teléfono de citas</label><input id="pf-phone" class="input" type="tel" inputmode="tel" maxlength="20" placeholder="55 1234 5678" [value]="f().appointmentPhone" (input)="set('appointmentPhone', val($event))" />@if (err('appointment_phone')) { <p class="error" role="alert">{{ err('appointment_phone') }}</p> } @else { <span class="small muted">Sale en el documento que se lleva tu paciente.</span> }</div>
            <div class="field"><label for="pf-lic">Cédula profesional</label><input id="pf-lic" class="input" inputmode="numeric" maxlength="40" placeholder="########" [value]="license()" (input)="license.set(val($event))" /><span class="small muted">Es lo que un paciente busca para confiar.</span></div>
          </div>
        </section>

        <section class="panel stack" aria-labelledby="pf-where">
          <h2 id="pf-where" class="m-0 u-h2-ui"><app-icon name="target" [size]="20" /> Dónde atiendes</h2>
          <p class="dc-sub m-0">Sale en el pie del documento que se lleva tu paciente.</p>
          <div class="modes" role="radiogroup" aria-label="Modalidad de atención">
            @for (m of modes; track m.id) { <button type="button" role="radio" [attr.aria-checked]="f().modality === m.id" (click)="set('modality', m.id)"><b>{{ label[m.id] }}</b><small>{{ m.hint }}</small></button> }
          </div>
          @if (f().modality !== 'online') {
            <div class="field"><label for="pf-street">Calle y número</label><input id="pf-street" class="input" maxlength="120" placeholder="Av. Reforma 222, int. 3" autocomplete="street-address" [value]="f().street" (input)="set('street', val($event))" /></div>
            <div class="form-grid">
              <div class="field"><label for="pf-col">Colonia</label><input id="pf-col" class="input" maxlength="80" placeholder="Juárez" [value]="f().colony" (input)="set('colony', val($event))" /></div>
              <div class="field"><label for="pf-cp">Código postal</label><input id="pf-cp" class="input" inputmode="numeric" maxlength="5" placeholder="06600" autocomplete="postal-code" [value]="f().postalCode" (input)="set('postalCode', val($event))" />@if (err('postal_code')) { <p class="error" role="alert">{{ err('postal_code') }}</p> }</div>
              <div class="field"><label for="pf-city">Ciudad o alcaldía</label><input id="pf-city" class="input" maxlength="80" placeholder="Cuauhtémoc" [value]="f().city" (input)="set('city', val($event))" /></div>
              <div class="field"><label for="pf-state">Estado</label>
                <select id="pf-state" class="select" [value]="f().state" (change)="set('state', val($event))"><option value="">Elige el estado</option>@for (s of states; track s) { <option [value]="s" [selected]="f().state === s">{{ s }}</option> }</select></div>
            </div>
            <app-switch [checked]="f().showExactAddress" (checkedChange)="set('showExactAddress', $event)">Mostrar la dirección exacta</app-switch>
            <p class="dc-sub m-0">Apágalo si atiendes en tu casa: tus pacientes verán solo la colonia, la ciudad y el estado, y la calle se la das tú al agendar.</p>
            <div><p class="dc-cap m-0">Así la ven tus pacientes</p><p class="addr">{{ addressLine() || 'Escribe tu dirección y aparecerá aquí.' }}</p></div>
          } @else { <p class="dc-sub m-0">Atiendes solo en línea: no hace falta dirección.</p> }
        </section>

        <div class="savebar">
          <span class="small" [class.muted]="!dirty()" role="status">@if (dirty()) { <app-icon name="edit" [size]="16" /> Cambios sin guardar } @else { <app-icon name="check" [size]="16" /> Todo guardado }</span>
          <button tuiButton type="button" size="m" [disabled]="!dirty() || saving()" (click)="save()"><app-icon name="save" [size]="18" /> {{ saving() ? 'Guardando…' : 'Guardar cambios' }}</button>
        </div>
      </div>
    </section>
  `,
})
export class ProfilePage implements HasUnsavedChanges {
  private readonly data = inject(DbService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);

  protected readonly types = (Object.keys(PROFESSIONAL_TYPE_LABEL) as Exclude<ProfessionalType, ''>[]).map((id) => ({ id, label: PROFESSIONAL_TYPE_LABEL[id] }));
  protected readonly modes = MODES;
  protected readonly label = MODALITY_LABEL;
  protected readonly states = MX_STATES;

  private readonly base = signal<ProfessionalProfile>({ ...this.data.db().settings.profile });
  private readonly baseLicense = signal(this.data.db().settings.brand.licenseNumber);
  protected readonly f = signal<ProfessionalProfile>({ ...this.base() });
  protected readonly license = signal(this.baseLicense());
  protected readonly saving = signal(false);
  protected readonly errors = signal<Record<string, string>>({});

  protected readonly dirty = computed(() => JSON.stringify(this.f()) !== JSON.stringify(this.base()) || this.license() !== this.baseLicense());
  hasUnsavedChanges(): boolean { return this.dirty() && !this.saving(); }

  protected readonly addressLine = computed(() => {
    const p = this.f();
    const zone = [p.colony, p.city, p.state].filter(Boolean).join(', ');
    if (p.showExactAddress) return [p.street, p.colony, [p.postalCode, p.city].filter(Boolean).join(' '), p.state].filter(Boolean).join(', ');
    return zone;
  });

  private readonly checks = computed(() => {
    const p = this.f();
    return [
      { ok: !!p.fullName.trim(), label: 'tu nombre' }, { ok: !!p.professionalType, label: 'tipo de profesional' }, { ok: !!p.specialty.trim(), label: 'especialidad' },
      { ok: !!this.license().trim(), label: 'cédula' }, { ok: !!p.appointmentPhone.trim(), label: 'teléfono de citas' }, { ok: !!p.about.trim(), label: 'sobre ti' },
      { ok: p.modality === 'online' || !!(p.colony.trim() && p.city.trim() && p.state), label: 'dónde atiendes' }, { ok: !!this.data.db().settings.brand.logoDataUrl, label: 'logotipo' },
    ];
  });
  protected readonly pct = computed(() => Math.round((this.checks().filter((c) => c.ok).length / this.checks().length) * 100));
  protected readonly missing = computed(() => this.checks().filter((c) => !c.ok).map((c) => c.label));

  protected val(e: Event): string { return (e.target as HTMLInputElement).value; }
  protected err(k: string): string { return this.errors()[k] ?? ''; }
  protected set<K extends keyof ProfessionalProfile>(k: K, v: ProfessionalProfile[K] | string): void { this.f.update((x) => ({ ...x, [k]: v })); }

  protected save(): void {
    this.saving.set(true);
    this.errors.set({});
    const next = { ...this.f(), onboardingDone: true };
    this.settings.saveProfile(next).subscribe({
      next: () => {
        const brand = this.data.db().settings.brand;
        const done = (): void => { this.saving.set(false); this.base.set({ ...next }); this.baseLicense.set(this.license()); this.f.set({ ...next }); this.toast.ok('Perfil guardado.'); };
        if (this.license() === brand.licenseNumber) { done(); return; }
        this.settings.saveBrand({ ...brand, licenseNumber: this.license() }).subscribe({ next: done, error: (e: unknown) => this.fail(e) });
      },
      error: (e: unknown) => this.fail(e),
    });
  }

  private fail(e: unknown): void {
    this.saving.set(false);
    if (e instanceof ApiError && Object.keys(e.fields).length) { this.errors.set(e.fields); this.toast.error('Revisa los datos marcados.'); } else this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
  }
}
