import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { PatientsService } from '../../core/services/patients.service';
import { ToastService } from '../../core/services/ui.services';
import { GOAL_LABEL, Goal, Sex } from '../../shared/models/domain';
import { FieldError, adultValidator } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { InviteLink } from '../../shared/components/invite-link';

@Component({
  selector: 'app-patient-create',
  imports: [ReactiveFormsModule, RouterLink, TuiButton, Icon, FieldError, InviteLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--space-3); border: 0; padding: 0; margin: 0; }
    .mode { display: grid; gap: .25rem; padding: var(--space-4); border: 1.5px solid var(--line); border-radius: var(--radius-m); cursor: pointer; background: var(--surface); }
    .mode:has(input:checked) { border-color: var(--brand-primary); background: var(--brand-secondary); }
    .mode:has(input:focus-visible) { outline: 2px solid var(--brand-primary); outline-offset: 2px; }
    .mode input { position: absolute; opacity: 0; }
    legend { font-weight: 600; margin-block-end: var(--space-2); padding: 0; }
  `,
  template: `
    <div class="page page--narrow">
      <nav class="breadcrumb" aria-label="Migas de pan"><a routerLink="/pacientes">Pacientes</a><app-icon name="chevron-right" [size]="14" /> <span aria-current="page">Nuevo paciente</span></nav>
      <header class="page-header"><div><h1>Nuevo paciente</h1><p class="sub">Solo personas adultas. El expediente clínico se habilita cuando la persona acepta el aviso de privacidad y el consentimiento informado.</p></div></header>

      <form [formGroup]="form" (ngSubmit)="submit()" class="panel" novalidate>
        <fieldset class="modes">
          <legend>¿Cómo quieres darlo de alta?</legend>
          <label class="mode"><input type="radio" formControlName="mode" value="manual" /><strong>Registrar manualmente</strong><span class="small muted">Capturas sus datos en consulta.</span></label>
          <label class="mode"><input type="radio" formControlName="mode" value="invite" /><strong>Enviar invitación</strong><span class="small muted">La persona completa su registro y crea su contraseña.</span></label>
        </fieldset>

        <div class="form-grid">
          <div class="field"><label for="first">Nombre(s)</label><input id="first" class="input" formControlName="firstName" autocomplete="given-name" aria-describedby="first-e" /><app-field-error id="first-e" [control]="form.controls.firstName" /></div>
          <div class="field"><label for="last">Apellidos</label><input id="last" class="input" formControlName="lastName" autocomplete="family-name" aria-describedby="last-e" /><app-field-error id="last-e" [control]="form.controls.lastName" /></div>
          <div class="field"><label for="birth">Fecha de nacimiento</label><input id="birth" class="input" type="date" formControlName="birthDate" aria-describedby="birth-e" /><app-field-error id="birth-e" [control]="form.controls.birthDate" /></div>
          <div class="field"><label for="sex">Sexo</label><select id="sex" class="select" formControlName="sex"><option value="F">Femenino</option><option value="M">Masculino</option><option value="O">Otro</option></select></div>
          <div class="field"><label for="email">Correo electrónico</label><input id="email" class="input" type="email" formControlName="email" autocomplete="email" aria-describedby="email-e" /><app-field-error id="email-e" [control]="form.controls.email" [messages]="{ taken: 'Ya existe un paciente con este correo.' }" /></div>
          <div class="field"><label for="phone">Teléfono</label><input id="phone" class="input" type="tel" formControlName="phone" autocomplete="tel" inputmode="tel" aria-describedby="phone-e" /><app-field-error id="phone-e" [control]="form.controls.phone" [messages]="{ pattern: 'Escribe 10 dígitos (puedes usar espacios o guiones).' }" /></div>
        </div>
        <div class="field" style="max-inline-size: 24rem"><label for="goal">Objetivo nutricional inicial</label><select id="goal" class="select" formControlName="goal">@for (g of goals; track g[0]) { <option [value]="g[0]">{{ g[1] }}</option> }</select></div>

        @if (form.controls.mode.value === 'invite') {
          <div class="callout"><app-icon name="info" /><div class="callout-body"><p>Se envía un enlace de un solo uso (válido 7 días) al correo del paciente para que cree su contraseña y acepte el aviso de privacidad. Si el servidor aún no tiene correo configurado, te mostraremos el enlace para que lo compartas tú. Mientras tanto aparece como <strong>Invitación pendiente</strong>.</p></div></div>
        }

        <div class="form-actions">
          <a tuiButton appearance="secondary" size="m" routerLink="/pacientes">Cancelar</a>
          <button tuiButton type="submit" size="m" [disabled]="saving()">{{ form.controls.mode.value === 'invite' ? 'Crear e invitar' : 'Crear paciente' }}</button>
        </div>
      </form>
      <app-invite-link [link]="createdId() ? link() : null" [who]="shareName()" (closed)="closeLink()" />
    </div>
  `,
})
export class PatientCreate {
  private readonly fb = inject(FormBuilder);
  private readonly patients = inject(PatientsService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly saving = signal(false);
  protected readonly goals = Object.entries(GOAL_LABEL);

  private readonly emailFree = (c: AbstractControl): ValidationErrors | null =>
    c.value && this.patients.emailInUse(c.value) ? { taken: true } : null;

  protected readonly form = this.fb.nonNullable.group({
    mode: ['manual' as 'manual' | 'invite'],
    firstName: ['', [Validators.required, Validators.maxLength(80)]],
    lastName: ['', [Validators.required, Validators.maxLength(80)]],
    birthDate: ['', [Validators.required, adultValidator]],
    sex: ['F' as Sex],
    email: ['', [Validators.required, Validators.email, this.emailFree]],
    phone: ['', [Validators.required, Validators.pattern(/^(?:\D*\d){10}\D*$/)]],
    goal: ['weight_loss' as Goal],
  });

  protected readonly createdId = signal('');
  protected readonly link = computed(() => this.patients.inviteLink());
  protected readonly shareName = computed(() => this.form.controls.firstName.value.trim() || 'la paciente');
  protected closeLink(): void {
    const id = this.createdId();
    this.patients.inviteLink.set(null);
    void this.router.navigate(['/pacientes', id]);
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.saving.set(true);
    const v = this.form.getRawValue();
    this.patients
      .create(
      { firstName: v.firstName.trim(), lastName: v.lastName.trim(), birthDate: v.birthDate, sex: v.sex, email: v.email.trim(), phone: v.phone.trim() },
      v.goal,
      v.mode,
      )
      .subscribe({
        next: (id) => {
          this.toast.ok(v.mode === 'invite' ? 'Invitación creada. El expediente clínico queda restringido hasta aceptar los consentimientos.' : 'Paciente creado. Registra su consentimiento para habilitar el expediente.');
          // Sin correo configurado se muestra el enlace antes de abrir el expediente.
          if (this.patients.inviteLink()) { this.createdId.set(id); this.saving.set(false); return; }
          void this.router.navigate(['/pacientes', id]);
        },
        error: (e: unknown) => {
          this.saving.set(false);
          const err = e as { code?: string; message?: string };
          // Errores del servidor llevados al campo correspondiente (la validación real es del backend).
          if (err.code === 'email_taken') this.form.controls.email.setErrors({ taken: true });
          else if (err.code === 'not_adult') this.form.controls.birthDate.setErrors({ adult: true });
          else this.toast.error(err.message ?? 'No se pudo crear el paciente.');
        },
      });
  }
}
