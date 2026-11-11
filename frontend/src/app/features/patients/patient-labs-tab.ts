import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TuiButton } from '@taiga-ui/core';
import { LabsService } from '../../core/services/labs.service';
import { PatientsService } from '../../core/services/patients.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { LAB_CATALOG, LabReport, LabResult, Patient, labStatus } from '../../shared/models/domain';
import { FieldError, decimalValidator } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { LineChart, LineSeries } from '../../shared/components/charts';
import { Badge, EmptyState } from '../../shared/components/ui';
import { formatDate, todayIso } from '../../shared/utils/format';

interface Card { result: LabResult; takenAt: string; labName: string }

/** Posición del valor dentro de una barra: zona sana (verde) y marcador. Todo en porcentaje del ancho. */
function gauge(r: LabResult): { from: number; width: number; mark: number } | null {
  const v = Number(r.value);
  const min = r.refMin ? Number(r.refMin) : undefined;
  const max = r.refMax ? Number(r.refMax) : undefined;
  if (Number.isNaN(v) || (min === undefined && max === undefined)) return null;
  let lo: number, hi: number, from: number, to: number;
  if (min !== undefined && max !== undefined) {
    const pad = (max - min) * 0.5 || 1;
    lo = min - pad; hi = max + pad; from = min; to = max;
  } else if (max !== undefined) {
    lo = 0; hi = max * 1.5 || 1; from = 0; to = max;
  } else {
    lo = 0; hi = (min as number) * 2 || 1; from = min as number; to = hi;
  }
  const pct = (x: number) => Math.min(100, Math.max(0, ((x - lo) / (hi - lo)) * 100));
  return { from: pct(from), width: pct(to) - pct(from), mark: pct(v) };
}

// ---------- Laboratorios: espejo de la química sanguínea ----------
@Component({
  selector: 'app-labs-tab',
  imports: [ReactiveFormsModule, TuiButton, Icon, Modal, LineChart, EmptyState, Badge, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .cards { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); }
    .lab-card { display: grid; gap: .5rem; padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); }
    .lab-card h3 { font-size: .9375rem; font-family: var(--nutri-font-ui); font-weight: 600; margin: 0; }
    .lab-card .row { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }
    .lab-card .val { font-size: 1.75rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .lab-card .val small { font-size: .8125rem; font-weight: 500; color: var(--muted); margin-inline-start: .25rem; }
    .bar { position: relative; block-size: .5rem; border-radius: 999px; background: var(--line); }
    .bar .zone { position: absolute; inset-block: 0; border-radius: 999px; background: var(--ok); opacity: .55; }
    .bar .mark { position: absolute; inset-block-start: 50%; inline-size: .875rem; block-size: .875rem; border-radius: 50%; border: 2px solid var(--surface); transform: translate(-50%, -50%); background: var(--nutri-texto-fuerte); }
    .bar .mark.ok { background: var(--ok); } .bar .mark.warn { background: var(--warn, #c98a00); } .bar .mark.crit { background: var(--crit, #c0392b); }
    .rows { display: grid; gap: var(--space-2); }
    .lab-row { display: grid; gap: .5rem; grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, .8fr) minmax(0, .8fr) auto; align-items: start; }
    .lab-row .hdr { font-size: .75rem; color: var(--muted); }
    @media (max-width: 40rem) { .lab-row { grid-template-columns: 1fr 1fr; } .lab-row > :first-child { grid-column: 1 / -1; } }
    details.rep { border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); }
    details.rep summary { cursor: pointer; padding: var(--space-3) var(--space-4); display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
    details.rep .inner { padding: 0 var(--space-4) var(--space-3); }
  `,
  template: `
    <div class="stack">
      <section class="panel" aria-labelledby="h-lab">
        <div class="panel-head">
          <h2 id="h-lab">Química sanguínea</h2>
          <button tuiButton type="button" size="s" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Nuevo estudio</button>
        </div>
        @if (cards().length) {
          <p class="small muted">Último valor registrado de cada análisis. El color compara contra el rango de referencia de ese resultado.</p>
          <div class="cards">
            @for (c of cards(); track c.result.name) {
              <article class="lab-card" [attr.aria-label]="c.result.name">
                <h3>{{ c.result.name }}</h3>
                <div class="row">
                  <span class="val">{{ c.result.value }}<small>{{ c.result.unit }}</small></span>
                  <app-badge [tone]="st(c.result).tone">{{ st(c.result).label }}</app-badge>
                </div>
                @if (g(c.result); as b) {
                  <div class="bar" aria-hidden="true"><span class="zone" [style.inset-inline-start.%]="b.from" [style.inline-size.%]="b.width"></span><span class="mark" [class]="'mark ' + st(c.result).tone" [style.inset-inline-start.%]="b.mark"></span></div>
                }
                <p class="small muted">@if (range(c.result); as r) { Ref. {{ r }} · }{{ fd(c.takenAt) }}</p>
              </article>
            }
          </div>
        } @else {
          <app-empty icon="activity" title="Sin estudios de laboratorio" text="Captura los valores de la química sanguínea para verlos aquí, con su semáforo y su evolución." />
        }
      </section>

      @if (names().length) {
        <section class="panel" aria-labelledby="h-trend">
          <div class="panel-head"><h2 id="h-trend">Evolución</h2></div>
          <div class="chips" role="group" aria-label="Análisis a graficar">
            @for (n of names(); track n) { <button type="button" class="chip-toggle" [attr.aria-pressed]="current() === n" (click)="selected.set(n)">{{ n }}</button> }
          </div>
          <app-line-chart [series]="series()" [unit]="unit()" [title]="'Evolución de ' + current().toLowerCase()" />
        </section>
      }

      <section class="panel panel--flush" aria-labelledby="h-hist-lab">
        <div class="panel-head"><h2 id="h-hist-lab">Estudios capturados</h2><span class="small muted">{{ reports().length }} en total</span></div>
        <div class="stack--s" style="padding: 0 var(--space-4) var(--space-4)">
          @for (r of reports(); track r.id) {
            <details class="rep">
              <summary><strong>{{ fd(r.takenAt) }}</strong><span class="muted">{{ r.labName || 'Laboratorio sin nombre' }}</span><span class="small muted">{{ r.results.length }} análisis</span><span class="grow"></span>@if (outOfRange(r)) { <app-badge tone="warn" icon="alert-circle">{{ outOfRange(r) }} fuera de rango</app-badge> }</summary>
              <div class="inner">
                @if (r.notes) { <p class="small muted">{{ r.notes }}</p> }
                <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Análisis</th><th scope="col" class="num">Resultado</th><th scope="col">Unidad</th><th scope="col">Referencia</th><th scope="col">Estado</th></tr></thead><tbody>
                  @for (x of r.results; track x.name) { <tr><td>{{ x.name }}</td><td class="num">{{ x.value }}</td><td>{{ x.unit }}</td><td>{{ range(x) ?? '—' }}</td><td><app-badge [tone]="st(x).tone">{{ st(x).label }}</app-badge></td></tr> }
                </tbody></table></div>
                <div class="form-actions"><button tuiButton type="button" size="s" appearance="secondary" (click)="remove(r)"><app-icon name="trash" [size]="16" /> Eliminar estudio</button></div>
              </div>
            </details>
          } @empty { <p class="muted">Aún no hay estudios capturados.</p> }
        </div>
      </section>

      <section class="panel" aria-labelledby="h-pdf">
        <div class="panel-head"><h2 id="h-pdf">PDF originales</h2><button type="button" class="link-btn small" (click)="openDocuments.emit()">Ir a Documentos</button></div>
        @if (pdfs().length) {
          <ul class="list-plain list-rows">@for (d of pdfs(); track d.id) { <li><div class="grow"><strong>{{ d.name }}</strong><p class="small muted">{{ fd(d.documentDate) }}</p></div></li> }</ul>
        } @else { <p class="small muted">Al capturar un estudio puedes adjuntar el PDF del laboratorio; se guarda en Documentos con la categoría «Laboratorio».</p> }
      </section>
    </div>

    <app-modal [(open)]="adding" title="Nuevo estudio de laboratorio" size="wide">
      <form [formGroup]="form" id="lab-form" (ngSubmit)="save()" class="stack" novalidate>
        <div class="form-grid">
          <div class="field"><label for="l-date">Fecha del estudio</label><input id="l-date" class="input" type="date" formControlName="takenAt" [max]="today" /><app-field-error [control]="form.controls.takenAt" /></div>
          <div class="field"><label for="l-lab">Laboratorio <span class="muted">opcional</span></label><input id="l-lab" class="input" formControlName="labName" /></div>
        </div>

        <div class="field">
          <label for="l-add">Agregar análisis</label>
          <select id="l-add" class="select" #pick (change)="addFromCatalog(pick.value); pick.value = ''">
            <option value="">Elige un análisis frecuente…</option>
            @for (c of catalog; track c.name) { @if (!usedNames().has(c.name)) { <option [value]="c.name">{{ c.name }} ({{ c.unit }})</option> } }
          </select>
        </div>

        <div class="rows" formArrayName="rows">
          @for (row of rows.controls; track row; let i = $index) {
            <div class="lab-row" [formGroupName]="i">
              <div class="field"><label class="hdr" [for]="'r-n' + i">Análisis</label><input [id]="'r-n' + i" class="input" formControlName="name" list="lab-names" (change)="onName(i)" /><app-field-error [control]="row.controls.name" /></div>
              <div class="field"><label class="hdr" [for]="'r-v' + i">Resultado</label><input [id]="'r-v' + i" class="input" inputmode="decimal" formControlName="value" /><app-field-error [control]="row.controls.value" /></div>
              <div class="field"><label class="hdr" [for]="'r-u' + i">Unidad</label><input [id]="'r-u' + i" class="input" formControlName="unit" /></div>
              <div class="field"><label class="hdr" [for]="'r-a' + i">Ref. mín.</label><input [id]="'r-a' + i" class="input" inputmode="decimal" formControlName="refMin" /><app-field-error [control]="row.controls.refMin" /></div>
              <div class="field"><label class="hdr" [for]="'r-b' + i">Ref. máx.</label><input [id]="'r-b' + i" class="input" inputmode="decimal" formControlName="refMax" /><app-field-error [control]="row.controls.refMax" /></div>
              <button type="button" class="icon-btn icon-btn--s" style="margin-block-start: 1.5rem" [attr.aria-label]="'Quitar fila ' + (i + 1)" (click)="removeRow(i)"><app-icon name="trash" [size]="18" /></button>
            </div>
          }
        </div>
        <datalist id="lab-names">@for (c of catalog; track c.name) { <option [value]="c.name"></option> }</datalist>
        <div><button tuiButton type="button" size="s" appearance="secondary" (click)="addRow()"><app-icon name="plus" [size]="16" /> Otro análisis</button></div>
        @if (rowsError()) { <p class="error" role="alert">{{ rowsError() }}</p> }
        <p class="small muted">Los rangos de referencia son orientativos y se pueden editar: cámbialos por los que imprime el laboratorio.</p>

        <div class="field"><label for="l-notes">Notas <span class="muted">opcional</span></label><textarea id="l-notes" class="textarea" formControlName="notes"></textarea></div>
        <div class="field"><label for="l-pdf">PDF o imagen del estudio <span class="muted">opcional</span></label><input id="l-pdf" class="input" type="file" accept="application/pdf,image/png,image/jpeg" (change)="file.set($any($event.target).files?.[0] ?? null)" />
          @if (fileError()) { <p class="error" role="alert">{{ fileError() }}</p> }</div>
      </form>
      <ng-container modalFooter>
        <button tuiButton type="button" appearance="secondary" size="m" (click)="adding.set(false)">Cancelar</button>
        <button tuiButton type="submit" form="lab-form" size="m" [disabled]="saving()">Guardar estudio</button>
      </ng-container>
    </app-modal>
  `,
})
export class LabsTab {
  private readonly labs = inject(LabsService);
  private readonly patients = inject(PatientsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  readonly patient = input.required<Patient>();
  readonly openDocuments = output<void>();

  protected readonly fd = formatDate;
  protected readonly st = labStatus;
  protected readonly g = gauge;
  protected readonly today = todayIso();
  protected readonly catalog = LAB_CATALOG;
  protected readonly adding = signal(false);
  protected readonly saving = signal(false);
  protected readonly rowsError = signal('');
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = computed(() => (this.file() ? this.patients.validateUpload(this.patient(), this.file() as File) : null));

  protected readonly reports = computed(() => this.labs.reports(this.patient().id));
  protected readonly pdfs = computed(() => this.patient().documents.filter((d) => d.category === 'laboratorio'));

  /** Último valor de cada análisis, en el orden del catálogo (los que no están en él, al final). */
  protected readonly cards = computed<Card[]>(() => {
    const seen = new Map<string, Card>();
    for (const rep of this.reports()) for (const r of rep.results) if (!seen.has(r.name)) seen.set(r.name, { result: r, takenAt: rep.takenAt, labName: rep.labName });
    const order = (n: string) => { const i = LAB_CATALOG.findIndex((c) => c.name === n); return i < 0 ? 999 : i; };
    return [...seen.values()].sort((a, b) => order(a.result.name) - order(b.result.name) || a.result.name.localeCompare(b.result.name));
  });
  protected readonly names = computed(() => this.cards().map((c) => c.result.name));
  protected readonly selected = signal('');
  protected readonly current = computed(() => (this.names().includes(this.selected()) ? this.selected() : (this.names()[0] ?? '')));
  protected readonly unit = computed(() => this.cards().find((c) => c.result.name === this.current())?.result.unit ?? '');
  protected readonly series = computed<LineSeries[]>(() => {
    const n = this.current();
    const pts = this.reports().flatMap((r) => r.results.filter((x) => x.name === n).map((x) => ({ date: r.takenAt, value: Number(x.value) }))).sort((a, b) => a.date.localeCompare(b.date));
    return [{ label: n, points: pts }];
  });

  protected readonly form = this.fb.nonNullable.group({
    takenAt: [todayIso(), Validators.required],
    labName: [''],
    notes: [''],
    rows: this.fb.array<FormGroup<RowControls>>([]),
  });
  protected get rows(): FormArray<FormGroup<RowControls>> { return this.form.controls.rows; }
  protected readonly usedNames = signal(new Set<string>());

  constructor() {
    // Modo API: al abrir el expediente se traen los estudios del servidor. Solo depende del paciente.
    effect(() => {
      const id = this.patient().id;
      untracked(() => this.labs.load(id).subscribe({ error: () => undefined }));
    });
  }

  protected range(r: LabResult): string | null {
    if (r.refMin && r.refMax) return `${r.refMin}–${r.refMax} ${r.unit}`.trim();
    if (r.refMax) return `≤ ${r.refMax} ${r.unit}`.trim();
    if (r.refMin) return `≥ ${r.refMin} ${r.unit}`.trim();
    return null;
  }

  protected outOfRange(r: LabReport): number {
    return r.results.filter((x) => ['low', 'high'].includes(labStatus(x).level)).length;
  }

  private newRow(name = '', unit = '', refMin = '', refMax = ''): FormGroup<RowControls> {
    return this.fb.nonNullable.group({
      name: [name, Validators.required], value: ['', [Validators.required, decimalValidator]], unit: [unit],
      refMin: [refMin, decimalValidator], refMax: [refMax, decimalValidator],
    });
  }

  private syncUsed(): void {
    this.usedNames.set(new Set(this.rows.controls.map((r) => r.controls.name.value.trim()).filter(Boolean)));
  }

  protected openAdd(): void {
    this.form.reset({ takenAt: todayIso(), labName: '', notes: '' });
    this.rows.clear();
    for (const n of ['Glucosa en ayuno', 'Colesterol total', 'Triglicéridos']) this.addFromCatalog(n);
    this.file.set(null);
    this.rowsError.set('');
    this.adding.set(true);
  }

  protected addRow(): void { this.rows.push(this.newRow()); this.syncUsed(); }
  protected removeRow(i: number): void { this.rows.removeAt(i); this.syncUsed(); }

  protected addFromCatalog(name: string): void {
    const c = LAB_CATALOG.find((x) => x.name === name);
    if (!c) return;
    this.rows.push(this.newRow(c.name, c.unit, c.refMin ?? '', c.refMax ?? ''));
    this.syncUsed();
  }

  /** Al escribir el nombre de un análisis del catálogo se completan su unidad y su rango (si están vacíos). */
  protected onName(i: number): void {
    const row = this.rows.at(i);
    const c = LAB_CATALOG.find((x) => x.name === row.controls.name.value.trim());
    if (c && !row.controls.unit.value && !row.controls.refMin.value && !row.controls.refMax.value) {
      row.patchValue({ unit: c.unit, refMin: c.refMin ?? '', refMax: c.refMax ?? '' });
    }
    this.syncUsed();
  }

  protected save(): void {
    this.form.markAllAsTouched();
    this.rowsError.set('');
    const v = this.form.getRawValue();
    const filled = v.rows.filter((r) => r.name.trim() || r.value.trim());
    if (!filled.length) { this.rowsError.set('Agrega al menos un análisis con su resultado.'); return; }
    if (this.form.invalid || this.fileError()) return;
    const names = filled.map((r) => r.name.trim());
    if (new Set(names).size !== names.length) { this.rowsError.set('Hay análisis repetidos en el estudio.'); return; }
    if (v.takenAt > todayIso()) { this.form.controls.takenAt.setErrors({ futureDate: true }); return; }
    const bad = filled.find((r) => r.refMin && r.refMax && Number(r.refMin) > Number(r.refMax));
    if (bad) { this.rowsError.set(`En «${bad.name}» el mínimo de referencia es mayor que el máximo.`); return; }

    this.saving.set(true);
    const p = this.patient();
    const file = this.file();
    this.labs.add(p.id, { takenAt: v.takenAt, labName: v.labName, notes: v.notes, results: filled }).subscribe({
      next: () => {
        this.adding.set(false);
        this.saving.set(false);
        this.toast.ok('Estudio registrado.');
        if (file) {
          this.patients.addDocument(p, file, { name: `Laboratorio ${formatDate(v.takenAt)}`, category: 'laboratorio', documentDate: v.takenAt, description: v.labName, visibleToPatient: false }).subscribe({
            next: () => this.toast.ok('PDF guardado en Documentos.'),
            error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'El estudio se guardó, pero no se pudo subir el archivo.'),
          });
        }
      },
      error: (e: unknown) => { this.saving.set(false); this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el estudio.'); },
    });
  }

  protected async remove(r: LabReport): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Eliminar estudio', message: `¿Eliminar el estudio del ${formatDate(r.takenAt)}? Se borrarán sus ${r.results.length} resultados.`, confirmLabel: 'Eliminar', tone: 'danger' });
    if (!ok) return;
    this.labs.remove(this.patient().id, r.id).subscribe({
      next: () => this.toast.ok('Estudio eliminado.'),
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo eliminar.'),
    });
  }
}

type RowControls = { name: FormControl<string>; value: FormControl<string>; unit: FormControl<string>; refMin: FormControl<string>; refMax: FormControl<string> };
