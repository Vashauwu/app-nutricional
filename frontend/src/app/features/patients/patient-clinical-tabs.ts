import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AbstractControl, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TuiButton } from '@taiga-ui/core';
import { PatientsService } from '../../core/services/patients.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { computeBmi, latestMeasurement } from '../../core/nutrition/engine';
import { Allergy, COMPOSITION_FIELDS, Condition, FoodPreference, GIRTH_FIELDS, GIRTH_GROUPS, Measurement, Medication, PREFERENCE_LABEL, Patient, PreferenceType } from '../../shared/models/domain';
import { FieldError, decimalValidator } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { ReproductiveCard } from './patient-reproductive';
import { Modal } from '../../shared/components/modal';
import { LineChart, LineSeries } from '../../shared/components/charts';
import { Badge, EmptyState } from '../../shared/components/ui';
import { downloadBlob, formatDate, todayIso, toCsv } from '../../shared/utils/format';

const range = (min: number, max: number) => (c: AbstractControl): ValidationErrors | null => {
  const v = String(c.value ?? '').trim();
  if (!v) return null;
  const n = Number(v);
  return n < min || n > max ? { range: { min, max } } : null;
};

const RANGE_MSG = (label: string, min: number, max: number): Record<string, string> => ({ range: `${label} fuera de rango habitual (${min}–${max}). Verifica el dato.` });

// ---------- Antropometría (§3.2) ----------
@Component({
  selector: 'app-measurements-tab',
  imports: [ReactiveFormsModule, TuiButton, Icon, Modal, LineChart, EmptyState, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .link-btn { white-space: nowrap; }
    .metric-pick { max-inline-size: 22rem; margin-block-end: var(--space-3); }
    .sum { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-6); margin: 0 0 var(--space-5); }
    .sum div { display: grid; }
    .sum dt { font-size: .75rem; color: var(--muted); } .sum dd { margin: 0; font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .dsec { margin: var(--space-5) 0 var(--space-2); font-size: .75rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
    .dsec:first-of-type { margin-block-start: 0; }
    .kv { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr)); gap: 0 var(--space-6); margin: 0; }
    .kv div { display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
    .kv dt { font-size: .875rem; } .kv dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; flex: none; }
    .n { display: inline-flex; justify-content: flex-end; white-space: nowrap; }
    .n .f { inline-size: 3ch; text-align: start; }
    .u { display: inline-block; inline-size: 2.4ch; text-align: start; margin-inline-start: .25ch; color: var(--muted); font-weight: 500; font-size: .875em; }
    .lt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: var(--space-5) var(--space-8, 2rem); align-items: start; }
    .lt { inline-size: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    .lt th, .lt td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
    .lt thead th { font-size: .75rem; font-weight: 600; color: var(--muted); text-align: center; }
    .lt tbody th[scope=row] { text-align: start; font-weight: 500; font-size: .875rem; }
    .lt td { text-align: center; font-weight: 600; }
    .lt .n { justify-content: center; }
    .lt thead th.part { text-align: start; font-size: .75rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--text, inherit); }
    .lt .grp { text-align: start; font-size: .75rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); background: color-mix(in srgb, currentColor 6%, transparent); border-bottom: 0; }
  `,
  template: `
    <div class="stack">
      <section class="panel" aria-labelledby="h-evo">
        <div class="panel-head">
          <h2 id="h-evo">Evolución</h2>
          <div class="row">
            <label class="check small"><input type="checkbox" [checked]="patient().measurementsVisibleToPatient" (change)="toggleVisible($any($event.target).checked)" /> Visible para el paciente</label>
            <button tuiButton type="button" size="s" appearance="secondary" (click)="exportCsv()"><app-icon name="download" [size]="16" /> Excel / CSV</button>
            <button tuiButton type="button" size="s" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Nueva medición</button>
          </div>
        </div>
        @if (sorted().length) {
          <div class="field metric-pick">
            <label for="m-metric">Variable a graficar</label>
            <select id="m-metric" class="select" (change)="selected.set($any($event.target).value)">
              @for (g of metricGroups(); track g.title) {
                <optgroup [label]="g.title">@for (m of g.items; track m.key) { <option [value]="m.key" [selected]="selected() === m.key">{{ m.label }}</option> }</optgroup>
              }
            </select>
          </div>
          <app-line-chart [series]="series()" [unit]="current().unit" [title]="'Evolución de ' + current().label.toLowerCase()" />
        } @else { <app-empty icon="scale" title="Sin mediciones" text="Registra la primera medición para ver su evolución." /> }
      </section>

      <section class="panel panel--flush" aria-labelledby="h-hist">
        <div class="panel-head"><h2 id="h-hist">Historial (acumulativo)</h2><span class="small muted">Las mediciones nuevas nunca sobrescriben las anteriores.</span></div>
        @if (sorted().length) {
          <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Fecha</th><th scope="col" class="num">Peso (kg)</th><th scope="col" class="num">Talla (cm)</th><th scope="col" class="num">IMC</th><th scope="col" class="num">Cintura (cm)</th><th scope="col" class="num">Cadera (cm)</th><th scope="col" class="num">Grasa %</th><th scope="col">Notas</th><th scope="col"><span class="visually-hidden">Detalle</span></th></tr></thead><tbody>
            @for (m of desc(); track m.id) {
              <tr><td>{{ fd(m.measuredAt) }}</td><td class="num">{{ m.weightKg }}</td><td class="num">{{ m.heightCm }}</td><td class="num">{{ m.bmi }}</td><td class="num">{{ m.waistCm ?? '—' }}</td><td class="num">{{ m.hipCm ?? '—' }}</td><td class="num">{{ m.bodyFatPct ?? '—' }}</td><td class="small">{{ m.notes ?? '' }}</td>
                <td>@if (hasDetail(m)) { <button type="button" class="link-btn small" (click)="showDetail(m)">Ver detalle</button> }</td></tr>
            }
          </tbody></table></div>
        }
      </section>
    </div>

    <app-modal [(open)]="detailOpen" [title]="'Medición del ' + (detail() ? fd(detail()!.measuredAt) : '')" size="wide">
      @if (detail(); as m) {
        <dl class="sum">
          <div><dt>Peso</dt><dd>{{ m.weightKg }} kg</dd></div><div><dt>Talla</dt><dd>{{ m.heightCm }} cm</dd></div><div><dt>IMC</dt><dd>{{ m.bmi }}</dd></div>
          @if (m.bodyFatPct) { <div><dt>Grasa</dt><dd>{{ m.bodyFatPct }} %</dd></div> }
          @if (m.waistCm) { <div><dt>Cintura</dt><dd>{{ m.waistCm }} cm</dd></div> }
          @if (m.hipCm) { <div><dt>Cadera</dt><dd>{{ m.hipCm }} cm</dd></div> }
        </dl>
        @if (compRows(m).length) {
          <h3 class="dsec">Composición corporal</h3>
          <dl class="kv">@for (r of compRows(m); track r.label) { <div><dt>{{ r.label }}</dt><dd><span class="n"><span class="i">{{ ip(r.value) }}</span><span class="f">{{ fp(r.value) }}</span></span><span class="u">{{ r.unit }}</span></dd></div> }</dl>
        }
        @if (trunkRows(m).length) {
          <h3 class="dsec">Tronco y muñeca (cm)</h3>
          <dl class="kv">@for (r of trunkRows(m); track r.label) { <div><dt>{{ r.label }}</dt><dd><span class="n"><span class="i">{{ ip(r.value) }}</span><span class="f">{{ fp(r.value) }}</span></span><span class="u">{{ r.unit }}</span></dd></div> }</dl>
        }
        @if (limbRows(m).length) {
          <h3 class="dsec">Brazos y piernas (cm)</h3>
          <div class="lt-grid">
            @for (l of limbRows(m); track l.name) {
              <table class="lt">
                <thead><tr><th scope="col" class="part">{{ l.name }}</th><th scope="col">Derecho</th><th scope="col">Izquierdo</th></tr></thead>
                <tbody>
                  <tr><th scope="row">No contraído</th><td><span class="n"><span class="i">{{ ip(l.cells[0].value) }}</span><span class="f">{{ fp(l.cells[0].value) }}</span></span></td><td><span class="n"><span class="i">{{ ip(l.cells[1].value) }}</span><span class="f">{{ fp(l.cells[1].value) }}</span></span></td></tr>
                <tr><th scope="row">Contraído</th><td><span class="n"><span class="i">{{ ip(l.cells[2].value) }}</span><span class="f">{{ fp(l.cells[2].value) }}</span></span></td><td><span class="n"><span class="i">{{ ip(l.cells[3].value) }}</span><span class="f">{{ fp(l.cells[3].value) }}</span></span></td></tr>
                </tbody>
              </table>
            }
          </div>
        }
      }
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="detailOpen.set(false)">Cerrar</button></ng-container>
    </app-modal>

    <app-modal [(open)]="adding" title="Nueva medición">
      <form [formGroup]="form" id="meas-form" (ngSubmit)="save()" class="stack" novalidate>
        <div class="form-grid">
          <div class="field"><label for="m-date">Fecha</label><input id="m-date" class="input" type="date" formControlName="measuredAt" [max]="today" /><app-field-error [control]="form.controls.measuredAt" /></div>
          <div class="field"><label for="m-w">Peso (kg)</label><input id="m-w" class="input" inputmode="decimal" formControlName="weightKg" /><app-field-error [control]="form.controls.weightKg" [messages]="rangeW" /></div>
          <div class="field"><label for="m-h">Talla (cm)</label><input id="m-h" class="input" inputmode="decimal" formControlName="heightCm" /><app-field-error [control]="form.controls.heightCm" [messages]="rangeH" /></div>
          <div class="field"><span class="label">IMC (calculado)</span><output class="input flex-center">{{ bmiPreview() }}</output></div>
        </div>

        <h3 class="eyebrow">Composición corporal <span class="muted">opcional</span></h3>
        <div class="form-grid" formGroupName="comp">
          @for (f of comp; track f.key) {
            <div class="field"><label [for]="'c-' + f.key">{{ f.label }}@if (f.unit) { ({{ f.unit }}) }</label><input [id]="'c-' + f.key" class="input" inputmode="decimal" [formControlName]="f.key" /><app-field-error [control]="compCtl(f.key)" [messages]="compMsg[f.key]" /></div>
          }
        </div>

        <h3 class="eyebrow">Perímetros o circunferencias (cm) <span class="muted">opcional</span></h3>
        <div class="form-grid">
          <div class="field"><label for="m-waist">Cintura</label><input id="m-waist" class="input" inputmode="decimal" formControlName="waistCm" /><app-field-error [control]="form.controls.waistCm" /></div>
          <div class="field"><label for="m-hip">Cadera</label><input id="m-hip" class="input" inputmode="decimal" formControlName="hipCm" /><app-field-error [control]="form.controls.hipCm" /></div>
        </div>
        @for (g of girthGroups; track g.title) {
          <fieldset class="stack fieldset-reset" formGroupName="girths">
            <legend class="small muted">{{ g.title }}</legend>
            <div class="form-grid">
              @for (f of g.fields; track f.key) {
                <div class="field"><label [for]="'g-' + f.key">{{ f.label }}</label><input [id]="'g-' + f.key" class="input" inputmode="decimal" [formControlName]="f.key" /><app-field-error [control]="girthCtl(f.key)" [messages]="girthMsg" /></div>
              }
            </div>
          </fieldset>
        }
        <div class="field"><label for="m-notes">Notas <span class="muted">opcional</span></label><textarea id="m-notes" class="textarea" formControlName="notes"></textarea></div>
      </form>
      <ng-container modalFooter>
        <button tuiButton type="button" appearance="secondary" size="m" (click)="adding.set(false)">Cancelar</button>
        <button tuiButton type="submit" form="meas-form" size="m">Guardar medición</button>
      </ng-container>
    </app-modal>
  `,
})
export class MeasurementsTab {
  private readonly patients = inject(PatientsService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  readonly patient = input.required<Patient>();

  protected readonly fd = formatDate;
  protected readonly today = todayIso();
  protected readonly adding = signal(false);
  protected readonly rangeW = RANGE_MSG('Peso', 20, 400);
  protected readonly rangeH = RANGE_MSG('Talla', 100, 250);
  protected readonly comp = COMPOSITION_FIELDS;
  protected readonly girthGroups = GIRTH_GROUPS;
  protected readonly compMsg = Object.fromEntries(COMPOSITION_FIELDS.map((f) => [f.key, RANGE_MSG(f.label, f.min, f.max)]));
  protected readonly girthMsg = RANGE_MSG('Perímetro', 5, 250);
  protected readonly detailOpen = signal(false);
  protected readonly detail = signal<Measurement | null>(null);

  private static readonly ALL_METRICS: readonly { key: string; label: string; unit: string; get: (m: Measurement) => string | undefined }[] = [
    { key: 'weightKg', label: 'Peso', unit: 'kg', get: (m) => m.weightKg },
    { key: 'bmi', label: 'IMC', unit: '', get: (m) => m.bmi },
    { key: 'waistCm', label: 'Cintura', unit: 'cm', get: (m) => m.waistCm },
    { key: 'hipCm', label: 'Cadera', unit: 'cm', get: (m) => m.hipCm },
    ...COMPOSITION_FIELDS.map((f) => ({ key: f.key as string, label: f.label, unit: f.unit, get: (m: Measurement) => m[f.key] })),
    ...GIRTH_FIELDS.map((f) => ({ key: `g:${f.key}`, label: f.label, unit: 'cm', get: (m: Measurement) => m.girths?.[f.key] })),
  ];
  protected readonly sorted = computed(() => [...this.patient().measurements].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)));
  protected readonly desc = computed(() => [...this.sorted()].reverse());
  /** Solo se ofrecen las variables que tienen al menos un dato; peso e IMC siempre. */
  protected readonly metrics = computed(() => MeasurementsTab.ALL_METRICS.filter((x) => ['weightKg', 'bmi'].includes(x.key) || this.sorted().some((m) => x.get(m) !== undefined)));
  protected readonly selected = signal('weightKg');
  /** Las variables disponibles agrupadas por zona del cuerpo, para un selector corto en lugar de decenas de botones. */
  protected readonly metricGroups = computed(() => {
    const have = new Map(this.metrics().map((x) => [x.key, x]));
    const pick = (keys: string[]) => keys.map((k) => have.get(k)).filter((x): x is NonNullable<typeof x> => !!x);
    return [
      { title: 'General', items: pick(['weightKg', 'bmi', 'waistCm', 'hipCm']) },
      { title: 'Composición corporal', items: pick(COMPOSITION_FIELDS.map((f) => f.key as string)) },
      ...GIRTH_GROUPS.map((g) => ({ title: g.title, items: pick(g.fields.map((f) => `g:${f.key}`)) })),
    ].filter((g) => g.items.length);
  });
  protected readonly current = computed(() => this.metrics().find((m) => m.key === this.selected()) ?? this.metrics()[0]);
  protected readonly series = computed<LineSeries[]>(() => {
    const cur = this.current();
    return [{ label: cur.label, points: this.sorted().filter((m) => cur.get(m) !== undefined).map((m) => ({ date: m.measuredAt, value: Number(cur.get(m)) })) }];
  });

  private static readonly LIMBS = [['bicep', 'Bícep'], ['forearm', 'Antebrazo'], ['thigh', 'Muslo'], ['calf', 'Gemelo']] as const;
  private static readonly TRUNK = GIRTH_FIELDS.filter((f) => !/_(relaxed|flexed)_/.test(f.key));

  protected hasDetail(m: Measurement): boolean {
    return this.compRows(m).length > 0 || Object.keys(m.girths ?? {}).length > 0;
  }
  /** Parte entera y decimal por separado: los decimales se alinean entre filas aunque unas tengan 25 y otras 25.45. */
  protected ip(v: string): string { return v.split('.')[0]; }
  protected fp(v: string): string { return v.includes('.') ? '.' + v.split('.')[1] : ''; }
  protected showDetail(m: Measurement): void { this.detail.set(m); this.detailOpen.set(true); }
  protected compRows(m: Measurement): { label: string; value: string; unit: string }[] {
    return COMPOSITION_FIELDS.filter((f) => f.key !== 'bodyFatPct' && m[f.key] !== undefined).map((f) => ({ label: f.label, value: m[f.key]!, unit: f.unit }));
  }
  protected trunkRows(m: Measurement): { label: string; value: string; unit: string }[] {
    return MeasurementsTab.TRUNK.filter((f) => m.girths?.[f.key] !== undefined).map((f) => ({ label: f.label, value: m.girths![f.key], unit: 'cm' }));
  }
  /** Una fila por parte del cuerpo: no contraído (der., izq.) y contraído (der., izq.). Cada celda conserva su lectura completa para lectores de pantalla. */
  protected limbRows(m: Measurement): { name: string; cells: { label: string; value: string }[] }[] {
    const g = m.girths ?? {};
    return MeasurementsTab.LIMBS.map(([k, name]) => ({
      name,
      cells: ([['relaxed', 'r', 'derecho no contraído'], ['relaxed', 'l', 'izquierdo no contraído'], ['flexed', 'r', 'derecho contraído'], ['flexed', 'l', 'izquierdo contraído']] as const)
        .map(([st, side, label]) => ({ label, value: g[`${k}_${st}_${side}`] ?? '—' })),
    })).filter((r) => r.cells.some((c) => c.value !== '—'));
  }

  protected readonly form = this.fb.nonNullable.group({
    measuredAt: [todayIso(), Validators.required],
    weightKg: ['', [Validators.required, decimalValidator, range(20, 400)]],
    heightCm: ['', [Validators.required, decimalValidator, range(100, 250)]],
    waistCm: ['', [decimalValidator, range(30, 250)]],
    hipCm: ['', [decimalValidator, range(40, 250)]],
    comp: new FormGroup(Object.fromEntries(COMPOSITION_FIELDS.map((f) => [f.key, new FormControl('', { nonNullable: true, validators: [decimalValidator, range(f.min, f.max)] })]))),
    girths: new FormGroup(Object.fromEntries(GIRTH_FIELDS.map((f) => [f.key, new FormControl('', { nonNullable: true, validators: [decimalValidator, range(5, 250)] })]))),
    notes: [''],
  });
  protected compCtl(key: string): FormControl<string> { return this.form.controls.comp.controls[key] as FormControl<string>; }
  protected girthCtl(key: string): FormControl<string> { return this.form.controls.girths.controls[key] as FormControl<string>; }
  private readonly formValue = signal(this.form.getRawValue());
  protected readonly bmiPreview = computed(() => {
    const v = this.formValue();
    return /^\d+(\.\d+)?$/.test(v.weightKg) && /^\d+(\.\d+)?$/.test(v.heightCm) && Number(v.heightCm) > 0 ? computeBmi(v.weightKg, v.heightCm) : '—';
  });

  constructor() {
    this.form.valueChanges.subscribe(() => this.formValue.set(this.form.getRawValue()));
  }

  protected openAdd(): void {
    const last = latestMeasurement(this.patient().measurements);
    this.form.reset({ measuredAt: todayIso(), weightKg: '', heightCm: last?.heightCm ?? '', waistCm: '', hipCm: '', notes: '' });
    this.adding.set(true);
  }

  protected save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    if (v.measuredAt > todayIso()) { this.form.controls.measuredAt.setErrors({ futureDate: true }); return; }
    const { comp, girths, ...base } = v;
    this.patients.addMeasurement(this.patient().id, { ...base, ...comp, girths });
    this.adding.set(false);
    this.toast.ok('Medición registrada. Se agregó al historial.');
  }

  protected toggleVisible(v: boolean): void {
    this.patients.update(this.patient().id, { measurementsVisibleToPatient: v });
    this.toast.info(v ? 'El paciente ahora puede ver sus mediciones.' : 'Las mediciones ya no son visibles para el paciente.');
  }

  protected exportCsv(): void {
    const extra = MeasurementsTab.ALL_METRICS.filter((x) => !['weightKg', 'bmi', 'waistCm', 'hipCm'].includes(x.key));
    const rows = [
      ['Fecha', 'Peso (kg)', 'Talla (cm)', 'IMC', 'Cintura (cm)', 'Cadera (cm)', ...extra.map((x) => (x.unit ? `${x.label} (${x.unit})` : x.label)), 'Notas'],
      ...this.sorted().map((m) => [m.measuredAt, m.weightKg, m.heightCm, m.bmi, m.waistCm, m.hipCm, ...extra.map((x) => x.get(m)), m.notes]),
    ];
    downloadBlob(`mediciones-${this.patient().id}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
    this.patients.logExport(this.patient().id, 'mediciones (CSV)');
    this.toast.ok('Exportación registrada en auditoría.');
  }
}

// ---------- Información clínica ----------
@Component({
  selector: 'app-clinical-tab',
  imports: [ReactiveFormsModule, TuiButton, Icon, Modal, FieldError, Badge, ReproductiveCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <app-reproductive-card [patient]="patient()" />
      <section class="panel" aria-labelledby="h-ind">
        <div class="panel-head"><h2 id="h-ind">Indicaciones clínicas</h2></div>
        <p class="small muted">Las alertas usan este texto y las condiciones activas para detectar conflictos con los platillos.</p>
        <div class="field"><label for="ind" class="visually-hidden">Indicaciones clínicas</label><textarea id="ind" class="textarea" [value]="patient().clinicalIndications" #ind></textarea></div>
        <div class="form-actions"><button tuiButton type="button" size="m" (click)="saveIndications(ind.value)">Guardar indicaciones</button></div>
      </section>

      <section class="panel panel--flush" aria-labelledby="h-cond">
        <div class="panel-head"><h2 id="h-cond">Enfermedades y condiciones</h2><button tuiButton type="button" size="s" (click)="openCond()"><app-icon name="plus" [size]="16" /> Agregar</button></div>
        <ul class="list-plain list-rows">
          @for (c of patient().conditions; track c.id) {
            <li><div class="grow"><strong>{{ c.name }}</strong> <app-badge [tone]="c.status === 'active' ? 'warn' : 'neutral'">{{ c.status === 'active' ? 'Activa' : 'Resuelta' }}</app-badge><p class="small muted">{{ c.details }}</p></div>
              <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Editar ' + c.name" (click)="openCond(c)"><app-icon name="edit" [size]="18" /></button>
              <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Eliminar ' + c.name" (click)="remove('conditions', c.id, c.name)"><app-icon name="trash" [size]="18" /></button></li>
          } @empty { <li><span class="muted">Sin condiciones registradas.</span></li> }
        </ul>
      </section>

      <section class="panel panel--flush" aria-labelledby="h-all">
        <div class="panel-head"><h2 id="h-all">Alergias</h2><button tuiButton type="button" size="s" (click)="openAllergy()"><app-icon name="plus" [size]="16" /> Agregar</button></div>
        <ul class="list-plain list-rows">
          @for (a of patient().allergies; track a.id) {
            <li><div class="grow"><strong>{{ a.allergen }}</strong> <app-badge [tone]="a.severity === 'severe' ? 'crit' : a.severity === 'moderate' ? 'warn' : 'info'" icon="alert">{{ sev[a.severity] }}</app-badge>
              <p class="small muted">{{ a.reaction || 'Sin reacción descrita' }}@if (a.aliases.length) { · También busca: {{ a.aliases.join(', ') }} }</p></div>
              <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Editar ' + a.allergen" (click)="openAllergy(a)"><app-icon name="edit" [size]="18" /></button>
              <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Eliminar ' + a.allergen" (click)="remove('allergies', a.id, a.allergen)"><app-icon name="trash" [size]="18" /></button></li>
          } @empty { <li><span class="muted">Sin alergias registradas.</span></li> }
        </ul>
      </section>

      <section class="panel panel--flush" aria-labelledby="h-meds">
        <div class="panel-head"><h2 id="h-meds">Medicamentos</h2><button tuiButton type="button" size="s" (click)="openMed()"><app-icon name="plus" [size]="16" /> Agregar</button></div>
        <ul class="list-plain list-rows">
          @for (m of patient().medications; track m.id) {
            <li><div class="grow"><strong>{{ m.name }}</strong>@if (m.kind) { · {{ m.kind }} } · {{ m.dose }} · {{ m.frequency }} <app-badge [tone]="m.status === 'active' ? 'info' : 'neutral'">{{ m.status === 'active' ? 'Vigente' : 'Suspendido' }}</app-badge></div>
              <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Editar ' + m.name" (click)="openMed(m)"><app-icon name="edit" [size]="18" /></button>
              <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Eliminar ' + m.name" (click)="remove('medications', m.id, m.name)"><app-icon name="trash" [size]="18" /></button></li>
          } @empty { <li><span class="muted">Sin medicamentos registrados.</span></li> }
        </ul>
      </section>
    </div>

    <app-modal [(open)]="condOpen" [title]="condForm.controls.id.value ? 'Editar condición' : 'Nueva condición'">
      <form [formGroup]="condForm" id="cond-form" (ngSubmit)="saveCond()" class="stack" novalidate>
        <div class="field"><label for="c-name">Nombre</label><input id="c-name" class="input" formControlName="name" /><app-field-error [control]="condForm.controls.name" /></div>
        <div class="field"><label for="c-det">Detalles</label><textarea id="c-det" class="textarea" formControlName="details"></textarea></div>
        <div class="field"><label for="c-st">Estado</label><select id="c-st" class="select" formControlName="status"><option value="active">Activa</option><option value="resolved">Resuelta</option></select></div>
      </form>
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="condOpen.set(false)">Cancelar</button><button tuiButton type="submit" form="cond-form" size="m">Guardar</button></ng-container>
    </app-modal>

    <app-modal [(open)]="allOpen" [title]="allForm.controls.id.value ? 'Editar alergia' : 'Nueva alergia'">
      <form [formGroup]="allForm" id="all-form" (ngSubmit)="saveAllergy()" class="stack" novalidate>
        <div class="field"><label for="a-name">Alérgeno</label><input id="a-name" class="input" formControlName="allergen" /><app-field-error [control]="allForm.controls.allergen" /></div>
        <div class="field"><label for="a-al">Sinónimos o ingredientes relacionados</label><input id="a-al" class="input" formControlName="aliases" aria-describedby="a-al-h" /><span class="hint" id="a-al-h">Separados por comas. Las alertas los buscan en ingredientes y nombres de platillos.</span></div>
        <div class="form-grid"><div class="field"><label for="a-re">Reacción</label><input id="a-re" class="input" formControlName="reaction" /></div>
        <div class="field"><label for="a-sev">Severidad</label><select id="a-sev" class="select" formControlName="severity"><option value="mild">Leve</option><option value="moderate">Moderada</option><option value="severe">Severa</option></select></div></div>
      </form>
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="allOpen.set(false)">Cancelar</button><button tuiButton type="submit" form="all-form" size="m">Guardar</button></ng-container>
    </app-modal>

    <app-modal [(open)]="medOpen" [title]="medForm.controls.id.value ? 'Editar medicamento' : 'Nuevo medicamento'">
      <form [formGroup]="medForm" id="med-form" (ngSubmit)="saveMed()" class="stack" novalidate>
        <div class="field"><label for="md-name">Medicamento</label><input id="md-name" class="input" formControlName="name" /><app-field-error [control]="medForm.controls.name" /></div>
        <div class="field"><label for="md-kind">Tipo</label><input id="md-kind" class="input" formControlName="kind" placeholder="Ej. antihipertensivo, antidiabético, suplemento" /></div>
        <div class="form-grid"><div class="field"><label for="md-dose">Dosis</label><input id="md-dose" class="input" formControlName="dose" /></div><div class="field"><label for="md-f">Frecuencia</label><input id="md-f" class="input" formControlName="frequency" /></div>
        <div class="field"><label for="md-s">Estado</label><select id="md-s" class="select" formControlName="status"><option value="active">Vigente</option><option value="ended">Suspendido</option></select></div></div>
      </form>
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="medOpen.set(false)">Cancelar</button><button tuiButton type="submit" form="med-form" size="m">Guardar</button></ng-container>
    </app-modal>
  `,
})
export class ClinicalTab {
  private readonly patients = inject(PatientsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  readonly patient = input.required<Patient>();
  protected readonly sev = { mild: 'Leve', moderate: 'Moderada', severe: 'Severa' };
  protected readonly condOpen = signal(false);
  protected readonly allOpen = signal(false);
  protected readonly medOpen = signal(false);

  protected readonly condForm = this.fb.nonNullable.group({ id: [''], name: ['', Validators.required], details: [''], status: ['active' as Condition['status']] });
  protected readonly allForm = this.fb.nonNullable.group({ id: [''], allergen: ['', Validators.required], aliases: [''], reaction: [''], severity: ['moderate' as Allergy['severity']] });
  protected readonly medForm = this.fb.nonNullable.group({ id: [''], name: ['', Validators.required], kind: [''], dose: [''], frequency: [''], status: ['active' as Medication['status']] });

  protected saveIndications(v: string): void {
    this.patients.update(this.patient().id, { clinicalIndications: v.trim() });
    this.toast.ok('Indicaciones guardadas.');
  }

  protected openCond(c?: Condition): void { this.condForm.reset({ id: c?.id ?? '', name: c?.name ?? '', details: c?.details ?? '', status: c?.status ?? 'active' }); this.condOpen.set(true); }
  protected saveCond(): void {
    this.condForm.markAllAsTouched();
    if (this.condForm.invalid) return;
    const { id, ...v } = this.condForm.getRawValue();
    this.patients.saveCondition(this.patient().id, { ...v, id: id || undefined });
    this.condOpen.set(false);
    this.toast.ok('Condición guardada.');
  }

  protected openAllergy(a?: Allergy): void { this.allForm.reset({ id: a?.id ?? '', allergen: a?.allergen ?? '', aliases: a?.aliases.join(', ') ?? '', reaction: a?.reaction ?? '', severity: a?.severity ?? 'moderate' }); this.allOpen.set(true); }
  protected saveAllergy(): void {
    this.allForm.markAllAsTouched();
    if (this.allForm.invalid) return;
    const { id, aliases, ...v } = this.allForm.getRawValue();
    this.patients.saveAllergy(this.patient().id, { ...v, id: id || undefined, aliases: aliases.split(',').map((x) => x.trim()).filter(Boolean), status: 'active' });
    this.allOpen.set(false);
    this.toast.ok('Alergia guardada. Las alertas de los planes se actualizan automáticamente.');
  }

  protected openMed(m?: Medication): void { this.medForm.reset({ id: m?.id ?? '', name: m?.name ?? '', kind: m?.kind ?? '', dose: m?.dose ?? '', frequency: m?.frequency ?? '', status: m?.status ?? 'active' }); this.medOpen.set(true); }
  protected saveMed(): void {
    this.medForm.markAllAsTouched();
    if (this.medForm.invalid) return;
    const { id, ...v } = this.medForm.getRawValue();
    this.patients.saveMedication(this.patient().id, { ...v, id: id || undefined });
    this.medOpen.set(false);
    this.toast.ok('Medicamento guardado.');
  }

  protected async remove(key: 'conditions' | 'allergies' | 'medications', id: string, name: string): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Eliminar registro', message: `¿Eliminar "${name}" del expediente?`, confirmLabel: 'Eliminar', tone: 'danger' });
    if (ok) { this.patients.removeItem(this.patient().id, key, id); this.toast.ok('Registro eliminado.'); }
  }
}

// ---------- Objetivos y preferencias ----------
@Component({
  selector: 'app-preferences-tab',
  imports: [ReactiveFormsModule, TuiButton, Icon, Modal, FieldError, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" aria-labelledby="h-pref">
      <div class="panel-head"><h2 id="h-pref">Alimentos y preferencias</h2><button tuiButton type="button" size="s" (click)="open()"><app-icon name="plus" [size]="16" /> Agregar</button></div>
      <p class="small muted">Los alimentos que "no consume" y las restricciones activan alertas en los planes.</p>
      @for (g of groups(); track g.type) {
        <div class="stack--s">
          <h3 class="eyebrow">{{ g.label }}</h3>
          <div class="chips">
            @for (p of g.items; track p.id) {
              <span class="badge" [class]="'badge badge--' + g.tone"><span>{{ p.foodName }}</span>
                <button type="button" class="icon-btn icon-btn--s u-box-6" [attr.aria-label]="'Quitar ' + p.foodName" (click)="remove(p)"><app-icon name="x" [size]="14" /></button></span>
            }
          </div>
        </div>
      } @empty { <app-empty icon="heart" title="Sin preferencias registradas" text="Agrega alimentos favoritos, restricciones o alimentos que no consume." /> }
    </section>

    <app-modal [(open)]="isOpen" title="Agregar preferencia" size="narrow">
      <form [formGroup]="form" id="pref-form" (ngSubmit)="save()" class="stack" novalidate>
        <div class="field"><label for="pf-food">Alimento</label><input id="pf-food" class="input" formControlName="foodName" /><app-field-error [control]="form.controls.foodName" /></div>
        <div class="field"><label for="pf-type">Tipo</label><select id="pf-type" class="select" formControlName="type">@for (t of types; track t[0]) { <option [value]="t[0]">{{ t[1] }}</option> }</select></div>
        <div class="field"><label for="pf-n">Notas</label><input id="pf-n" class="input" formControlName="notes" /></div>
      </form>
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="isOpen.set(false)">Cancelar</button><button tuiButton type="submit" form="pref-form" size="m">Guardar</button></ng-container>
    </app-modal>
  `,
})
export class PreferencesTab {
  private readonly patients = inject(PatientsService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  readonly patient = input.required<Patient>();
  protected readonly isOpen = signal(false);
  protected readonly types = Object.entries(PREFERENCE_LABEL);
  protected readonly form = this.fb.nonNullable.group({ foodName: ['', Validators.required], type: ['favorite' as PreferenceType], notes: [''] });
  protected readonly groups = computed(() =>
    (['favorite', 'avoid', 'restriction', 'other'] as PreferenceType[])
      .map((t) => ({ type: t, label: PREFERENCE_LABEL[t], tone: t === 'favorite' ? 'ok' : t === 'avoid' ? 'warn' : t === 'restriction' ? 'crit' : 'info', items: this.patient().preferences.filter((p) => p.type === t) }))
      .filter((g) => g.items.length),
  );

  protected open(): void { this.form.reset({ foodName: '', type: 'favorite', notes: '' }); this.isOpen.set(true); }
  protected save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.patients.savePreference(this.patient().id, this.form.getRawValue() as Omit<FoodPreference, 'id'>);
    this.isOpen.set(false);
    this.toast.ok('Preferencia guardada.');
  }
  protected remove(p: FoodPreference): void { this.patients.removeItem(this.patient().id, 'preferences', p.id); this.toast.info(`Se quitó "${p.foodName}".`); }
}
