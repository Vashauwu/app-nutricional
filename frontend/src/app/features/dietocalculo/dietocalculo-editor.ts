import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { ApiError } from '../../core/api/api-client';
import { DbService } from '../../core/data/db.service';
import { HasUnsavedChanges } from '../../core/guards/unsaved.guard';
import { DietocalculoService, prefillFromPatient } from '../../core/services/dietocalculo.service';
import { PatientsService } from '../../core/services/patients.service';
import { ReproductiveService } from '../../core/services/reproductive.service';
import { ToastService } from '../../core/services/ui.services';
import { ActionMenu, MenuItem as ActionItem } from '../../shared/components/action-menu';
import { Combobox, ComboOption } from '../../shared/components/combobox';
import { Icon, IconName } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { PageHeader } from '../../shared/components/page-header';
import { Badge } from '../../shared/components/ui';
import { downloadBlob, toCsv } from '../../shared/utils/format';
import { DcCalc } from './dc-calc';
import { DcDieto } from './dc-dieto';
import { DcDist, fmtTime } from './dc-dist';
import { DcMenu } from './dc-menu';
import { DietoStore } from './dieto-store';
import { DEFAULT_SLOTS, GROUPS, defaultInputs } from './engine';

type TabId = 'calc' | 'dieto' | 'dist' | 'dieta';
const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'calc', label: 'Cálculos', icon: 'calculator' },
  { id: 'dieto', label: 'Dietocálculo', icon: 'sliders' },
  { id: 'dist', label: 'Distribución', icon: 'layout' },
  { id: 'dieta', label: 'Dieta', icon: 'dish' },
];

@Component({
  selector: 'app-dietocalculo-editor',
  imports: [PageHeader, RouterLink, TuiButton, Icon, Badge, Combobox, Modal, ActionMenu, DcCalc, DcDieto, DcDist, DcMenu],
  providers: [DietoStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar { display: grid; gap: var(--space-4); }
    .tabs button { display: inline-flex; align-items: center; gap: var(--space-2); }
    .kcal { font-size: 1.375rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .prev { display: grid; gap: var(--space-4); }
    .prev h3 { margin: 0; font-size: 1.0625rem; font-family: var(--nutri-font-ui); }
    .prev ul { margin: .25rem 0 0; padding: 0; list-style: none; display: grid; gap: .125rem; }
    .prev li { display: flex; justify-content: space-between; gap: var(--space-3); }
  `,
  template: `
    @let res = s.r();
    <section class="page" aria-labelledby="dce-title">
      <app-page-header [title]="name() || 'Nueva dieta'" sub="Cálculos, prescripción, cuadro dietosintético y distribución por tiempo de comida.">
        <a tuiButton size="m" appearance="secondary" routerLink="/dietocalculo" class="no-print"><app-icon name="arrow-left" [size]="18" /> Dietas</a>
        <button tuiButton type="button" size="m" appearance="secondary" class="no-print" (click)="previewOpen.set(true)"><app-icon name="eye" [size]="18" /> Vista previa</button>
        <app-action-menu text="Exportar" icon="download" label="Exportar la dieta" [items]="exportItems" />
        <button tuiButton type="button" size="m" class="no-print" [disabled]="saving() || s.hasErrors()" (click)="save()"><app-icon name="save" [size]="18" /> {{ saving() ? 'Guardando…' : 'Guardar' }}</button>
      </app-page-header>

      <section class="panel bar" aria-label="Datos de la dieta">
        <div class="form-grid">
          <div class="field"><label for="dc-name">Nombre de la dieta</label><input id="dc-name" class="input" [value]="name()" maxlength="120" (input)="onName($event)" /></div>
          <app-combobox label="Enlazar con un paciente" placeholder="Sin paciente (dieta suelta)" [options]="patientOptions()" [value]="patientId()" (valueChange)="link($event)" />
        </div>
        @if (patientId()) {
          <div class="row no-print">
            <app-icon name="link" [size]="18" />
            <span>Enlazada con <strong>{{ patientName() }}</strong>.</span>
            <button type="button" class="link-btn" (click)="prefill()">Traer datos del expediente (peso, talla, edad, embarazo)</button>
          </div>
        }
        <div class="row" role="status" aria-label="Resumen de la prescripción">
          <span class="kcal">{{ res.energy.prescription_kcal }} kcal</span>
          <app-badge tone="accent">{{ res.macros.carbs_pct }} % HCO · {{ res.macros.carbs_g }} g</app-badge>
          <app-badge tone="accent">{{ res.macros.lipids_pct }} % LIP · {{ res.macros.lipids_g }} g</app-badge>
          <app-badge tone="accent">{{ res.macros.protein_pct }} % PRO · {{ res.macros.protein_g }} g</app-badge>
        </div>
        @if (s.hasErrors()) { <div class="callout callout--crit" role="alert"><app-icon name="alert" /><div class="callout-body"><strong>Revisa los datos marcados.</strong> Mientras tanto se muestra el último cálculo válido y no se puede guardar.</div></div> }
      </section>

      <div class="tabs no-print" role="tablist" aria-label="Secciones del dietocálculo" (keydown)="onTabKey($event)">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [id]="'dct-' + t.id" [attr.aria-selected]="tab() === t.id" [attr.aria-controls]="'dcp-' + t.id" [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="tab.set(t.id)">
            <app-icon [name]="t.icon" [size]="18" /> {{ t.label }}
          </button>
        }
      </div>

      <div role="tabpanel" [id]="'dcp-' + tab()" [attr.aria-labelledby]="'dct-' + tab()" class="stack">
        @switch (tab()) {
          @case ('calc') { <app-dc-calc (goDieto)="tab.set('dieto')" /> }
          @case ('dieto') { <app-dc-dieto /> }
          @case ('dist') { <app-dc-dist /> }
          @case ('dieta') { <app-dc-menu /> }
        }
      </div>
      <p class="small muted">Herramienta de apoyo profesional: las fórmulas son estimaciones publicadas (Mifflin-St Jeor, Harris-Benedict, Owen, FAO/OMS, Katch-McArdle, Durnin-Womersley, NOM-008, IOM) y no sustituyen el criterio clínico.</p>
    </section>

    <app-modal [(open)]="previewOpen" title="Vista previa de la dieta" size="wide">
      <div class="prev">
        <p class="m-0"><strong>{{ name() }}</strong>@if (patientName()) { · {{ patientName() }} }<br />{{ res.energy.prescription_kcal }} kcal · HCO {{ res.macros.carbs_g }} g · PRO {{ res.macros.protein_g }} g · LIP {{ res.macros.lipids_g }} g</p>
        <div class="dc-grid">
          @for (sl of res.distribution; track $index) {
            @if (sl.pct > 0) {
              <div class="dc-tile">
                <h3>{{ sl.name }} <span class="dc-sub">{{ time(sl.time) }} · {{ sl.totals.kcal }} kcal</span></h3>
                <ul>@for (g of groupList; track g.code) { @if (sl.equivalents[g.code]) { <li><span>{{ g.name }}</span><b>{{ sl.equivalents[g.code] }}</b></li> } }</ul>
                @if (menuOf(sl.name).length) { <p class="dc-sub m-0">{{ menuText(sl.name) }}</p> }
              </div>
            }
          }
        </div>
      </div>
      <button modalFooter tuiButton type="button" size="m" appearance="secondary" (click)="print()"><app-icon name="printer" [size]="18" /> Imprimir</button>
    </app-modal>
  `,
})
export class DietocalculoEditor implements HasUnsavedChanges {
  protected readonly s = inject(DietoStore);
  private readonly svc = inject(DietocalculoService);
  private readonly data = inject(DbService);
  private readonly patients = inject(PatientsService);
  private readonly repro = inject(ReproductiveService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly tabs = TABS;
  protected readonly groupList = GROUPS;
  protected readonly time = fmtTime;
  protected readonly tab = signal<TabId>('calc');
  protected readonly name = signal('Nueva dieta');
  protected readonly patientId = signal('');
  protected readonly saving = signal(false);
  protected readonly previewOpen = signal(false);
  private readonly id = signal<string | null>(null);
  private snapshot = '';

  protected readonly patientOptions = computed<ComboOption[]>(() =>
    this.data.db().patients.filter((p) => !p.deletedAt).map((p) => ({ id: p.id, label: `${p.profile.firstName} ${p.profile.lastName}`, hint: p.profile.email })));
  protected readonly patientName = computed(() => this.patientOptions().find((o) => o.id === this.patientId())?.label ?? '');

  protected readonly exportItems: ActionItem[] = [
    { label: 'Imprimir o guardar como PDF', icon: 'printer', run: () => this.print() },
    { label: 'Descargar equivalentes (CSV)', icon: 'download', run: () => this.csvEquivalents() },
    { label: 'Descargar dieta con alimentos (CSV)', icon: 'download', run: () => this.csvMenu() },
  ];

  constructor() {
    this.patients.loadAll().subscribe({ error: () => undefined });
    const id = this.route.snapshot.paramMap.get('id');
    const preset = this.route.snapshot.queryParamMap.get('paciente');
    if (id) {
      this.svc.get(id).subscribe({
        next: (d) => {
          this.id.set(d.id); this.name.set(d.name); this.patientId.set(d.patientId ?? '');
          this.s.set({ ...defaultInputs(), ...d.inputs, slots: d.inputs.slots?.length ? d.inputs.slots : DEFAULT_SLOTS.map((x) => ({ ...x })) });
          this.mark();
        },
        error: () => { this.toast.error('No se encontró la dieta.'); void this.router.navigateByUrl('/dietocalculo'); },
      });
    } else {
      this.mark();
      if (preset) this.link(preset, true);
    }
  }

  private key(): string { return JSON.stringify({ n: this.name(), p: this.patientId(), i: this.s.inp() }); }
  private mark(): void { this.snapshot = this.key(); }
  hasUnsavedChanges(): boolean { return !this.saving() && this.key() !== this.snapshot; }
  protected onName(e: Event): void { this.name.set((e.target as HTMLInputElement).value); }

  protected onTabKey(e: KeyboardEvent): void {
    const i = TABS.findIndex((t) => t.id === this.tab());
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    this.tab.set(TABS[next].id);
    queueMicrotask(() => document.getElementById('dct-' + TABS[next].id)?.focus());
  }

  // ---------- Paciente ----------
  protected link(id: string, autoPrefill = false): void {
    this.patientId.set(id);
    if (id && (this.name() === 'Nueva dieta' || this.name().startsWith('Dieta de '))) this.name.set(`Dieta de ${this.patientName()}`);
    if (id && autoPrefill) this.prefill();
  }

  /** Trae del expediente la edad, el sexo, el peso, la talla, los perímetros y el embarazo vigente. */
  protected prefill(): void {
    const id = this.patientId();
    if (!id) return;
    const apply = (): void => {
      const p = this.data.db().patients.find((x) => x.id === id);
      if (!p) { this.toast.error('No se encontró al paciente.'); return; }
      this.s.set(prefillFromPatient(p, this.repro.of(id), this.s.inp()));
      this.toast.ok('Datos del expediente aplicados.');
    };
    this.patients.load(id).subscribe({
      error: () => this.toast.error('No se pudo cargar el expediente.'),
      complete: () => this.repro.load(id).subscribe({ error: () => apply(), complete: apply }),
    });
  }

  // ---------- Guardar ----------
  protected save(): void {
    if (this.s.hasErrors() || !this.name().trim()) { this.toast.error('Escribe un nombre y corrige los datos marcados.'); return; }
    this.saving.set(true);
    this.svc.save(this.id(), { name: this.name(), patientId: this.patientId() || null, patientName: this.patientName(), inputs: this.s.inp() }).subscribe({
      next: (d) => {
        this.saving.set(false);
        const created = !this.id();
        this.id.set(d.id);
        this.mark();
        this.toast.ok(created ? 'Dieta guardada.' : 'Dieta actualizada.');
        if (created) void this.router.navigate(['/dietocalculo', d.id], { replaceUrl: true });
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.toast.error(e instanceof ApiError && Object.keys(e.fields).length ? 'Revisa los datos marcados.' : e instanceof Error ? e.message : 'No se pudo guardar.');
      },
    });
  }

  // ---------- Vista previa y exportación ----------
  protected menuOf(slot: string): { name: string; qty_n: number; qty?: string }[] { return this.s.inp().menu?.[slot] ?? []; }
  protected menuText(slot: string): string { return this.menuOf(slot).map((x) => `${x.name} (${x.qty_n} ${x.qty ?? 'porción'})`).join(' · '); }
  protected print(): void { window.print(); }

  private fileName(ext: string): string { return `${(this.name() || 'dieta').trim().replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.${ext}`; }

  private csvEquivalents(): void {
    const r = this.s.r();
    const rows: (string | number)[][] = [['Grupo', ...r.distribution.map((x) => x.name), 'Total', 'kcal', 'Proteína (g)', 'Lípidos (g)', 'Carbohidratos (g)']];
    for (const g of r.dietosintetico.rows) {
      if (g.equivalents <= 0) continue;
      rows.push([g.name, ...r.distribution.map((x) => x.equivalents[g.code] ?? 0), g.equivalents, g.kcal, g.protein_g, g.lipids_g, g.carbs_g]);
    }
    rows.push(['Total', ...r.distribution.map((x) => x.totals.kcal), '', r.dietosintetico.totals.kcal, r.dietosintetico.totals.protein_g, r.dietosintetico.totals.lipids_g, r.dietosintetico.totals.carbs_g]);
    downloadBlob(this.fileName('csv'), toCsv(rows), 'text/csv;charset=utf-8');
  }

  private csvMenu(): void {
    const rows: (string | number)[][] = [['Tiempo', 'Hora', 'Tipo', 'Elemento', 'Cantidad', 'Unidad', 'kcal', 'Proteína (g)', 'Lípidos (g)', 'Carbohidratos (g)', 'Fibra (g)']];
    const t = (x: number): number => Math.round(x * 10) / 10;
    for (const sl of this.s.r().distribution) {
      for (const it of this.s.inp().menu?.[sl.name] ?? []) {
        const k = it.qty_n;
        rows.push([sl.name, sl.time ?? '', it.kind === 'dish' ? 'Platillo' : 'Alimento', it.name, k, it.qty ?? 'porción', t(it.kcal * k), t(it.protein_g * k), t(it.lipids_g * k), t(it.carbs_g * k), t(it.fiber_g * k)]);
      }
    }
    if (rows.length === 1) { this.toast.info('Aún no hay platillos ni alimentos en la dieta.'); return; }
    downloadBlob(this.fileName('csv'), toCsv(rows), 'text/csv;charset=utf-8');
  }
}
