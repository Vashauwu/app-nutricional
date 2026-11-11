import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { DishesService, SubstituteCandidate } from '../../core/services/dishes.service';
import { PatientsService } from '../../core/services/patients.service';
import { ToastService } from '../../core/services/ui.services';
import { diffNutrients } from '../../core/nutrition/engine';
import { Badge, EmptyState } from '../../shared/components/ui';
import { DishThumb, EqChips, Macros } from '../../shared/components/nutrition-bits';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { fmt, fmtCompact, formatDate, formatDateTime } from '../../shared/utils/format';

@Component({
  selector: 'app-dish-detail',
  imports: [RouterLink, TuiButton, Icon, Badge, EmptyState, DishThumb, EqChips, Macros, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .hero { display: grid; gap: var(--space-5); grid-template-columns: minmax(0, 18rem) 1fr; align-items: start; }
    @media (max-width: 52rem) { .hero { grid-template-columns: minmax(0, 1fr); } }
    .tiles { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); }
    .tiles div { padding: var(--space-3); border-radius: var(--radius-s); background: var(--nutri-marfil); } .tiles b { display: block; font-size: 1.375rem; font-variant-numeric: tabular-nums; } .tiles span { font-size: .8125rem; color: var(--muted); }
    ol.steps { margin: 0; padding-inline-start: 1.25rem; display: grid; gap: var(--space-2); }
    .ver-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    pre { white-space: pre-wrap; font: inherit; margin: 0; }
  `,
  template: `
    @if (dish(); as d) {
      <div class="page">
        <nav class="breadcrumb" aria-label="Migas de pan"><a routerLink="/platillos">Platillos</a><app-icon name="chevron-right" [size]="14" /><span aria-current="page">{{ d.name }}</span></nav>
        <header class="page-header">
          <div>
            <div class="row"><app-badge tone="accent">{{ d.category }}</app-badge>@if (d.status === 'inactive') { <app-badge icon="ban">Inactivo</app-badge> }</div>
            <h1>{{ d.name }}</h1>
            <p class="sub">{{ v().description }}</p>
          </div>
          <div class="actions">
            <a tuiButton size="m" [routerLink]="['/platillos', d.id, 'editar']"><app-icon name="edit" [size]="18" /> Editar (nueva versión)</a>
            <button tuiButton type="button" size="m" appearance="secondary" (click)="duplicate()"><app-icon name="copy" [size]="18" /> Duplicar</button>
            <button tuiButton type="button" size="m" appearance="secondary" (click)="toggle()">{{ d.status === 'active' ? 'Desactivar' : 'Activar' }}</button>
          </div>
        </header>

        <div class="ver-row" role="group" aria-label="Versión del platillo">
          <label for="ver" class="small"><strong>Versión</strong></label>
          <select id="ver" class="select" style="max-inline-size: 16rem" (change)="view.set(+$any($event.target).value)">
            @for (x of versionsDesc(); track x.versionNumber) { <option [value]="x.versionNumber" [selected]="x.versionNumber === v().versionNumber">v{{ x.versionNumber }}{{ x.versionNumber === d.currentVersion ? ' (vigente)' : '' }} · {{ fd(x.createdAt) }}</option> }
          </select>
          @if (v().versionNumber !== d.currentVersion) { <app-badge tone="warn" icon="history">Versión histórica de solo lectura</app-badge> }
          <span class="small muted">Usado en {{ usage() }} plan(es) activo(s)</span>
        </div>

        <div class="hero">
          <app-dish-thumb [category]="d.category" [src]="v().image?.dataUrl" [alt]="v().image?.alt ?? ''" [size]="48" />
          <section class="panel" aria-labelledby="h-nut">
            <h2 id="h-nut" class="panel-head" style="font-size: 1.125rem">Valor nutricional por porción</h2>
            <div class="tiles">
              <div><b>{{ c(v().nutrition.perServing.energy) }}</b><span>kcal</span></div>
              <div><b>{{ c(v().nutrition.perServing.protein, 1) }} g</b><span>Proteínas</span></div>
              <div><b>{{ c(v().nutrition.perServing.carbs, 1) }} g</b><span>Carbohidratos</span></div>
              <div><b>{{ c(v().nutrition.perServing.lipids, 1) }} g</b><span>Lípidos</span></div>
              <div><b>{{ c(v().nutrition.perServing.fiber, 1) }} g</b><span>Fibra</span></div>
            </div>
            <div class="eyebrow">Equivalentes SMAE por porción</div>
            <app-eq-chips [eq]="v().nutrition.equivalents" />
            <p class="small muted">Rinde {{ v().servings }} porción(es) · {{ v().prepTimeMinutes }} min de preparación · Edición: {{ editionName() }}</p>
          </section>
        </div>

        <section class="panel panel--flush" aria-labelledby="h-ing">
          <div class="panel-head"><h2 id="h-ing">Ingredientes</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Ingrediente</th><th scope="col" class="num">Cantidad capturada</th><th scope="col" class="num">Normalizada (g)</th><th scope="col" class="num">kcal</th><th scope="col" class="num">P / C / L (g)</th><th scope="col">Equivalente</th></tr></thead><tbody>
            @for (i of v().ingredients; track i.id) {
              <tr><td><strong>{{ i.nameSnapshot }}</strong> @if (!i.official) { <app-badge tone="warn" icon="alert">Personalizado</app-badge> }</td><td class="num">{{ i.quantity }} {{ i.unit }}</td><td class="num">{{ c(i.grams, 1) }}</td><td class="num">{{ c(i.nutrients.energy) }}</td><td class="num">{{ c(i.nutrients.protein, 1) }} / {{ c(i.nutrients.carbs, 1) }} / {{ c(i.nutrients.lipids, 1) }}</td><td>@if (i.equivalent) { {{ c(i.equivalent.value, 2) }} · {{ i.equivalent.subgroupCode }} } @else { <span class="muted">—</span> }</td></tr>
            }
          </tbody></table></div>
        </section>

        <div class="grid grid--2">
          <section class="panel" aria-labelledby="h-prep">
            <h2 id="h-prep" class="panel-head" style="font-size: 1.125rem">Preparación</h2>
            @if (v().recipeMode === 'structured') {
              <ol class="steps">@for (s of v().steps; track $index) { <li>{{ s }}</li> } @empty { <li class="muted">Sin pasos capturados.</li> }</ol>
            } @else { <pre>{{ v().instructionsText }}</pre> }
            @if (v().recommendations) { <div class="callout"><app-icon name="info" /><div class="callout-body"><strong>Recomendaciones</strong><p>{{ v().recommendations }}</p></div></div> }
          </section>

          <section class="panel" aria-labelledby="h-prov">
            <h2 id="h-prov" class="panel-head" style="font-size: 1.125rem">Cálculo reproducible</h2>
            <p class="small">Calculado el {{ fdt(v().nutrition.calculatedAt) }} con el motor <code>{{ v().nutrition.engineVersion }}</code> y {{ editionName() }}. Se conservan las cantidades originales, las normalizadas y las fuentes de cada ingrediente.</p>
            <p class="small muted">Versión {{ v().versionNumber }} · {{ v().createdBy }} · {{ fdt(v().createdAt) }}<br />Motivo: {{ v().changeReason }}</p>
          </section>
        </div>

        <section class="panel panel--flush" aria-labelledby="h-sub">
          <div class="panel-head"><h2 id="h-sub">Sustituciones autorizadas</h2><button tuiButton type="button" size="s" (click)="openSuggest()"><app-icon name="swap" [size]="16" /> Sugerir sustitutos</button></div>
          <p class="small muted" style="padding: 0 var(--space-5)">Las pacientes solo ven alternativas que tú autorizas; no pueden modificar la composición nutricional.</p>
          <ul class="list-plain list-rows">
            @for (s of v().substitutions; track s.id) {
              <li><div class="grow"><strong>{{ s.label }}</strong><p class="small muted">{{ s.rule }} · autorizó {{ s.approvedBy }} el {{ fd(s.approvedAt) }}@if (s.note) { · {{ s.note }} }</p><app-macros [n]="s.diff" /> <span class="small muted">(diferencia por porción)</span></div>
                <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Quitar sustituto ' + s.label" (click)="removeSub(s.id)"><app-icon name="trash" [size]="18" /></button></li>
            } @empty { <li><app-empty icon="swap" title="Sin sustitutos autorizados" text="Usa las sugerencias automáticas basadas en equivalentes y revisa cada una." /></li> }
          </ul>
        </section>

        <section class="panel panel--flush" aria-labelledby="h-hist">
          <div class="panel-head"><h2 id="h-hist">Historial de versiones</h2><span class="small muted">Inmutables: nunca se sobrescriben.</span></div>
          <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Versión</th><th scope="col">Fecha</th><th scope="col">Autor</th><th scope="col">Motivo</th><th scope="col" class="num">kcal/porción</th><th scope="col" class="num">Cambio</th></tr></thead><tbody>
            @for (x of history(); track x.versionNumber) {
              <tr><td><button type="button" class="link-btn" (click)="view.set(x.versionNumber)">v{{ x.versionNumber }}</button>@if (x.versionNumber === d.currentVersion) { <app-badge tone="ok">Vigente</app-badge> }</td><td>{{ fdt(x.createdAt) }}</td><td>{{ x.createdBy }}</td><td class="small">{{ x.changeReason }}</td><td class="num">{{ c(x.nutrition.perServing.energy) }}</td><td class="num">{{ x.delta === null ? '—' : (x.delta > 0 ? '+' : '') + x.delta }}</td></tr>
            }
          </tbody></table></div>
        </section>
      </div>

      <app-modal [(open)]="suggestOpen" title="Sugerir sustitutos" size="wide">
        <p class="small muted">Candidatos de la misma categoría con energía similar. Elige un paciente para revisar alergias y restricciones. Cada sustituto exige tu autorización.</p>
        <div class="field" style="max-inline-size: 24rem"><label for="sp">Evaluar contra el paciente</label><select id="sp" class="select" (change)="ctxPatient.set($any($event.target).value); refreshCandidates()"><option value="">Sin paciente específico</option>@for (p of patientList(); track p.id) { <option [value]="p.id">{{ name(p) }}</option> }</select></div>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Platillo</th><th scope="col" class="num">Δ kcal</th><th scope="col" class="num">Δ P / C / L (g)</th><th scope="col">Motivo de la sugerencia</th><th scope="col"><span class="visually-hidden">Acción</span></th></tr></thead><tbody>
          @for (cnd of candidates(); track cnd.dish.id) {
            <tr><td><strong>{{ cnd.dish.name }}</strong>@for (cf of cnd.conflicts; track cf) { <div><app-badge tone="crit" icon="alert">{{ cf }}</app-badge></div> }</td>
              <td class="num">{{ sg(cnd.diff.energy, 0) }}</td><td class="num">{{ sg(cnd.diff.protein, 1) }} / {{ sg(cnd.diff.carbs, 1) }} / {{ sg(cnd.diff.lipids, 1) }}</td><td class="small">{{ cnd.reason }}</td>
              <td><button tuiButton type="button" size="s" [appearance]="cnd.conflicts.length ? 'secondary-destructive' : 'primary'" (click)="authorize(cnd)">{{ cnd.conflicts.length ? 'Autorizar de todos modos' : 'Autorizar' }}</button></td></tr>
          } @empty { <tr><td colspan="5" class="muted">No hay candidatos con energía similar en la misma categoría.</td></tr> }
        </tbody></table></div>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="suggestOpen.set(false)">Cerrar</button></ng-container>
      </app-modal>
    } @else {
      <div class="page"><app-empty icon="dish" title="Platillo no encontrado"><a tuiButton routerLink="/platillos" appearance="secondary" size="m">Volver a la biblioteca</a></app-empty></div>
    }
  `,
})
export class DishDetail {
  private readonly dishes = inject(DishesService);
  private readonly patients = inject(PatientsService);
  private readonly data = inject(DbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  protected readonly view = signal<number | null>(null);
  protected readonly suggestOpen = signal(false);
  protected readonly ctxPatient = signal('');

  protected readonly c = fmtCompact;
  protected readonly fd = formatDate;
  protected readonly fdt = formatDateTime;
  protected readonly dish = computed(() => (this.data.version(), this.dishes.get(this.id())));
  protected readonly v = computed(() => {
    const d = this.dish()!;
    return d.versions.find((x) => x.versionNumber === (this.view() ?? d.currentVersion)) ?? this.dishes.current(d);
  });
  protected readonly versionsDesc = computed(() => [...(this.dish()?.versions ?? [])].sort((a, b) => b.versionNumber - a.versionNumber));
  protected readonly history = computed(() => {
    const asc = [...(this.dish()?.versions ?? [])].sort((a, b) => a.versionNumber - b.versionNumber);
    return asc.map((x, i) => ({ ...x, delta: i ? Number(fmt(diffNutrients(x.nutrition.perServing, asc[i - 1].nutrition.perServing).energy, 0)) : null })).reverse();
  });
  protected readonly usage = signal(0);
  protected readonly editionName = computed(() => this.data.db().editions.find((e) => e.id === this.v().nutrition.smaeEditionId)?.name ?? 'edición registrada');
  protected readonly patientList = computed(() => this.patients.all());
  protected readonly candidates = signal<SubstituteCandidate[]>([]);

  constructor() {
    // Modo API: trae la versión completa (y la que se esté consultando) y el uso en planes.
    effect(() => {
      const id = this.id();
      const v = this.view();
      untracked(() => {
        this.dishes.load(id, v ?? undefined).subscribe({ error: () => undefined });
        this.dishes.usage(id).subscribe({ next: (n) => this.usage.set(n), error: () => undefined });
      });
    });
  }

  protected refreshCandidates(): void {
    const p = this.ctxPatient() ? this.patients.get(this.ctxPatient()) : undefined;
    this.dishes.candidatesFor(this.id(), p).subscribe({ next: (l) => this.candidates.set(l), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') });
  }
  protected name = (p: { profile: { firstName: string; lastName: string } }): string => `${p.profile.firstName} ${p.profile.lastName}`;
  protected sg = (v: string, p: number): string => { const n = Number(v); return (n > 0 ? '+' : '') + n.toFixed(p); };

  protected openSuggest(): void { this.refreshCandidates(); this.suggestOpen.set(true); }

  protected authorize(cnd: SubstituteCandidate): void {
    this.dishes.addSubstitution(this.id(), this.v().versionNumber, {
      type: 'dish', label: cnd.dish.name, dishId: cnd.dish.id, dishVersion: cnd.version.versionNumber, note: cnd.conflicts.length ? `Autorizado con advertencia: ${cnd.conflicts.join('; ')}` : '', rule: cnd.reason, diff: cnd.diff,
    }).subscribe({ next: () => this.toast.ok(`"${cnd.dish.name}" autorizado como sustituto.`), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') });
  }

  protected removeSub(id: string): void { this.dishes.removeSubstitution(this.id(), this.v().versionNumber, id).subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') }); }

  protected duplicate(): void {
    this.dishes.duplicate(this.id()).subscribe({
      next: (copy) => { this.toast.ok('Platillo duplicado.'); void this.router.navigate(['/platillos', copy, 'editar']); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  protected toggle(): void {
    const d = this.dish()!;
    const wasActive = d.status === 'active';
    this.dishes.setActive(d.id, !wasActive).subscribe({ next: () => this.toast.ok(wasActive ? 'Platillo desactivado.' : 'Platillo activado.'), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') });
  }
}
