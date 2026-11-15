import { firstValueFrom } from 'rxjs';
import { isApiMode } from '../../core/api/api-client';
import { PatientAppApi } from '../../core/api/patient-app-api';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal, effect, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { TrackingService } from '../../core/services/tracking.service';
import { ToastService } from '../../core/services/ui.services';
import { Icon } from '../../shared/components/icon';
import { EqChips, DishThumb } from '../../shared/components/nutrition-bits';
import { EmptyState } from '../../shared/components/ui';
import { div, mul } from '../../shared/utils/decimal';
import { fmtCompact, formatDateTime, longDate } from '../../shared/utils/format';
import { processImage } from '../../shared/utils/image';
import { PatientContext } from './patient-context';
import { scaleEquivalents } from '../../core/nutrition/engine';

@Component({
  selector: 'app-patient-dish',
  imports: [RouterLink, ReactiveFormsModule, TuiButton, Icon, EqChips, DishThumb, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-2); text-align: center; }
    .tiles div { padding: var(--space-2); border-radius: var(--radius-s); background: var(--nutri-marfil); } .tiles b { display: block; font-size: 1.125rem; font-variant-numeric: tabular-nums; } .tiles span { font-size: .75rem; color: var(--muted); }
    ul.ing { margin: 0; padding: 0; list-style: none; } ul.ing li { display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) 0; border-block-end: 1px solid var(--line); }
    ol { margin: 0; padding-inline-start: 1.25rem; display: grid; gap: var(--space-2); }
    .photos { display: flex; flex-wrap: wrap; gap: var(--space-2); } .photos img { inline-size: 5.5rem; block-size: 5.5rem; object-fit: cover; border-radius: var(--radius-s); }
    .msg { padding: .5rem .75rem; border-radius: var(--radius-s); background: var(--nutri-cielo); max-inline-size: 92%; } .msg.nutri { background: var(--nutri-lavanda); } .msg b { font-size: .8125rem; } .msg time { font-size: .75rem; color: var(--muted); margin-inline-start: .4rem; }
    pre { white-space: pre-wrap; font: inherit; margin: 0; }
  `,
  template: `
    <div class="stack">
      <a routerLink="/paciente" [queryParams]="{ fecha: fecha() }" class="small"><app-icon name="arrow-left" [size]="14" /> Volver a {{ longDate(fecha()) }}</a>
      @if (vm(); as v) {
        @if (v.dish && v.version) {
          <app-dish-thumb [category]="v.dish.category" [src]="v.version.image?.dataUrl" [alt]="v.version.image?.alt ?? ''" [size]="48" />
          <header><p class="eyebrow">{{ v.slot.name }}</p><h1 style="font-size: 1.625rem">{{ v.dish.name }}</h1><p class="muted">{{ v.version.description }}</p></header>
          @if (v.item.instructions) { <div class="callout callout--warn"><app-icon name="info" /><div class="callout-body"><strong>Indicación para este platillo</strong><p>{{ v.item.instructions }}</p></div></div> }

          <section class="panel" aria-labelledby="h-n">
            <h2 id="h-n" class="panel-head" style="font-size: 1.0625rem">Tu porción ({{ v.item.servings }} {{ v.item.servings === '1' ? 'porción' : 'porciones' }})</h2>
            <div class="tiles"><div><b>{{ c(v.totals.nutrients.energy) }}</b><span>kcal</span></div><div><b>{{ c(v.totals.nutrients.protein, 1) }}</b><span>Prot. (g)</span></div><div><b>{{ c(v.totals.nutrients.carbs, 1) }}</b><span>Carb. (g)</span></div><div><b>{{ c(v.totals.nutrients.lipids, 1) }}</b><span>Lip. (g)</span></div></div>
            <div class="eyebrow">Equivalentes SMAE</div><app-eq-chips [eq]="eq()" />
          </section>

          <section class="panel" aria-labelledby="h-i">
            <h2 id="h-i" class="panel-head" style="font-size: 1.0625rem">Ingredientes para tu porción</h2>
            <ul class="ing">@for (i of ingredients(); track i.id) { <li><span>{{ i.name }}</span><strong>{{ i.qty }} {{ i.unit }}</strong></li> }</ul>
          </section>

          <section class="panel" aria-labelledby="h-p">
            <h2 id="h-p" class="panel-head" style="font-size: 1.0625rem">Preparación · {{ v.version.prepTimeMinutes }} min</h2>
            @if (v.version.recipeMode === 'structured') { <ol>@for (s of v.version.steps; track $index) { <li>{{ s }}</li> }</ol> } @else { <pre>{{ v.version.instructionsText }}</pre> }
            @if (v.version.recommendations) { <div class="callout"><app-icon name="leaf" /><div class="callout-body">{{ v.version.recommendations }}</div></div> }
          </section>

          @if (v.version.substitutions.length) {
            <section class="panel" aria-labelledby="h-s">
              <h2 id="h-s" class="panel-head" style="font-size: 1.0625rem">Alternativas autorizadas por tu nutrióloga</h2>
              <ul class="ing">@for (s of v.version.substitutions; track s.id) { <li><span>{{ s.label }}</span><span class="small muted">≈ {{ c(s.diff.energy) }} kcal de diferencia</span></li> }</ul>
              <p class="small muted">Solo puedes elegir entre estas opciones; si necesitas otra, coméntalo abajo.</p>
            </section>
          }

          <section class="panel" aria-labelledby="h-t">
            <h2 id="h-t" class="panel-head" style="font-size: 1.0625rem">Mi seguimiento</h2>
            <div class="row" role="group" aria-label="Estado de esta comida">
              <button tuiButton type="button" size="m" [appearance]="v.entry?.status === 'done' ? 'primary' : 'secondary'" [attr.aria-pressed]="v.entry?.status === 'done'" [disabled]="!online()" (click)="mark('done')"><app-icon name="check" [size]="18" /> Realizada</button>
              <button tuiButton type="button" size="m" [appearance]="v.entry?.status === 'skipped' ? 'primary' : 'secondary'" [attr.aria-pressed]="v.entry?.status === 'skipped'" [disabled]="!online()" (click)="mark('skipped')"><app-icon name="skip" [size]="18" /> Omitida</button>
            </div>
            @if (!online()) { <p class="small muted" role="status">Registrar, subir fotos y comentar requieren conexión.</p> }
            @if (v.entry; as e) {
              @if (e.photos.length) { <div class="photos">@for (p of e.photos; track p.id) { <img [src]="p.dataUrl" [alt]="p.alt" loading="lazy" decoding="async" /> }</div> }
              <div class="field"><label for="ph">Agregar fotografía</label><input id="ph" class="input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" [disabled]="!online()" (change)="onPhoto($event)" aria-describedby="ph-h" /><span class="hint" id="ph-h">Solo la ve tu nutrióloga. Se optimiza antes de subirse.</span>@if (photoError()) { <p class="error" role="alert">{{ photoError() }}</p> }</div>
              @if (e.thread.length || e.patientComment) {
                <div class="stack--s" role="log" aria-label="Conversación de esta comida">
                  @if (e.patientComment) { <div class="msg"><b>Tú</b><p>{{ e.patientComment }}</p></div> }
                  @for (m of e.thread; track m.id) { <div class="msg" [class.nutri]="m.authorRole === 'nutritionist'"><b>{{ m.authorRole === 'nutritionist' ? 'Tu nutrióloga' : 'Tú' }}</b><time>{{ fdt(m.at) }}</time><p>{{ m.body }}</p></div> }
                </div>
              }
              <form [formGroup]="form" (ngSubmit)="comment()" class="stack--s">
                <div class="field"><label for="cm">Comentario para tu nutrióloga</label><textarea id="cm" class="textarea" formControlName="body" maxlength="1000" [attr.disabled]="online() ? null : true"></textarea></div>
                <div class="form-actions"><button tuiButton type="submit" size="m" [disabled]="!online() || !form.controls.body.value.trim()"><app-icon name="send" [size]="16" /> Enviar comentario</button></div>
              </form>
            } @else { <p class="small muted">Marca la comida como realizada u omitida para poder agregar fotos y comentarios.</p> }
          </section>
        } @else { <app-empty icon="dish" title="Este platillo ya no está disponible" /> }
      } @else { <app-empty icon="dish" title="No encontramos este platillo" text="Es posible que tu nutrióloga lo haya sustituido."><a tuiButton routerLink="/paciente" size="m" appearance="secondary">Volver a hoy</a></app-empty> }
    </div>
  `,
})
export class PatientDish {
  protected readonly ctx = inject(PatientContext);
  private readonly auth = inject(AuthService);
  private readonly data = inject(DbService);
  private readonly tracking = inject(TrackingService);
  private readonly app = inject(PatientAppApi);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly fecha = input.required<string>();
  readonly item = input.required<string>();
  protected readonly c = (v: string, p = 0): string => fmtCompact(v, p);
  protected readonly fdt = formatDateTime;
  protected readonly longDate = longDate;
  protected readonly online = this.data.isOnline;
  protected readonly photoError = signal('');
  protected readonly form = this.fb.nonNullable.group({ body: [''] });

  protected readonly vm = computed(() => (this.data.version(), this.ctx.findItem(this.fecha(), this.item())));

  constructor() {
    // Modo API: ingredientes, pasos y alternativas del platillo de MI plan.
    effect(() => {
      if (!isApiMode()) return;
      const v = this.vm();
      const key = v ? `${v.item.dishId}:${v.item.dishVersion}` : '';
      if (!key || key === this.loadedKey) return;
      this.loadedKey = key;
      untracked(() => this.app.dish(v!.item.dishId, v!.item.dishVersion).subscribe({ error: () => undefined }));
    });
  }
  private loadedKey = '';
  protected readonly eq = computed(() => (this.vm()?.version ? scaleEquivalents(this.vm()!.version!.nutrition.equivalents, this.vm()!.item.servings) : {}));
  /** Cantidad por la porción de la paciente = cantidad de receta × (porciones asignadas ÷ porciones que rinde la receta). */
  protected readonly ingredients = computed(() => {
    const v = this.vm();
    if (!v?.version) return [];
    const factor = div(v.item.servings, v.version.servings);
    return v.version.ingredients.map((i) => ({ id: i.id, name: i.nameSnapshot, qty: fmtCompact(mul(i.quantity, factor).toString(), 1), unit: i.unit }));
  });

  protected mark(status: 'done' | 'skipped'): void {
    const v = this.vm();
    const pid = this.auth.patientId();
    if (!v || !pid) return;
    const op = v.entry?.status === status
      ? this.tracking.clearRecord(v.plan.id, v.item.id)
      : this.tracking.record({ patientId: pid, plan: v.plan, date: v.date, slot: v.slot, item: v.item, status });
    op.subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar.') });
  }

  protected async onPhoto(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    const v = this.vm();
    this.photoError.set('');
    if (!f || !v?.entry) return;
    try {
      const r = await processImage(f, this.data.db().settings.storage.maxImageBytes);
      await firstValueFrom(this.tracking.addPhoto(v.entry.id, r.dataUrl, `Foto de ${v.dish?.name ?? 'la comida'} (${v.slot.name})`));
      this.toast.ok('Foto enviada a tu nutrióloga.');
    } catch (err) {
      this.photoError.set(err instanceof Error ? err.message : 'No se pudo subir la foto.');
    }
    input.value = '';
  }

  protected comment(): void {
    const v = this.vm();
    if (!v?.entry) return;
    this.tracking.addComment(v.entry.id, 'patient', this.auth.user()?.name ?? 'Paciente', this.form.controls.body.value).subscribe({
      next: () => { this.form.reset({ body: '' }); this.toast.ok('Comentario enviado.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar.'),
    });
  }

  protected back(): void { void this.router.navigate(['/paciente'], { queryParams: { fecha: this.fecha() } }); }
}
