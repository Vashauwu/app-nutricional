import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { PatientsService } from '../../core/services/patients.service';
import { PlansService, emptyTargets } from '../../core/services/plans.service';
import { ToastService } from '../../core/services/ui.services';
import { latestMeasurement, proposeTargets } from '../../core/nutrition/engine';
import { PlanTargets } from '../../shared/models/domain';
import { FieldError } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { addDays, ageFrom, diffDays, startOfWeek, todayIso } from '../../shared/utils/format';

const dateOrder = (g: AbstractControl): ValidationErrors | null => {
  const s = g.get('start')?.value as string;
  const e = g.get('end')?.value as string;
  if (!s || !e) return null;
  if (e < s) return { dateOrder: true };
  return diffDays(e, s) > 119 ? { tooLong: true } : null;
};

@Component({
  selector: 'app-plan-create',
  imports: [ReactiveFormsModule, RouterLink, TuiButton, Icon, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .src { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); border: 0; padding: 0; margin: 0; }
    .opt { display: grid; gap: .25rem; padding: var(--space-4); border: 1.5px solid var(--line); border-radius: var(--radius-m); background: var(--surface); cursor: pointer; }
    .opt:has(input:checked) { border-color: var(--brand-primary); background: var(--brand-secondary); }
    .opt:has(input:focus-visible) { outline: 2px solid var(--brand-primary); outline-offset: 2px; }
    .opt input { position: absolute; opacity: 0; }
    legend { font-weight: 600; margin-block-end: var(--space-2); padding: 0; }
  `,
  template: `
    <div class="page page--narrow">
      <nav class="breadcrumb" aria-label="Migas de pan"><a routerLink="/planes">Planes</a><app-icon name="chevron-right" [size]="14" /><span aria-current="page">Nuevo plan</span></nav>
      <header class="page-header"><div><h1>Nuevo plan</h1><p class="sub">Nace como borrador: solo tú lo ves hasta que lo publiques.</p></div></header>

      <form [formGroup]="form" (ngSubmit)="submit()" class="panel" novalidate>
        <div class="form-grid">
          <div class="field"><label for="np-pt">Paciente</label>
            <select id="np-pt" class="select" formControlName="patientId" aria-describedby="np-pt-e"><option value="">Selecciona…</option>@for (p of eligible(); track p.id) { <option [value]="p.id">{{ name(p.id) }}</option> }</select>
            <app-field-error id="np-pt-e" [control]="form.controls.patientId" />
            @if (blocked().length) { <span class="hint">{{ blocked().length }} paciente(s) no aparecen: su consentimiento está pendiente.</span> }</div>
          <div class="field"><label for="np-n">Nombre del plan</label><input id="np-n" class="input" formControlName="name" aria-describedby="np-n-e" /><app-field-error id="np-n-e" [control]="form.controls.name" /></div>
        </div>

        <fieldset class="src"><legend>Duración</legend>
          <label class="opt"><input type="radio" formControlName="mode" value="week" /><strong>Semana completa</strong><span class="small muted">Lunes a domingo</span></label>
          <label class="opt"><input type="radio" formControlName="mode" value="weeks" /><strong>Varias semanas</strong><span class="small muted">2 o 4 semanas seguidas</span></label>
          <label class="opt"><input type="radio" formControlName="mode" value="custom" /><strong>Periodo personalizado</strong><span class="small muted">Elige inicio y término</span></label>
        </fieldset>
        @if (form.controls.mode.value === 'weeks') {
          <div class="field" style="max-inline-size: 14rem"><label for="np-w">Semanas</label><select id="np-w" class="select" formControlName="weeks"><option [value]="2">2 semanas</option><option [value]="3">3 semanas</option><option [value]="4">4 semanas</option></select></div>
        }
        <div class="form-grid">
          <div class="field"><label for="np-s">Fecha de inicio</label><input id="np-s" class="input" type="date" formControlName="start" /></div>
          @if (form.controls.mode.value === 'custom') {
            <div class="field"><label for="np-e">Fecha de término</label><input id="np-e" class="input" type="date" formControlName="end" /></div>
          } @else {
            <div class="field"><span class="label">Término</span><output class="input" style="display: flex; align-items: center">{{ computedEnd() }}</output></div>
          }
        </div>
        @if (form.errors?.['dateOrder']) { <p class="error" role="alert">La fecha de término debe ser posterior al inicio.</p> }
        @if (form.errors?.['tooLong']) { <p class="error" role="alert">El plan no puede durar más de 120 días.</p> }

        <fieldset class="src"><legend>Punto de partida</legend>
          <label class="opt"><input type="radio" formControlName="source" value="blank" /><strong>En blanco</strong><span class="small muted">Armas el menú desde cero</span></label>
          <label class="opt"><input type="radio" formControlName="source" value="template" /><strong>Desde plantilla</strong><span class="small muted">Se copia: será independiente</span></label>
          <label class="opt"><input type="radio" formControlName="source" value="copy" /><strong>Duplicar un plan</strong><span class="small muted">Útil para el siguiente periodo</span></label>
        </fieldset>
        @if (form.controls.source.value === 'template') {
          <div class="field"><label for="np-t">Plantilla</label><select id="np-t" class="select" formControlName="templateId"><option value="">Selecciona…</option>@for (t of templates(); track t.id) { <option [value]="t.id">{{ t.name }} ({{ t.days.length }} día(s))</option> }</select><app-field-error [control]="form.controls.templateId" /></div>
        }
        @if (form.controls.source.value === 'copy') {
          <div class="field"><label for="np-c">Plan a duplicar</label><select id="np-c" class="select" formControlName="copyId"><option value="">Selecciona…</option>@for (p of copyOptions(); track p.id) { <option [value]="p.id">{{ p.name }} — {{ name(p.patientId) }}</option> }</select><app-field-error [control]="form.controls.copyId" /></div>
        }

        <label class="check"><input type="checkbox" formControlName="propose" /><span>Proponer objetivos diarios con las mediciones del paciente <span class="muted small">(orientativo, podrás ajustarlos)</span></span></label>

        <div class="form-actions"><a tuiButton appearance="secondary" size="m" routerLink="/planes">Cancelar</a><button tuiButton type="submit" size="m">Crear y abrir editor</button></div>
      </form>
    </div>
  `,
})
export class PlanCreate implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly plans = inject(PlansService);
  private readonly patients = inject(PatientsService);
  private readonly data = inject(DbService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly paciente = input<string>();
  readonly plantilla = input<string>();
  readonly copiar = input<string>();

  protected readonly eligible = computed(() => this.patients.all().filter((p) => this.patients.consentComplete(p.id)));
  protected readonly blocked = computed(() => this.patients.all().filter((p) => !this.patients.consentComplete(p.id)));
  protected readonly templates = computed(() => this.plans.allTemplates());
  protected readonly copyOptions = computed(() => this.data.db().plans.filter((p) => !p.deletedAt));
  protected name = (id: string): string => this.data.patientName(id);

  protected readonly form = this.fb.nonNullable.group(
    {
      patientId: ['', Validators.required],
      name: ['', [Validators.required, Validators.maxLength(120)]],
      mode: ['week' as 'week' | 'weeks' | 'custom'],
      weeks: [2],
      start: [startOfWeek(addDays(todayIso(), 7)), Validators.required],
      end: [addDays(startOfWeek(addDays(todayIso(), 7)), 6)],
      source: ['blank' as 'blank' | 'template' | 'copy'],
      templateId: [''],
      copyId: [''],
      propose: [true],
    },
    { validators: dateOrder },
  );
  private readonly vals = signal(this.form.getRawValue());
  protected readonly computedEnd = computed(() => {
    const v = this.vals();
    const days = v.mode === 'week' ? 7 : Number(v.weeks) * 7;
    const [y, m, d] = addDays(v.start, days - 1).split('-');
    return `${d}/${m}/${y}`;
  });

  constructor() {
    this.form.valueChanges.subscribe(() => {
      const v = this.form.getRawValue();
      this.vals.set(v);
      this.form.controls.templateId.setValidators(v.source === 'template' ? Validators.required : null);
      this.form.controls.copyId.setValidators(v.source === 'copy' ? Validators.required : null);
      this.form.controls.templateId.updateValueAndValidity({ emitEvent: false });
      this.form.controls.copyId.updateValueAndValidity({ emitEvent: false });
    });
  }

  ngOnInit(): void {
    // Modo API: pacientes, plantillas y (si se copia) el plan de origen se piden al servidor antes de llenar el formulario.
    this.patients.loadAll().subscribe({ error: () => undefined });
    this.plans.loadTemplates().subscribe({ error: () => undefined });
    this.plans.loadAllSummaries().subscribe({ error: () => undefined });
    const copy = this.copiar();
    if (copy) this.plans.load(copy).subscribe({ next: () => this.prefill(), error: () => this.prefill() });
    else this.prefill();
  }

  private prefill(): void {
    const patch: Partial<ReturnType<typeof this.form.getRawValue>> = {};
    if (this.paciente()) patch.patientId = this.paciente();
    if (this.plantilla()) { patch.source = 'template'; patch.templateId = this.plantilla(); }
    if (this.copiar()) {
      const src = this.plans.get(this.copiar()!);
      patch.source = 'copy';
      patch.copyId = this.copiar();
      if (src) {
        patch.patientId = src.patientId;
        patch.name = `${src.name} — siguiente`;
        patch.start = addDays(src.endDate, 1);
        patch.mode = 'custom';
        patch.end = addDays(src.endDate, src.days.length);
      }
    }
    if (Object.keys(patch).length) this.form.patchValue(patch);
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    // Modo API: se necesitan las mediciones del paciente para proponer objetivos.
    this.patients.load(v.patientId).subscribe({ next: () => this.create(v), error: () => this.create(v) });
  }

  private create(v: ReturnType<typeof this.form.getRawValue>): void {
    const end = v.mode === 'custom' ? v.end : addDays(v.start, (v.mode === 'week' ? 7 : Number(v.weeks) * 7) - 1);
    let targets: PlanTargets | undefined;
    const p = this.patients.get(v.patientId);
    const m = p ? latestMeasurement(p.measurements) : undefined;
    if (v.propose && p && m) {
      const r = proposeTargets({ sex: p.profile.sex, age: ageFrom(p.profile.birthDate), weightKg: m.weightKg, heightCm: m.heightCm, goal: p.goal });
      const eq: Record<string, string> = r.equivalentsByCode;
      targets = { energy: r.energy, protein: r.protein, carbs: r.carbs, lipids: r.lipids, equivalents: eq, version: 1 };
    } else if (v.propose && !m) {
      this.toast.info('El paciente no tiene mediciones: se usaron objetivos base editables.');
      targets = emptyTargets();
    }
    this.plans.create({
      patientId: v.patientId, name: v.name, startDate: v.start, endDate: end, targets,
      templateId: v.source === 'template' ? v.templateId : undefined, copyFromPlanId: v.source === 'copy' ? v.copyId : undefined,
    }).subscribe({
      next: (id) => { this.toast.ok('Plan creado como borrador.'); void this.router.navigate(['/planes', id]); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }
}
