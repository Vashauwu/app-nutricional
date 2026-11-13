import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TuiButton } from '@taiga-ui/core';
import { ReproductiveService } from '../../core/services/reproductive.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { Patient } from '../../shared/models/domain';
import { FieldError } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { Badge } from '../../shared/components/ui';
import { formatDate, todayIso } from '../../shared/utils/format';

const intRange = (min: number, max: number) => (c: AbstractControl): ValidationErrors | null => {
  const v = String(c.value ?? '').trim();
  if (!v) return null;
  return /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max ? null : { range: { min, max } };
};

const notFuture = (c: AbstractControl): ValidationErrors | null => (c.value && String(c.value) > todayIso() ? { futureDate: true } : null);

const DAY = 86_400_000;
/** Días transcurridos desde una fecha (AAAA-MM-DD) hasta hoy. */
function daysSince(iso: string): number {
  const a = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(todayIso() + 'T00:00:00Z');
  return Math.round((b - a) / DAY);
}
function ago(iso: string): string {
  const n = daysSince(iso);
  if (n <= 0) return 'hoy';
  if (n === 1) return 'ayer';
  if (n < 60) return `hace ${n} días`;
  const m = Math.floor(n / 30);
  return m < 24 ? `hace ${m} meses` : `hace ${Math.floor(m / 12)} años`;
}

/**
 * «Salud reproductiva» del expediente: menarca, historial de última menstruación y embarazo vigente.
 * Aplica a pacientes mujeres (y «Otro»). Solo la nutrióloga lo captura y lo ve; no se muestra en la app de la paciente.
 */
@Component({
  selector: 'app-reproductive-card',
  imports: [ReactiveFormsModule, TuiButton, Icon, Modal, FieldError, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: var(--space-3); }
    .fact { display: grid; gap: .25rem; align-content: start; padding: var(--space-3) var(--space-4); border-radius: var(--radius-m); background: var(--nutri-marfil); }
    .fact .k { font-size: .8125rem; color: var(--muted); } .fact .v { font-size: 1.125rem; font-weight: 700; } .fact p { margin: 0; }
    .preg { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; padding: var(--space-3) var(--space-4); border-radius: var(--radius-m); background: var(--nutri-rosa); color: var(--nutri-texto-fuerte); }
    .preg p { margin: 0; } .preg .t { font-weight: 700; }
    .hist { margin: 0; padding: 0; list-style: none; display: grid; gap: .25rem; }
    .hist li { display: flex; justify-content: space-between; gap: var(--space-3); font-variant-numeric: tabular-nums; }
  `,
  template: `
    @if (applies()) {
      <section class="panel" aria-labelledby="h-repro">
        <div class="panel-head">
          <h2 id="h-repro">Salud reproductiva</h2>
          <span class="small muted">Solo la ves tú; la paciente no la ve en su app.</span>
        </div>

        @if (repro().pregnancy; as g) {
          <div class="preg" role="status">
            <app-icon name="info" />
            <div>
              <p class="t">Embarazada · {{ g.currentWeeks }} {{ g.currentWeeks === 1 ? 'semana' : 'semanas' }} de gestación</p>
              <p class="small">Fecha probable de parto: {{ fd(g.dueDate) }} · registrado el {{ fd(g.recordedOn) }} con {{ g.weeksAtStart }} sem.@if (g.notes) { · {{ g.notes }} }</p>
            </div>
            <button tuiButton type="button" size="s" appearance="secondary" (click)="endPregnancy(g.id)">Finalizar embarazo</button>
          </div>
        }

        <div class="facts">
          <div class="fact">
            <span class="k">Menarca (primera menstruación)</span>
            @if (repro().menarcheAge !== undefined) { <span class="v">{{ repro().menarcheAge }} años</span> }
            @else if (repro().menarcheUnknown) { <span class="v">No recuerda</span> }
            @else { <span class="v muted">Sin capturar</span> }
            <div><button tuiButton type="button" size="xs" appearance="secondary" (click)="openMenarche()">{{ repro().menarcheAge !== undefined || repro().menarcheUnknown ? 'Editar' : 'Capturar' }}</button></div>
          </div>
          <div class="fact">
            <span class="k">Última menstruación</span>
            @if (lastPeriod(); as p) { <span class="v">{{ fd(p.date) }}</span><p class="small muted">{{ ago(p.date) }}</p> }
            @else { <span class="v muted">Sin capturar</span> }
            <div><button tuiButton type="button" size="xs" appearance="secondary" (click)="openPeriod()"><app-icon name="plus" [size]="14" /> Registrar</button></div>
          </div>
          <div class="fact">
            <span class="k">Embarazo</span>
            @if (repro().pregnancy) { <span class="v">Vigente</span><p class="small muted">Finalízalo para registrar otro.</p> }
            @else { <span class="v muted">No registrado</span> }
            @if (!repro().pregnancy) { <div><button tuiButton type="button" size="xs" appearance="secondary" (click)="openPregnancy()"><app-icon name="plus" [size]="14" /> Registrar embarazo</button></div> }
          </div>
        </div>

        @if (repro().periods.length > 1 || pastPregnancies().length) {
          <div class="facts">
            @if (repro().periods.length > 1) {
              <div>
                <h3 class="small muted" style="margin: 0 0 .25rem">Fechas anteriores de última menstruación</h3>
                <ul class="hist">@for (p of repro().periods.slice(1, 7); track p.id) { <li><span>{{ fd(p.date) }}</span><span class="muted small">{{ ago(p.date) }}</span></li> }</ul>
              </div>
            }
            @if (pastPregnancies().length) {
              <div>
                <h3 class="small muted" style="margin: 0 0 .25rem">Embarazos anteriores</h3>
                <ul class="hist">@for (g of pastPregnancies(); track g.id) { <li><span>{{ fd(g.recordedOn) }} – {{ fd(g.endedOn) }}</span><app-badge>{{ g.currentWeeks }} sem.</app-badge></li> }</ul>
              </div>
            }
          </div>
        }
      </section>

      <app-modal [(open)]="menarcheOpen" title="Menarca" size="narrow">
        <form [formGroup]="menarcheForm" id="menarche-form" (ngSubmit)="saveMenarche()" class="stack" novalidate>
          <div class="field">
            <label for="mn-age">Edad de la primera menstruación (años)</label>
            <input id="mn-age" class="input" inputmode="numeric" formControlName="age" aria-describedby="mn-age-e" />
            <app-field-error id="mn-age-e" [control]="menarcheForm.controls.age" [messages]="{ range: 'Escribe una edad entre 8 y 20 años.' }" />
          </div>
          <label class="check"><input type="checkbox" formControlName="unknown" /> La paciente no recuerda</label>
        </form>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="menarcheOpen.set(false)">Cancelar</button><button tuiButton type="submit" form="menarche-form" size="m" [disabled]="busy()">Guardar</button></ng-container>
      </app-modal>

      <app-modal [(open)]="periodOpen" title="Última menstruación" size="narrow">
        <form [formGroup]="periodForm" id="period-form" (ngSubmit)="savePeriod()" class="stack" novalidate>
          <div class="field">
            <label for="pd-date">Fecha de inicio de la última menstruación</label>
            <input id="pd-date" class="input" type="date" [max]="today" formControlName="date" aria-describedby="pd-date-e" />
            <app-field-error id="pd-date-e" [control]="periodForm.controls.date" />
          </div>
          <p class="small muted">Cada fecha se guarda en el historial; las anteriores no se pierden.</p>
        </form>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="periodOpen.set(false)">Cancelar</button><button tuiButton type="submit" form="period-form" size="m" [disabled]="busy()">Guardar</button></ng-container>
      </app-modal>

      <app-modal [(open)]="pregnancyOpen" title="Registrar embarazo" size="narrow">
        <form [formGroup]="pregnancyForm" id="pregnancy-form" (ngSubmit)="savePregnancy()" class="stack" novalidate>
          <div class="field">
            <label for="pg-weeks">Semanas de gestación hoy</label>
            <input id="pg-weeks" class="input" inputmode="numeric" formControlName="weeks" aria-describedby="pg-weeks-e" />
            <app-field-error id="pg-weeks-e" [control]="pregnancyForm.controls.weeks" [messages]="{ range: 'Escribe las semanas de gestación (de 1 a 42).' }" />
          </div>
          <div class="field"><label for="pg-notes">Notas (opcional)</label><input id="pg-notes" class="input" maxlength="500" formControlName="notes" placeholder="Ej. embarazo de bajo riesgo, náuseas en el primer trimestre" /></div>
          <p class="small muted">Con las semanas se calcula la fecha probable de parto (semana 40) y el avance de las semanas.</p>
        </form>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="pregnancyOpen.set(false)">Cancelar</button><button tuiButton type="submit" form="pregnancy-form" size="m" [disabled]="busy()">Guardar</button></ng-container>
      </app-modal>
    }
  `,
})
export class ReproductiveCard {
  private readonly svc = inject(ReproductiveService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  readonly patient = input.required<Patient>();

  protected readonly fd = formatDate;
  protected readonly ago = ago;
  protected readonly today = todayIso();
  protected readonly busy = signal(false);
  protected readonly menarcheOpen = signal(false);
  protected readonly periodOpen = signal(false);
  protected readonly pregnancyOpen = signal(false);

  protected readonly applies = computed(() => this.patient().profile.sex !== 'M');
  protected readonly repro = computed(() => this.svc.of(this.patient().id));
  protected readonly lastPeriod = computed(() => this.repro().periods[0]);
  protected readonly pastPregnancies = computed(() => this.repro().pregnancies.filter((g) => !g.active));

  protected readonly menarcheForm = this.fb.nonNullable.group({ age: ['', intRange(8, 20)], unknown: [false] });
  protected readonly periodForm = this.fb.nonNullable.group({ date: ['', [Validators.required, notFuture]] });
  protected readonly pregnancyForm = this.fb.nonNullable.group({ weeks: ['', [Validators.required, intRange(1, 42)]], notes: [''] });

  private fail(e: unknown, fallback: string): void {
    this.busy.set(false);
    this.toast.error(e instanceof Error ? e.message : fallback);
  }

  protected openMenarche(): void {
    const r = this.repro();
    this.menarcheForm.reset({ age: r.menarcheAge !== undefined ? String(r.menarcheAge) : '', unknown: r.menarcheUnknown });
    this.menarcheOpen.set(true);
  }
  protected saveMenarche(): void {
    const { age, unknown } = this.menarcheForm.getRawValue();
    if (!unknown && !age.trim()) this.menarcheForm.controls.age.setErrors({ required: true });
    this.menarcheForm.markAllAsTouched();
    if (this.menarcheForm.invalid) return;
    this.busy.set(true);
    this.svc.setMenarche(this.patient().id, unknown ? undefined : Number(age), unknown).subscribe({
      next: () => { this.busy.set(false); this.menarcheOpen.set(false); this.toast.ok('Menarca guardada.'); },
      error: (e: unknown) => this.fail(e, 'No se pudo guardar la menarca.'),
    });
  }

  protected openPeriod(): void { this.periodForm.reset({ date: '' }); this.periodOpen.set(true); }
  protected savePeriod(): void {
    this.periodForm.markAllAsTouched();
    if (this.periodForm.invalid) return;
    this.busy.set(true);
    this.svc.addPeriod(this.patient().id, this.periodForm.controls.date.value).subscribe({
      next: () => { this.busy.set(false); this.periodOpen.set(false); this.toast.ok('Fecha registrada en el historial.'); },
      error: (e: unknown) => this.fail(e, 'No se pudo guardar la fecha.'),
    });
  }

  protected openPregnancy(): void { this.pregnancyForm.reset({ weeks: '', notes: '' }); this.pregnancyOpen.set(true); }
  protected savePregnancy(): void {
    this.pregnancyForm.markAllAsTouched();
    if (this.pregnancyForm.invalid) return;
    this.busy.set(true);
    const v = this.pregnancyForm.getRawValue();
    this.svc.addPregnancy(this.patient().id, Number(v.weeks), v.notes).subscribe({
      next: () => { this.busy.set(false); this.pregnancyOpen.set(false); this.toast.ok('Embarazo registrado.'); },
      error: (e: unknown) => this.fail(e, 'No se pudo registrar el embarazo.'),
    });
  }

  protected async endPregnancy(id: string): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Finalizar embarazo', message: 'Se cierra el embarazo vigente con la fecha de hoy y queda en el historial. ¿Continuar?', confirmLabel: 'Finalizar' });
    if (!ok) return;
    this.svc.endPregnancy(this.patient().id, id).subscribe({
      next: () => this.toast.ok('Embarazo finalizado.'),
      error: (e: unknown) => this.fail(e, 'No se pudo finalizar el embarazo.'),
    });
  }
}
