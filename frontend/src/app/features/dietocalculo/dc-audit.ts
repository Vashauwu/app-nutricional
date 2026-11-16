import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { Badge } from '../../shared/components/ui';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { ToastService } from '../../core/services/ui.services';
import { OBJECTIVES, ObjectiveId, applyPlan, audit } from './audit';
import { DietoStore } from './dieto-store';

/** Modal «Inteligencia de equivalentes»: propone (Empírico) o revisa (Auditar) el reparto contra un objetivo clínico. */
@Component({
  selector: 'app-dc-audit',
  imports: [TuiButton, Badge, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
    @media (max-width: 40rem) { .top { grid-template-columns: minmax(0, 1fr); } .top .dc-seg { justify-self: stretch; display: grid; grid-template-columns: 1fr 1fr; } }
    .hd { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
    .hd h3 { margin: 0; display: inline-flex; align-items: center; gap: var(--space-2); font-size: 1.0625rem; font-family: var(--nutri-font-ui); }
    .hd .r { display: inline-flex; align-items: center; gap: var(--space-2); }
    .adj { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .adj li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-m); min-inline-size: 0; }
    .adj .nm { font-weight: 600; min-inline-size: 0; overflow-wrap: anywhere; }
    .adj .vv { display: inline-flex; align-items: center; gap: var(--space-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .adj .vv b { color: var(--brand-ink); }
    .legal summary { cursor: pointer; display: inline-flex; align-items: center; gap: .375rem; min-block-size: var(--tap); }
    .legal p { margin: 0; }
    ul.why { margin: 0; padding-inline-start: 1.25rem; display: grid; gap: .25rem; }
  `,
  template: `
    @let a = au();
    <app-modal [(open)]="open" title="Inteligencia de equivalentes" size="wide">
      <div class="stack">
        <div class="top">
          <div class="field">
            <label for="au-obj">Objetivo clínico</label>
            <select id="au-obj" class="select" [value]="obj()" (change)="obj.set(val($event))">
              @for (o of objectives; track o.id) { <option [value]="o.id" [selected]="o.id === obj()">{{ o.name }}</option> }
            </select>
          </div>
          <div class="dc-seg" role="radiogroup" aria-label="Modo">
            <button type="button" role="radio" [attr.aria-checked]="mode() === 'emp'" (click)="mode.set('emp')"><app-icon name="sparkles" [size]="16" /> Empírico</button>
            <button type="button" role="radio" [attr.aria-checked]="mode() === 'aud'" (click)="mode.set('aud')"><app-icon name="refresh" [size]="16" /> Auditar</button>
          </div>
        </div>
        <p class="dc-sub m-0">{{ a.objective.note }} Reparto {{ a.objective.macros.join('-') }} (HCO-LIP-PRO).</p>

        <section class="dc-card" aria-labelledby="au-idx">
          <div class="hd">
            <h3 id="au-idx"><app-icon name="gauge" [size]="18" /> Índice de practicidad culinaria</h3>
            <span class="r"><app-badge [tone]="a.realism.band">{{ a.realism.label }}</app-badge><b>{{ a.realism.score }} %</b></span>
          </div>
          <div class="dc-bar" role="img" [attr.aria-label]="'Practicidad: ' + a.realism.score + ' de 100'"><i class="b-c" [style.inline-size.%]="a.realism.score"></i></div>
          <p class="dc-sub m-0">Propuesta: <b>{{ a.suggestedKcal }} kcal</b> · Actual: <b>{{ a.currentKcal }} kcal</b></p>
          @if (a.realism.reasons.length) {
            <details class="legal"><summary class="link-btn">Por qué este puntaje ({{ a.realism.reasons.length }})</summary>
              <ul class="why">@for (r of a.realism.reasons; track r) { <li>{{ r }}</li> }</ul>
            </details>
          }
        </section>

        @if (a.deviations.length) {
          <div class="callout callout--warn" role="status"><app-icon name="alert" /><div class="callout-body">Desviación de 1.5 equivalentes o más respecto a la propuesta en: {{ devNames() }}.</div></div>
        } @else {
          <div class="callout callout--ok" role="status"><app-icon name="check" /><div class="callout-body">Sin desvíos de 1.5 equivalentes o más respecto a la propuesta para este objetivo.</div></div>
        }

        @if (mode() === 'emp') {
          <section class="stack--s" aria-labelledby="au-adj">
            <div class="hd"><h3 id="au-adj" class="dc-cap">Ajustes sugeridos por grupo</h3><span class="dc-sub">Actual → Sugerido</span></div>
            @if (a.adjustments.length) {
              <ul class="adj">
                @for (x of a.adjustments; track x.code) {
                  <li><span class="nm">{{ x.name }}</span>
                    <span class="vv">{{ x.current }} → <b>{{ x.suggested }} eq</b> <app-badge [tone]="abs(x.delta) >= 1.5 ? 'warn' : 'neutral'">{{ x.delta > 0 ? '+' : '' }}{{ x.delta }}</app-badge></span>
                  </li>
                }
              </ul>
            } @else { <p class="dc-sub m-0">Tu reparto ya coincide con la propuesta.</p> }
          </section>
        } @else {
          <section class="stack--s" aria-labelledby="au-chk">
            <h3 id="au-chk" class="dc-cap">Criterios del objetivo</h3>
            <div class="dc-box">
              <table class="mini auto">
                <caption class="visually-hidden">Criterios del objetivo contra el reparto actual</caption>
                <thead><tr><th scope="col" class="small muted">Criterio</th><th scope="col" class="small muted">Esperado</th><th scope="col" class="small muted">Actual</th><th scope="col" class="small muted">Estado</th></tr></thead>
                <tbody>
                  @for (c of a.checks; track c.label) {
                    <tr><th scope="row">{{ c.label }}</th><td>{{ c.expected }}</td><td>{{ c.actual }}</td>
                      <td><app-badge [tone]="c.ok ? 'ok' : 'warn'" [icon]="c.ok ? 'check' : 'alert'">{{ c.ok ? 'Cumple' : 'Revisar' }}</app-badge></td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        <details class="legal">
          <summary class="link-btn"><app-icon name="shield" [size]="16" /> Aviso legal</summary>
          <p class="dc-sub">Orientación basada en recomendaciones generales de alimentación. No considera diagnósticos, medicamentos ni preferencias del paciente y no sustituye el criterio del profesional de la salud. Revisa siempre el cuadro antes de usarlo.</p>
        </details>
      </div>
      @if (mode() === 'emp') { <button modalFooter tuiButton type="button" size="m" appearance="secondary" [disabled]="!a.deviations.length" (click)="apply(true)">Aplicar solo desvíos</button> }
      @if (mode() === 'emp') { <button modalFooter tuiButton type="button" size="m" [disabled]="!a.adjustments.length" (click)="apply(false)"><app-icon name="check" [size]="18" /> Aplicar propuesta</button> }
      @if (mode() === 'aud') { <button modalFooter tuiButton type="button" size="m" (click)="mode.set('emp')">Ver propuesta</button> }
    </app-modal>
  `,
})
export class DcAudit {
  private readonly s = inject(DietoStore);
  private readonly toast = inject(ToastService);
  readonly open = model(false);
  protected readonly objectives = OBJECTIVES;
  protected readonly obj = signal<ObjectiveId>('general');
  protected readonly mode = signal<'emp' | 'aud'>('emp');
  protected readonly au = computed(() => audit(this.s.inp(), this.s.r(), this.obj()));
  protected readonly devNames = computed(() => this.au().deviations.map((d) => d.name).join(', '));
  protected readonly abs = Math.abs;
  protected val(e: Event): ObjectiveId { return (e.target as HTMLSelectElement).value as ObjectiveId; }

  protected apply(onlyDeviations: boolean): void {
    this.s.patch(applyPlan(this.s.inp(), this.au(), onlyDeviations));
    this.toast.ok(onlyDeviations ? 'Se corrigieron los grupos desviados. El reparto por tiempos se recalculó.' : 'Propuesta aplicada. El reparto por tiempos se recalculó.');
    this.open.set(false);
  }
}
