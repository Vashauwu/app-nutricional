import { ChangeDetectionStrategy, Component, computed, inject, input, signal, effect, untracked } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { InsightsService } from '../../core/services/insights.service';
import { ApiClient } from '../../core/api/api-client';
import { PlansService } from '../../core/services/plans.service';
import { TrackingService } from '../../core/services/tracking.service';
import { PatientsService } from '../../core/services/patients.service';
import { GOAL_LABEL } from '../../shared/models/domain';
import { BarChart, LineChart, LineSeries, Ring } from '../../shared/components/charts';
import { Icon } from '../../shared/components/icon';
import { Badge, EmptyState } from '../../shared/components/ui';
import { ToastService } from '../../core/services/ui.services';
import { addDays, downloadBlob, formatDate, shortDate, todayIso, toCsv } from '../../shared/utils/format';

const METRICS = [
  { key: 'weight', label: 'Peso', unit: 'kg' }, { key: 'bmi', label: 'IMC', unit: '' }, { key: 'waist', label: 'Cintura', unit: 'cm' },
  { key: 'hip', label: 'Cadera', unit: 'cm' }, { key: 'fat', label: '% grasa', unit: '%' },
] as const;

@Component({
  selector: 'app-reports',
  imports: [TuiButton, Icon, EmptyState, LineChart, BarChart, Ring],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .controls { display: grid; gap: var(--space-3); grid-template-columns: minmax(14rem, 2fr) repeat(2, minmax(9rem, 1fr)); align-items: end; }
    @media (max-width: 44rem) { .controls { grid-template-columns: minmax(0, 1fr); } }
    .print-head { display: none; }
    @media print { .print-head { display: block; border-block-end: 2px solid #000; padding-block-end: .5rem; margin-block-end: 1rem; } .panel { break-inside: avoid; border-color: #bbb; } }
    .delta { font-variant-numeric: tabular-nums; font-weight: 600; }
  `,
  template: `
    <div class="page">
      <header class="page-header no-print">
        <div><h1>Reportes</h1><p class="sub">Evolución antropométrica, cumplimiento y comparativas. El cumplimiento se reporta por separado de la evolución.</p></div>
        <div class="actions">
          <button tuiButton type="button" size="m" appearance="secondary" [disabled]="!patient()" (click)="exportCsv()"><app-icon name="download" [size]="18" /> Excel / CSV</button>
          <button tuiButton type="button" size="m" [disabled]="!patient()" (click)="print()"><app-icon name="printer" [size]="18" /> Exportar PDF</button>
        </div>
      </header>

      <section class="panel no-print" aria-label="Parámetros del reporte">
        <div class="controls">
          <div class="field"><label for="r-p">Paciente</label><select id="r-p" class="select" (change)="patientIdSel.set($any($event.target).value)"><option value="">Selecciona un paciente…</option>@for (p of patientList(); track p.id) { <option [value]="p.id" [selected]="p.id === patientId()">{{ name(p.id) }}</option> }</select></div>
          <div class="field"><label for="r-f">Desde</label><input id="r-f" class="input" type="date" [value]="from()" (change)="from.set($any($event.target).value)" /></div>
          <div class="field"><label for="r-t">Hasta</label><input id="r-t" class="input" type="date" [value]="to()" [max]="today" (change)="to.set($any($event.target).value)" /></div>
        </div>
        @if (rangeInvalid()) { <p class="error" role="alert">La fecha inicial debe ser anterior a la final.</p> }
      </section>

      @if (patient(); as p) {
        <div class="print-head">
          <h2>{{ brand().businessName }}</h2><p>{{ brand().credentials }} · {{ brand().licenseNumber }}</p><p>{{ brand().phone }} · {{ brand().email }}</p>
          <p><strong>Reporte de {{ name(p.id) }}</strong> · {{ fd(from()) }} al {{ fd(to()) }} · Objetivo: {{ goalLabel[p.goal] }}</p>
        </div>

        @if (!rangeInvalid()) {
          <div class="grid grid--2">
            <section class="panel" aria-labelledby="h-cum">
              <h2 id="h-cum" class="panel-head" style="font-size: 1.125rem">Cumplimiento del periodo</h2>
              @if (overall().planned) {
                <div class="row"><app-ring [pct]="overall().pct ?? 0" label="cumplido" />
                  <div><p><strong>{{ overall().done }}</strong> de {{ overall().planned }} comidas realizadas</p><p class="small muted">{{ overall().skipped }} omitidas · {{ overall().pending }} sin registro</p><p class="small muted">Criterio: realizadas ÷ programadas hasta hoy.</p></div></div>
              } @else { <app-empty icon="calendar" title="Sin comidas programadas" text="No hay planes publicados en este periodo." /> }
            </section>
            <section class="panel" aria-labelledby="h-obj">
              <h2 id="h-obj" class="panel-head" style="font-size: 1.125rem">Progreso respecto al objetivo</h2>
              <p><strong>{{ progress().label }}</strong></p><p class="muted">{{ progress().detail }}</p>
              @if (progress().pct !== null) { <div class="meter" role="img" [attr.aria-label]="progress().pct + '% de avance estimado'"><span [style.inline-size.%]="progress().pct"></span></div><p class="small muted">Avance estimado {{ progress().pct }} % (orientativo; no sustituye tu valoración clínica).</p> }
            </section>
          </div>

          <section class="panel" aria-labelledby="h-evo">
            <div class="panel-head"><h2 id="h-evo">Evolución antropométrica</h2>
              <div class="chips no-print" role="group" aria-label="Variable">@for (m of metrics; track m.key) { <button type="button" class="chip-toggle" [attr.aria-pressed]="metric() === m.key" (click)="metric.set(m.key)">{{ m.label }}</button> }</div></div>
            @if (series()[0].points.length) {
              <app-line-chart [series]="series()" [unit]="current().unit" [title]="'Evolución de ' + current().label.toLowerCase()" />
              <div class="table-wrap"><table class="table"><caption class="visually-hidden">Resumen de cambios</caption><thead><tr><th scope="col">Variable</th><th scope="col" class="num">Primera</th><th scope="col" class="num">Última</th><th scope="col" class="num">Cambio</th></tr></thead><tbody>
                @for (r of summary(); track r.label) { <tr><td>{{ r.label }}</td><td class="num">{{ r.first }}</td><td class="num">{{ r.last }}</td><td class="num delta">{{ r.delta }}</td></tr> }
              </tbody></table></div>
            } @else { <app-empty icon="scale" title="Sin mediciones en el periodo" /> }
          </section>

          <section class="panel" aria-labelledby="h-wk">
            <h2 id="h-wk" class="panel-head" style="font-size: 1.125rem">Cumplimiento semanal (comidas programadas vs realizadas)</h2>
            <app-bar-chart [data]="weekly()" aLabel="Programadas" bLabel="Realizadas" title="Cumplimiento semanal" />
          </section>

          <section class="panel" aria-labelledby="h-kc">
            <h2 id="h-kc" class="panel-head" style="font-size: 1.125rem">Energía planeada frente a registrada (kcal por día)</h2>
            <app-bar-chart [data]="energy()" aLabel="Planeada" bLabel="Registrada" title="Energía planeada frente a registrada" />
            <p class="small muted">"Registrada" suma la energía de los platillos marcados como realizados; no mide porciones reales consumidas.</p>
          </section>
        }

        <section class="panel no-print" aria-labelledby="h-cmp">
          <h2 id="h-cmp" class="panel-head" style="font-size: 1.125rem">Comparativa entre periodos</h2>
          <p class="small muted">Periodo A: {{ fd(cmpA().from) }} – {{ fd(cmpA().to) }} (anterior de igual duración) · Periodo B: {{ fd(from()) }} – {{ fd(to()) }}</p>
          <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Indicador</th><th scope="col" class="num">Periodo A</th><th scope="col" class="num">Periodo B</th><th scope="col" class="num">Cambio</th></tr></thead><tbody>
            <tr><td>Cumplimiento</td><td class="num">{{ cmp().a.compliance.pct ?? '—' }}%</td><td class="num">{{ cmp().b.compliance.pct ?? '—' }}%</td><td class="num delta">{{ cmpDelta() }}</td></tr>
            <tr><td>Comidas realizadas</td><td class="num">{{ cmp().a.compliance.done }}/{{ cmp().a.compliance.planned }}</td><td class="num">{{ cmp().b.compliance.done }}/{{ cmp().b.compliance.planned }}</td><td class="num">—</td></tr>
            <tr><td>Peso al cierre (kg)</td><td class="num">{{ cmp().a.weight ?? '—' }}</td><td class="num">{{ cmp().b.weight ?? '—' }}</td><td class="num delta">{{ weightDelta() }}</td></tr>
          </tbody></table></div>
        </section>
      } @else {
        <div class="panel"><app-empty icon="chart" title="Elige un paciente" text="Selecciona un paciente y un periodo para ver su evolución, cumplimiento y comparativas." /></div>
      }
    </div>
  `,
})
export class Reports {
  private readonly api = inject(ApiClient);
  private readonly plansSvc = inject(PlansService);
  private readonly tracking = inject(TrackingService);
  private readonly insights = inject(InsightsService);
  private readonly patients = inject(PatientsService);
  private readonly data = inject(DbService);
  private readonly toast = inject(ToastService);

  /** /reportes?paciente=p-ana */
  readonly paciente = input<string>();
  protected readonly today = todayIso();
  protected readonly patientIdSel = signal<string | null>(null);
  protected readonly patientId = computed(() => this.patientIdSel() ?? this.paciente() ?? '');
  protected readonly from = signal(addDays(todayIso(), -27));
  protected readonly to = signal(todayIso());
  protected readonly metric = signal<(typeof METRICS)[number]['key']>('weight');
  protected readonly metrics = METRICS;
  protected readonly goalLabel = GOAL_LABEL;
  protected readonly fd = formatDate;

  protected readonly patientList = computed(() => this.patients.all());
  protected readonly patient = computed(() => (this.data.version(), this.patients.get(this.patientId())));
  protected readonly brand = computed(() => this.data.db().settings.brand);
  protected readonly rangeInvalid = computed(() => this.from() > this.to());
  protected name = (id: string): string => this.data.patientName(id);
  protected readonly current = computed(() => METRICS.find((m) => m.key === this.metric())!);

  private readonly anthro = computed(() => (this.patient() ? this.insights.anthropometrics(this.patient()!) : null));
  protected readonly series = computed<LineSeries[]>(() => {
    const a = this.anthro();
    const pts = (a?.[this.metric()] ?? []).filter((p) => p.date >= this.from() && p.date <= this.to());
    return [{ label: this.current().label, points: pts }];
  });
  protected readonly summary = computed(() => {
    const a = this.anthro();
    if (!a) return [];
    return METRICS.map((m) => {
      const pts = a[m.key].filter((p) => p.date >= this.from() && p.date <= this.to());
      if (!pts.length) return null;
      const d = pts[pts.length - 1].value - pts[0].value;
      return { label: `${m.label}${m.unit ? ` (${m.unit})` : ''}`, first: pts[0].value, last: pts[pts.length - 1].value, delta: `${d > 0 ? '+' : ''}${d.toFixed(1)}` };
    }).filter((x): x is NonNullable<typeof x> => !!x);
  });

  protected readonly daily = computed(() => (this.patient() && !this.rangeInvalid() ? (this.data.version(), this.insights.dailySeries(this.patientId(), this.from(), this.to())) : []));
  protected readonly overall = computed(() => {
    const d = this.daily();
    const planned = d.reduce((a, x) => a + x.planned, 0);
    const done = d.reduce((a, x) => a + x.done, 0);
    const past = d.filter((x) => x.date <= this.today).reduce((a, x) => a + x.planned, 0);
    return { planned: past, done, skipped: 0, pending: past - done, pct: past ? Math.round((done / past) * 100) : null, total: planned };
  });
  protected readonly weekly = computed(() => {
    const out: { label: string; a: number; b: number }[] = [];
    const d = this.daily();
    for (let i = 0; i < d.length; i += 7) {
      const chunk = d.slice(i, i + 7);
      out.push({ label: shortDate(chunk[0].date), a: chunk.reduce((s, x) => s + x.planned, 0), b: chunk.reduce((s, x) => s + x.done, 0) });
    }
    return out;
  });
  protected readonly energy = computed(() => this.daily().filter((x) => x.planned).slice(-14).map((x) => ({ label: shortDate(x.date), a: x.plannedKcal, b: x.date <= this.today ? x.recordedKcal : undefined })));
  protected readonly progress = computed(() => (this.patient() ? this.insights.goalProgress(this.patient()!) : { label: '', detail: '', pct: null }));

  protected readonly cmpA = computed(() => {
    const span = Math.max(1, Math.round((new Date(this.to()).getTime() - new Date(this.from()).getTime()) / 86_400_000) + 1);
    return { from: addDays(this.from(), -span), to: addDays(this.from(), -1) };
  });
  protected readonly cmp = computed(() => (this.data.version(), this.insights.compare(this.patientId(), this.cmpA(), { from: this.from(), to: this.to() })));
  protected readonly cmpDelta = computed(() => {
    const a = this.cmp().a.compliance.pct;
    const b = this.cmp().b.compliance.pct;
    return a === null || b === null ? '—' : `${b - a > 0 ? '+' : ''}${b - a} pts`;
  });
  protected readonly weightDelta = computed(() => {
    const a = this.cmp().a.weight;
    const b = this.cmp().b.weight;
    if (!a || !b) return '—';
    const d = Number(b) - Number(a);
    return `${d > 0 ? '+' : ''}${d.toFixed(1)} kg`;
  });

  constructor() {
    // Modo API: se cargan los datos del paciente elegido (expediente, planes con días y registros del periodo).
    this.patients.loadAll().subscribe({ error: () => undefined });
    effect(() => {
      const id = this.patientId();
      const from = this.from();
      const to = this.to();
      if (!id || from > to) return;
      untracked(() => {
        this.patients.load(id).subscribe({ error: () => undefined });
        this.plansSvc.loadForPatient(id).subscribe({ error: () => undefined });
        this.tracking.loadRange(id, addDays(from, -(Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1)), to).subscribe({ error: () => undefined });
      });
    });
  }

  private download(path: string, params: Record<string, string>, filename: string): void {
    this.api.blob(path, params).subscribe({
      next: (b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename; a.click(); URL.revokeObjectURL(a.href); this.toast.ok('Descarga lista. Quedó registrada en auditoría.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo generar el archivo.'),
    });
  }

  protected exportCsv(): void {
    const p = this.patient();
    if (!p) return;
    if (this.api.enabled) {
      this.download(`/exports/patients/${p.id}/measurements`, { format: 'xlsx' }, `mediciones-${p.id}.xlsx`);
      this.download(`/exports/patients/${p.id}/tracking`, { format: 'xlsx', from: this.from(), to: this.to() }, `seguimiento-${p.id}.xlsx`);
      return;
    }
    const meas = [['Fecha', 'Peso (kg)', 'IMC', 'Cintura (cm)', 'Cadera (cm)', 'Grasa (%)'], ...p.measurements.filter((m) => m.measuredAt >= this.from() && m.measuredAt <= this.to()).map((m) => [m.measuredAt, m.weightKg, m.bmi, m.waistCm, m.hipCm, m.bodyFatPct])];
    const comp = [[], ['Fecha', 'Comidas programadas', 'Comidas realizadas', 'kcal planeadas', 'kcal registradas'], ...this.daily().map((d) => [d.date, d.planned, d.done, d.plannedKcal, d.recordedKcal])];
    downloadBlob(`reporte-${p.id}-${this.from()}_${this.to()}.csv`, toCsv([...meas, ...comp]), 'text/csv;charset=utf-8');
    this.patients.logExport(p.id, 'reporte (CSV)');
    this.toast.ok('Exportación generada y registrada en auditoría.');
  }

  protected print(): void {
    const p = this.patient();
    if (p && this.api.enabled) {
      this.download(`/reports/patients/${p.id}/summary.pdf`, { from: this.from(), to: this.to() }, `reporte-${p.id}.pdf`);
      return;
    }
    if (p) this.patients.logExport(p.id, 'reporte (PDF)');
    window.print();
  }
}
