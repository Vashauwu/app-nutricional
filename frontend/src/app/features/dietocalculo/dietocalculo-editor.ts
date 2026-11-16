import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { HasUnsavedChanges } from '../../core/guards/unsaved.guard';
import { ApiError } from '../../core/api/api-client';
import { DietocalculoService, prefillFromPatient } from '../../core/services/dietocalculo.service';
import { PatientsService } from '../../core/services/patients.service';
import { ReproductiveService } from '../../core/services/reproductive.service';
import { ToastService } from '../../core/services/ui.services';
import { Combobox, ComboOption } from '../../shared/components/combobox';
import { Icon } from '../../shared/components/icon';
import { PageHeader } from '../../shared/components/page-header';
import { Badge, Tone } from '../../shared/components/ui';
import {
  ACTIVITY_FACTOR, AMPUTATION_LABEL, Activity, DEFAULT_SLOTS, DietInputs, DietResult, Formula, GROUPS, Classification, compute, defaultInputs, normalize,
} from './engine';

type TabId = 'calc' | 'dieto' | 'dist' | 'dieta';
const TABS: { id: TabId; label: string; icon: 'scale' | 'flame' | 'layout' | 'dish' }[] = [
  { id: 'calc', label: 'Cálculos', icon: 'scale' },
  { id: 'dieto', label: 'Dietocálculo', icon: 'flame' },
  { id: 'dist', label: 'Distribución', icon: 'layout' },
  { id: 'dieta', label: 'Dieta', icon: 'dish' },
];

const ACTIVITY_LABEL: Record<Activity, string> = {
  sedentary: 'Sedentaria (poco o nada de ejercicio)', light: 'Ligera (1–3 días/semana)', moderate: 'Moderada (3–5 días/semana)',
  intense: 'Intensa (6–7 días/semana)', very_intense: 'Muy intensa (doble sesión o trabajo físico)',
};
const FORMULA_LABEL: Record<Formula, string> = {
  mifflin: 'Mifflin-St Jeor (recomendada)', harris: 'Harris-Benedict revisada', fao: 'FAO/OMS/UNU', katch: 'Katch-McArdle (masa magra)', cunningham: 'Cunningham (masa magra)',
};
const TONE: Record<string, Tone> = { ok: 'ok', warn: 'warn', critical: 'crit', info: 'info' };

@Component({
  selector: 'app-dietocalculo-editor',
  imports: [PageHeader, RouterLink, TuiButton, Icon, Badge, Combobox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar { display: grid; gap: var(--space-4); }
    .name { font: inherit; font-size: 1.125rem; font-weight: 600; max-inline-size: 28rem; }
    .chips-kcal { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
    .chips-kcal .big { font-size: 1.375rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .kv { display: grid; grid-template-columns: 1fr auto; gap: .375rem var(--space-4); margin: 0; }
    .kv dt { color: var(--muted); }
    .kv dd { margin: 0; font-weight: 600; text-align: end; font-variant-numeric: tabular-nums; }
    .seg { display: inline-flex; border: 1px solid var(--line); border-radius: var(--radius-m); overflow: hidden; }
    .seg button { min-block-size: var(--field-h); padding: 0 var(--space-5); border: 0; background: var(--surface); color: var(--nutri-texto); font: inherit; cursor: pointer; }
    .seg button[aria-checked='true'] { background: var(--brand-ink); color: var(--surface); font-weight: 600; }
    h2 { margin: 0; font-family: var(--nutri-font-ui); font-size: 1.1875rem; font-weight: 600; }
    .chips { gap: var(--space-2) var(--space-6); }
    .eq-in { max-inline-size: 5.5rem; text-align: end; font-variant-numeric: tabular-nums; }
    .row-fixed { background: color-mix(in srgb, var(--nutri-lavanda) 35%, transparent); }
    tfoot td, tfoot th { font-weight: 700; border-block-start: 2px solid var(--line); }
    .slots-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); }
    .slot { border: 1px solid var(--line); border-radius: var(--radius-m); padding: var(--space-4); display: grid; gap: var(--space-2); background: var(--surface); }
    .slot h3 { margin: 0; font-size: 1.0625rem; font-family: var(--nutri-font-ui); }
    .slot ul { margin: 0; padding: 0; list-style: none; display: grid; gap: .25rem; }
    .slot li { display: flex; justify-content: space-between; gap: var(--space-3); }
    .slot li b { font-variant-numeric: tabular-nums; }
    .sum-ok { color: var(--ok-ink, var(--nutri-texto)); }
    .metric { font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .metric small { font-size: .9rem; font-weight: 500; color: var(--muted); }
    .src { font-size: .8125rem; color: var(--muted); }
    @media print { .no-print { display: none !important; } }
  `,
  template: `
    <section class="page" aria-labelledby="dce-title">
      <app-page-header [title]="name() || 'Nueva dieta'" sub="Cálculos, prescripción, cuadro dietosintético y distribución por tiempo de comida.">
        <a tuiButton size="m" appearance="secondary" routerLink="/dietocalculo" class="no-print"><app-icon name="arrow-left" [size]="18" /> Dietas</a>
        <button tuiButton type="button" size="m" appearance="secondary" class="no-print" (click)="print()"><app-icon name="printer" [size]="18" /> Imprimir</button>
        <button tuiButton type="button" size="m" class="no-print" [disabled]="saving() || hasErrors()" (click)="save()"><app-icon name="save" [size]="18" /> {{ saving() ? 'Guardando…' : 'Guardar' }}</button>
      </app-page-header>

      <section class="panel bar" aria-label="Datos de la dieta">
        <div class="form-grid">
          <div class="field"><label for="dc-name">Nombre de la dieta</label><input id="dc-name" class="input" [value]="name()" maxlength="120" (input)="name.set($any($event.target).value)" /></div>
          <app-combobox label="Enlazar con un paciente" placeholder="Sin paciente (dieta suelta)" [options]="patientOptions()" [value]="patientId()" (valueChange)="link($event)" />
        </div>
        @if (patientId()) {
          <div class="row no-print">
            <app-icon name="link" [size]="18" />
            <span>Enlazada con <strong>{{ patientName() }}</strong>.</span>
            <button type="button" class="link-btn" (click)="prefill()">Traer datos del expediente (peso, talla, edad, embarazo)</button>
          </div>
        }
        @if (r(); as res) {
          <div class="chips-kcal" role="status" aria-label="Resumen de la prescripción">
            <span class="big">{{ res.energy.prescription_kcal }} kcal</span>
            <app-badge tone="accent">{{ res.macros.carbs_pct }} % carbohidratos · {{ res.macros.carbs_g }} g</app-badge>
            <app-badge tone="accent">{{ res.macros.lipids_pct }} % lípidos · {{ res.macros.lipids_g }} g</app-badge>
            <app-badge tone="accent">{{ res.macros.protein_pct }} % proteína · {{ res.macros.protein_g }} g</app-badge>
          </div>
        }
        @if (hasErrors()) { <div class="callout callout--crit" role="alert"><app-icon name="alert" /><div class="callout-body"><strong>Revisa los datos marcados.</strong> Mientras tanto se muestra el último cálculo válido y no se puede guardar.</div></div> }
      </section>

      <div class="tabs no-print" role="tablist" aria-label="Secciones del dietocálculo" (keydown)="onTabKey($event)">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [id]="'dct-' + t.id" [attr.aria-selected]="tab() === t.id" [attr.aria-controls]="'dcp-' + t.id" [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="tab.set(t.id)">
            <app-icon [name]="t.icon" [size]="18" /> {{ t.label }}
          </button>
        }
      </div>

      @if (r(); as res) {
        <div role="tabpanel" [id]="'dcp-' + tab()" [attr.aria-labelledby]="'dct-' + tab()" class="stack">
          @switch (tab()) {
            @case ('calc') {
              <section class="panel stack" aria-labelledby="h-datos">
                <div class="row row--between">
                  <h2 id="h-datos">Datos del paciente</h2>
                  <div class="seg" role="radiogroup" aria-label="Sexo">
                    <button type="button" role="radio" [attr.aria-checked]="inp().sex === 'F'" (click)="patch({ sex: 'F' })">Mujer</button>
                    <button type="button" role="radio" [attr.aria-checked]="inp().sex === 'M'" (click)="patch({ sex: 'M', pregnancy: undefined, lactation: '' })">Hombre</button>
                  </div>
                </div>
                <div class="form-grid">
                  <div class="field"><label for="f-age">Edad (años)</label><input id="f-age" class="input" type="number" inputmode="decimal" min="14" max="110" step="1" [value]="inp().age" [attr.aria-invalid]="!!err('age')" [attr.aria-describedby]="err('age') ? 'e-age' : null" (input)="patch({ age: n($event) })" />@if (err('age')) { <p id="e-age" class="error" role="alert">{{ err('age') }}</p> }</div>
                  <div class="field"><label for="f-w">Peso actual (kg)</label><input id="f-w" class="input" type="number" inputmode="decimal" min="20" max="400" step="0.1" [value]="inp().weight_kg" [attr.aria-invalid]="!!err('weight_kg')" [attr.aria-describedby]="err('weight_kg') ? 'e-w' : null" (input)="patch({ weight_kg: n($event) })" />@if (err('weight_kg')) { <p id="e-w" class="error" role="alert">{{ err('weight_kg') }}</p> }</div>
                  <div class="field"><label for="f-h">Talla (cm)</label><input id="f-h" class="input" type="number" inputmode="decimal" min="100" max="250" step="0.1" [value]="inp().height_cm" [attr.aria-invalid]="!!err('height_cm')" [attr.aria-describedby]="err('height_cm') ? 'e-h' : null" (input)="patch({ height_cm: n($event) })" />@if (err('height_cm')) { <p id="e-h" class="error" role="alert">{{ err('height_cm') }}</p> }</div>
                  <div class="field"><label for="f-bf">% de grasa corporal <span class="muted">(opcional)</span></label><input id="f-bf" class="input" type="number" inputmode="decimal" min="0" max="70" step="0.1" [value]="inp().body_fat_pct ?? ''" (input)="patch({ body_fat_pct: opt($event) })" />@if (err('body_fat_pct')) { <p class="error" role="alert">{{ err('body_fat_pct') }}</p> }</div>
                </div>
                <details class="panel u-pad-3-4" [open]="hasOptional()">
                  <summary><strong>Perímetros, estatura estimada y meta</strong>&nbsp;<span class="muted">(opcionales)</span></summary>
                  <div class="form-grid u-mt-1">
                    <div class="field"><label for="f-waist">Cintura (cm)</label><input id="f-waist" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Ej: 80" [value]="inp().waist_cm ?? ''" (input)="patch({ waist_cm: opt($event) })" /></div>
                    <div class="field"><label for="f-hip">Cadera (cm)</label><input id="f-hip" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Ej: 98" [value]="inp().hip_cm ?? ''" (input)="patch({ hip_cm: opt($event) })" /></div>
                    <div class="field"><label for="f-neck">Cuello (cm)</label><input id="f-neck" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Ej: 36" [value]="inp().neck_cm ?? ''" (input)="patch({ neck_cm: opt($event) })" /></div>
                    <div class="field"><label for="f-wrist">Circunferencia de muñeca (cm)</label><input id="f-wrist" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Ej: 16" [value]="inp().wrist_cm ?? ''" (input)="patch({ wrist_cm: opt($event) })" /></div>
                    <div class="field"><label for="f-knee">Altura de rodilla (cm)</label><input id="f-knee" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Pacientes que no se pueden poner de pie" [value]="inp().knee_height_cm ?? ''" (input)="patch({ knee_height_cm: opt($event) })" /></div>
                    <div class="field"><label for="f-tf">% de grasa meta</label><input id="f-tf" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Ej: 15" [value]="inp().target_fat_pct ?? ''" (input)="patch({ target_fat_pct: opt($event) })" /></div>
                  </div>
                </details>
                <div class="chips" role="group" aria-label="Condiciones especiales">
                  <label class="check"><input type="checkbox" [checked]="inp().athlete" (change)="patch({ athlete: $any($event.target).checked })" /> Deportista</label>
                  <label class="check"><input type="checkbox" [checked]="inp().hospitalized" (change)="patch({ hospitalized: $any($event.target).checked, stress_factor: $any($event.target).checked ? (inp().stress_factor ?? 1.2) : undefined })" /> Hospitalizado</label>
                  <label class="check"><input type="checkbox" [checked]="!!inp().amputations?.length" (change)="patch({ amputations: $any($event.target).checked ? ['foot'] : [] })" /> Amputación</label>
                  @if (inp().sex === 'F') {
                    <label class="check"><input type="checkbox" [checked]="!!inp().pregnancy" (change)="patch({ pregnancy: $any($event.target).checked ? { weeks: 20 } : undefined, lactation: $any($event.target).checked ? '' : inp().lactation })" /> Embarazo</label>
                    <label class="check"><input type="checkbox" [checked]="!!inp().lactation" (change)="patch({ lactation: $any($event.target).checked ? '0-6' : '', pregnancy: $any($event.target).checked ? undefined : inp().pregnancy })" /> Lactancia</label>
                  }
                </div>
                @if (inp().hospitalized) {
                  <div class="field maxw-24"><label for="f-stress">Factor de estrés (1.0 – 2.0)</label><input id="f-stress" class="input" type="number" step="0.05" min="1" max="2" [value]="inp().stress_factor ?? 1.2" (input)="patch({ stress_factor: n($event) })" /></div>
                }
                @if (inp().amputations?.length) {
                  <fieldset class="fieldset-reset" aria-label="Segmentos amputados"><legend class="small muted">Segmentos amputados (el peso se corrige para calcular el IMC)</legend>
                    <div class="chips">@for (a of amputationKeys; track a) { <label class="check"><input type="checkbox" [checked]="inp().amputations!.includes(a)" (change)="toggleAmp(a, $any($event.target).checked)" /> {{ ampLabel[a] }}</label> }</div>
                  </fieldset>
                }
                @if (inp().pregnancy; as pg) {
                  <div class="form-grid">
                    <div class="field"><label for="f-pw">Semanas de gestación</label><input id="f-pw" class="input" type="number" min="1" max="42" [value]="pg.weeks" (input)="patch({ pregnancy: { ...pg, weeks: n($event) } })" />@if (err('pregnancy.weeks')) { <p class="error" role="alert">{{ err('pregnancy.weeks') }}</p> }</div>
                    <div class="field"><label for="f-ppw">Peso pregestacional (kg)</label><input id="f-ppw" class="input" type="number" step="0.1" placeholder="Si no lo sabes, se usa el actual" [value]="pg.pre_weight_kg ?? ''" (input)="patch({ pregnancy: { ...pg, pre_weight_kg: opt($event) } })" /></div>
                    <label class="check"><input type="checkbox" [checked]="!!pg.multiple" (change)="patch({ pregnancy: { ...pg, multiple: $any($event.target).checked } })" /> Embarazo múltiple</label>
                  </div>
                }
                @if (inp().lactation) {
                  <div class="field maxw-24"><label for="f-lac">Meses de lactancia</label><select id="f-lac" class="select" [value]="inp().lactation" (change)="patch({ lactation: $any($event.target).value })"><option value="0-6">0 a 6 meses (+330 kcal)</option><option value="7-12">7 a 12 meses (+400 kcal)</option></select></div>
                }
              </section>

              <div class="grid grid--2">
                <section class="panel stack" aria-labelledby="h-imc">
                  <h2 id="h-imc">Antropometría e IMC (NOM-008)</h2>
                  <p class="metric">{{ res.anthro.bmi }} <small>kg/m²</small></p>
                  <p><app-badge [tone]="tone(res.anthro.bmi_class)">{{ res.anthro.bmi_class.label }}</app-badge></p>
                  @if (res.anthro.bmi_class.note) { <p class="small muted">{{ res.anthro.bmi_class.note }}</p> }
                  <dl class="kv">
                    <dt>Peso usado para el cálculo</dt><dd>{{ res.anthro.weight_used_kg }} kg</dd>
                    <dt>Peso ideal (Devine)</dt><dd>{{ res.anthro.ideal_weight_kg }} kg</dd>
                    <dt>Superficie corporal (Mosteller)</dt><dd>{{ res.anthro.bsa_mosteller }} m²</dd>
                    <dt>Superficie corporal (Du Bois)</dt><dd>{{ res.anthro.bsa_dubois }} m²</dd>
                    @if (res.anthro.waist_hip !== undefined) { <dt>ICC (cintura/cadera)</dt><dd>{{ res.anthro.waist_hip }}</dd> }
                    @if (res.anthro.waist_height !== undefined) { <dt>ICT (cintura/talla)</dt><dd>{{ res.anthro.waist_height }}</dd> }
                    @if (res.anthro.stature_chumlea_cm) { <dt>Estatura estimada (Chumlea)</dt><dd>{{ res.anthro.stature_chumlea_cm }} cm</dd> }
                    @if (res.anthro.frame) { <dt>{{ res.anthro.frame }}</dt><dd>r = {{ res.anthro.frame_ratio }}</dd> }
                  </dl>
                  <div class="chips">
                    @if (res.anthro.waist_class; as c) { <app-badge [tone]="tone(c)">{{ c.label }}</app-badge> }
                    @if (res.anthro.waist_height_class; as c) { <app-badge [tone]="tone(c)">{{ c.label }}</app-badge> }
                    @if (res.anthro.waist_hip_class; as c) { <app-badge [tone]="tone(c)">{{ c.label }}</app-badge> }
                  </div>
                </section>
                <section class="panel stack" aria-labelledby="h-comp">
                  <h2 id="h-comp">Composición corporal</h2>
                  <p class="metric">{{ res.composition.fat_pct }} <small>% de grasa</small></p>
                  <p class="src">{{ fatSource(res.composition.fat_source) }}</p>
                  <dl class="kv">
                    <dt>Masa grasa</dt><dd>{{ res.composition.fat_mass_kg }} kg</dd>
                    <dt>Masa libre de grasa</dt><dd>{{ res.composition.lean_mass_kg }} kg</dd>
                    @if (res.composition.target_weight_kg) { <dt>Peso meta con {{ res.composition.target_fat_pct }} % de grasa</dt><dd>{{ res.composition.target_weight_kg }} kg</dd> }
                  </dl>
                </section>
              </div>

              @if (res.pregnancy; as pg) {
                <section class="panel stack" aria-labelledby="h-preg">
                  <h2 id="h-preg">Embarazo · trimestre {{ pg.trimester }}</h2>
                  <dl class="kv">
                    <dt>IMC pregestacional</dt><dd>{{ pg.pre_bmi }} · {{ pg.pre_bmi_class }}</dd>
                    <dt>Ganancia total recomendada</dt><dd>{{ pg.gain_min_total_kg }} – {{ pg.gain_max_total_kg }} kg</dd>
                    <dt>Ganancia esperada a la semana {{ inp().pregnancy?.weeks }}</dt><dd>{{ pg.gain_min_now_kg }} – {{ pg.gain_max_now_kg }} kg</dd>
                    @if (pg.current_gain_kg !== undefined || pg.gain_status) { <dt>Ganancia actual</dt><dd>{{ pg.current_gain_kg ?? 0 }} kg · {{ pg.gain_status }}</dd> }
                    <dt>Energía adicional</dt><dd>+{{ pg.extra_kcal }} kcal</dd>
                  </dl>
                  <p class="src">Fuente: {{ pg.source }}.</p>
                </section>
              }

              <section class="panel stack" aria-labelledby="h-gasto">
                <h2 id="h-gasto">Gasto energético y prescripción</h2>
                <div class="form-grid">
                  <div class="field"><label for="f-form">Fórmula de gasto basal</label><select id="f-form" class="select" [value]="inp().formula" (change)="patch({ formula: $any($event.target).value })">@for (f of formulas; track f[0]) { <option [value]="f[0]">{{ f[1] }}</option> }</select></div>
                  <div class="field"><label for="f-act">Actividad física</label><select id="f-act" class="select" [value]="inp().activity" [disabled]="inp().hospitalized" (change)="patch({ activity: $any($event.target).value })">@for (a of activities; track a[0]) { <option [value]="a[0]">{{ a[1] }} · ×{{ af[a[0]] }}</option> }</select></div>
                  <div class="field"><label for="f-goal">Objetivo</label><select id="f-goal" class="select" [value]="inp().goal" (change)="setGoal($any($event.target).value)"><option value="maintain">Mantener peso</option><option value="lose">Bajar de peso</option><option value="gain">Subir de peso</option></select></div>
                  <div class="field"><label for="f-adj">Ajuste sobre el gasto (kcal)</label><input id="f-adj" class="input" type="number" step="50" [value]="inp().adjust_kcal ?? 0" (input)="patch({ adjust_kcal: n($event) || undefined })" /><p class="hint">Negativo = déficit, positivo = superávit.</p></div>
                </div>
                <label class="check"><input type="checkbox" [checked]="inp().thermic" (change)="patch({ thermic: $any($event.target).checked })" /> Sumar el efecto térmico de los alimentos (10 %)</label>
                <dl class="kv">
                  <dt>Gasto basal ({{ formulaName(res.energy.formula_used) }})</dt><dd>{{ res.energy.bmr }} kcal</dd>
                  <dt>Factor de actividad</dt><dd>× {{ res.energy.activity_factor }}</dd>
                  @if (res.energy.stress_factor) { <dt>Factor de estrés</dt><dd>× {{ res.energy.stress_factor }}</dd> }
                  @if (res.energy.thermic_kcal) { <dt>Efecto térmico</dt><dd>+{{ res.energy.thermic_kcal }} kcal</dd> }
                  <dt>Gasto energético total</dt><dd>{{ res.energy.tee }} kcal</dd>
                  @if (res.energy.pregnancy_kcal) { <dt>Embarazo</dt><dd>+{{ res.energy.pregnancy_kcal }} kcal</dd> }
                  @if (res.energy.lactation_kcal) { <dt>Lactancia</dt><dd>+{{ res.energy.lactation_kcal }} kcal</dd> }
                  @if (res.energy.adjust_kcal) { <dt>Ajuste</dt><dd>{{ res.energy.adjust_kcal }} kcal</dd> }
                  <dt><strong>Prescripción</strong></dt><dd>{{ res.energy.prescription_kcal }} kcal</dd>
                </dl>
                <div class="field maxw-24"><label for="f-kt">Fijar la prescripción en (kcal)</label><input id="f-kt" class="input" type="number" step="10" placeholder="Automática" [value]="inp().kcal_target ?? ''" (input)="patch({ kcal_target: opt($event) })" /><p class="hint">Déjalo vacío para usar la calculada.</p>@if (err('kcal_target')) { <p class="error" role="alert">{{ err('kcal_target') }}</p> }</div>
              </section>
            }

            @case ('dieto') {
              <section class="panel stack" aria-labelledby="h-macros">
                <h2 id="h-macros">Distribución de macronutrimentos</h2>
                <div class="form-grid">
                  <div class="field"><label for="m-c">Hidratos de carbono (%)</label><input id="m-c" class="input" type="number" step="1" [value]="inp().macros.carbs_pct" (input)="setMacro('carbs_pct', $event)" /></div>
                  <div class="field"><label for="m-l">Lípidos (%)</label><input id="m-l" class="input" type="number" step="1" [value]="inp().macros.lipids_pct" (input)="setMacro('lipids_pct', $event)" /></div>
                  <div class="field"><label for="m-p">Proteínas (%)</label><input id="m-p" class="input" type="number" step="1" [value]="inp().macros.protein_pct" (input)="setMacro('protein_pct', $event)" /></div>
                </div>
                <p class="small" [class.error]="!!err('macros')" [attr.role]="err('macros') ? 'alert' : null">Suma: <strong>{{ macroSum() }} %</strong>@if (err('macros')) { · {{ err('macros') }} }</p>
                <dl class="kv">
                  <dt>Hidratos de carbono</dt><dd>{{ res.macros.carbs_g }} g · {{ res.macros.carbs_pct }} %</dd>
                  <dt>Proteínas</dt><dd>{{ res.macros.protein_g }} g · {{ res.macros.protein_pct }} % · {{ res.macros.protein_g_per_kg }} g/kg</dd>
                  <dt>Lípidos</dt><dd>{{ res.macros.lipids_g }} g · {{ res.macros.lipids_pct }} %</dd>
                </dl>
                <div class="chips no-print">
                  <button type="button" class="chip-toggle" (click)="preset(55, 25, 20)">55 / 25 / 20</button>
                  <button type="button" class="chip-toggle" (click)="preset(50, 30, 20)">50 / 30 / 20</button>
                  <button type="button" class="chip-toggle" (click)="preset(45, 30, 25)">45 / 30 / 25</button>
                  <button type="button" class="chip-toggle" (click)="preset(60, 25, 15)">60 / 25 / 15</button>
                </div>
              </section>

              <section class="panel panel--flush" aria-labelledby="h-cuadro">
                <div class="panel-head">
                  <h2 id="h-cuadro">Cuadro dietosintético</h2>
                  <button type="button" class="link-btn no-print" [disabled]="!hasFixed()" (click)="resetEq()">Restablecer equivalentes automáticos</button>
                </div>
                <p class="small muted u-pad-b-4 px-5">Equivalentes del SMAE por grupo. Los grupos se calculan solos para cubrir el objetivo; si cambias uno, queda <strong>fijo</strong> y el resto se reajusta.</p>
                <div class="table-wrap">
                  <table class="table">
                    <caption class="visually-hidden">Cuadro dietosintético</caption>
                    <thead><tr><th scope="col">Grupo</th><th scope="col" class="num">Equivalentes</th><th scope="col" class="num">Energía (kcal)</th><th scope="col" class="num">Carbohidratos (g)</th><th scope="col" class="num">Proteína (g)</th><th scope="col" class="num">Lípidos (g)</th></tr></thead>
                    <tbody>
                      @for (row of res.dietosintetico.rows; track row.code) {
                        <tr [class.row-fixed]="row.fixed">
                          <td>{{ row.name }}@if (row.fixed) { <app-badge tone="accent">Fijo</app-badge> }</td>
                          <td class="num"><label class="visually-hidden" [for]="'eq-' + row.code">Equivalentes de {{ row.name }}</label><input [id]="'eq-' + row.code" class="input eq-in" type="number" min="0" step="0.5" [value]="row.equivalents" (change)="setEq(row.code, $event)" /></td>
                          <td class="num">{{ row.kcal }}</td><td class="num">{{ row.carbs_g }}</td><td class="num">{{ row.protein_g }}</td><td class="num">{{ row.lipids_g }}</td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr><th scope="row">Total</th><td></td><td class="num">{{ res.dietosintetico.totals.kcal }}</td><td class="num">{{ res.dietosintetico.totals.carbs_g }}</td><td class="num">{{ res.dietosintetico.totals.protein_g }}</td><td class="num">{{ res.dietosintetico.totals.lipids_g }}</td></tr>
                      <tr><th scope="row">Objetivo</th><td></td><td class="num">{{ res.dietosintetico.target.kcal }}</td><td class="num">{{ res.dietosintetico.target.carbs_g }}</td><td class="num">{{ res.dietosintetico.target.protein_g }}</td><td class="num">{{ res.dietosintetico.target.lipids_g }}</td></tr>
                    </tfoot>
                  </table>
                </div>
                <p class="u-pad-3-4" [class.error]="absPct() > 5"><strong>Diferencia:</strong> {{ res.dietosintetico.diff_kcal }} kcal ({{ res.dietosintetico.diff_pct }} %)@if (absPct() <= 5) { · dentro del margen de ±5 % } @else { · fuera del margen de ±5 %}</p>
              </section>

              @if (res.warnings.length) {
                <section class="stack" aria-label="Avisos del cálculo">
                  @for (w of res.warnings; track w.code) {
                    <div class="callout" [class.callout--crit]="w.level === 'critical'" [class.callout--warn]="w.level === 'warn'" role="status"><app-icon [name]="w.level === 'info' ? 'info' : 'alert'" /><div class="callout-body">{{ w.message }}</div></div>
                  }
                </section>
              }
            }

            @case ('dist') {
              <section class="panel stack" aria-labelledby="h-slots">
                <h2 id="h-slots">Tiempos de comida</h2>
                <div class="form-grid">
                  @for (s of slots(); track s.name; let i = $index) {
                    <div class="field"><label [for]="'sl-' + i">{{ s.name }} (% de la energía)</label><input [id]="'sl-' + i" class="input" type="number" min="0" max="100" step="5" [value]="s.pct" (input)="setSlot(i, $event)" /></div>
                  }
                </div>
                <p class="small" [class.error]="!!err('slots')" [attr.role]="err('slots') ? 'alert' : null">Suma: <strong>{{ slotSum() }} %</strong>@if (err('slots')) { · {{ err('slots') }} }</p>
                <div class="chips no-print">
                  <button type="button" class="chip-toggle" (click)="slotPreset('std')">Reparto estándar (5 tiempos)</button>
                  <button type="button" class="chip-toggle" (click)="slotPreset('three')">Solo 3 comidas</button>
                </div>
              </section>
              <section class="panel panel--flush" aria-labelledby="h-matriz">
                <div class="panel-head"><h2 id="h-matriz">Equivalentes por tiempo de comida</h2></div>
                <div class="table-wrap" role="region" tabindex="0" aria-label="Equivalentes por tiempo de comida (desplazable)">
                  <table class="table table--keep">
                    <caption class="visually-hidden">Equivalentes por grupo y tiempo de comida</caption>
                    <thead><tr><th scope="col">Grupo</th>@for (s of res.distribution; track s.name) { <th scope="col" class="num">{{ s.name }}</th> }<th scope="col" class="num">Total</th></tr></thead>
                    <tbody>
                      @for (row of res.dietosintetico.rows; track row.code) {
                        <tr><th scope="row">{{ row.name }}</th>@for (s of res.distribution; track s.name) { <td class="num">{{ s.equivalents[row.code] ?? '—' }}</td> }<td class="num"><strong>{{ row.equivalents }}</strong></td></tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr><th scope="row">Energía (kcal)</th>@for (s of res.distribution; track s.name) { <td class="num">{{ s.totals.kcal }}</td> }<td class="num">{{ res.dietosintetico.totals.kcal }}</td></tr>
                      <tr><th scope="row">Objetivo (kcal)</th>@for (s of res.distribution; track s.name) { <td class="num">{{ s.target_kcal }}</td> }<td class="num">{{ res.dietosintetico.target.kcal }}</td></tr>
                      <tr><th scope="row">Diferencia</th>@for (s of res.distribution; track s.name) { <td class="num">{{ s.diff_kcal > 0 ? '+' : '' }}{{ s.diff_kcal }}</td> }<td class="num">{{ res.dietosintetico.diff_kcal > 0 ? '+' : '' }}{{ res.dietosintetico.diff_kcal }}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            }

            @case ('dieta') {
              <section class="panel stack" aria-labelledby="h-dieta">
                <h2 id="h-dieta">{{ name() || 'Dieta' }}@if (patientName() && !name().includes(patientName())) { · {{ patientName() }} }</h2>
                <p>{{ res.energy.prescription_kcal }} kcal · {{ res.macros.carbs_g }} g de hidratos · {{ res.macros.protein_g }} g de proteína · {{ res.macros.lipids_g }} g de lípidos</p>
                <div class="slots-grid">
                  @for (s of res.distribution; track s.name) {
                    @if (s.pct > 0) {
                      <article class="slot" [attr.aria-label]="s.name">
                        <h3>{{ s.name }}</h3>
                        <p class="small muted">{{ s.pct }} % · {{ s.totals.kcal }} kcal</p>
                        <ul>
                          @for (g of groupList; track g.code) { @if (s.equivalents[g.code]) { <li><span>{{ g.name }}</span><b>{{ s.equivalents[g.code] }}</b></li> } }
                        </ul>
                        <p class="small muted">HC {{ s.totals.carbs_g }} g · P {{ s.totals.protein_g }} g · L {{ s.totals.lipids_g }} g</p>
                      </article>
                    }
                  }
                </div>
                <p class="small muted">Cantidades en equivalentes del SMAE. Cada equivalente se traduce en porciones de alimentos del catálogo al armar el plan alimentario.</p>
                <div class="row no-print">
                  <button tuiButton type="button" size="m" appearance="secondary" (click)="print()"><app-icon name="printer" [size]="18" /> Imprimir</button>
                  @if (patientId()) { <a tuiButton size="m" appearance="secondary" routerLink="/planes/nuevo" [queryParams]="{ paciente: patientId() }"><app-icon name="calendar" [size]="18" /> Crear plan para este paciente</a> }
                </div>
              </section>
              @if (res.warnings.length) {
                <section class="stack" aria-label="Avisos del cálculo">
                  @for (w of res.warnings; track w.code) { <div class="callout" role="status"><app-icon name="info" /><div class="callout-body">{{ w.message }}</div></div> }
                </section>
              }
            }
          }
        </div>
      }
      <p class="small muted">Herramienta de apoyo profesional: las fórmulas son estimaciones publicadas (Mifflin-St Jeor, Harris-Benedict, FAO/OMS, Katch-McArdle, NOM-008, IOM) y no sustituyen el criterio clínico.</p>
    </section>
  `,
})
export class DietocalculoEditor implements HasUnsavedChanges {
  private readonly svc = inject(DietocalculoService);
  private readonly data = inject(DbService);
  private readonly patients = inject(PatientsService);
  private readonly repro = inject(ReproductiveService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly tabs = TABS;
  protected readonly tab = signal<TabId>('calc');
  protected readonly inp = signal<DietInputs>(defaultInputs());
  protected readonly name = signal('Nueva dieta');
  protected readonly patientId = signal('');
  protected readonly saving = signal(false);
  private readonly id = signal<string | null>(null);
  private snapshot = '';

  protected readonly formulas = Object.entries(FORMULA_LABEL);
  protected readonly activities = Object.entries(ACTIVITY_LABEL);
  protected readonly af: Record<string, number> = ACTIVITY_FACTOR;
  protected readonly ampLabel = AMPUTATION_LABEL;
  protected readonly amputationKeys = Object.keys(AMPUTATION_LABEL);
  protected readonly groupList = GROUPS;

  protected readonly patientOptions = computed<ComboOption[]>(() =>
    this.data.db().patients.filter((p) => !p.deletedAt).map((p) => ({ id: p.id, label: `${p.profile.firstName} ${p.profile.lastName}`, hint: p.profile.email })));
  protected readonly patientName = computed(() => this.patientOptions().find((o) => o.id === this.patientId())?.label ?? '');

  protected readonly errors = computed(() => normalize(structuredClone(this.inp())) ?? {});
  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);
  private last: DietResult | null = null;
  /** Resultado vigente: se recalcula al instante; si los datos son inválidos se conserva el último válido. */
  protected readonly r = computed<DietResult | null>(() => {
    if (!this.hasErrors()) {
      const c = structuredClone(this.inp());
      normalize(c);
      this.last = compute(c);
    }
    return this.last;
  });

  protected readonly slots = computed(() => this.inp().slots ?? DEFAULT_SLOTS);
  protected readonly slotSum = computed(() => this.slots().reduce((s, x) => s + (Number.isFinite(x.pct) ? x.pct : 0), 0));
  protected readonly macroSum = computed(() => { const m = this.inp().macros; return Math.round((m.carbs_pct + m.lipids_pct + m.protein_pct) * 10) / 10; });
  protected readonly hasFixed = computed(() => Object.keys(this.inp().equivalents ?? {}).length > 0);
  protected readonly absPct = computed(() => Math.abs(this.r()?.dietosintetico.diff_pct ?? 0));
  protected readonly hasOptional = computed(() => { const i = this.inp(); return !!(i.waist_cm || i.hip_cm || i.neck_cm || i.wrist_cm || i.knee_height_cm || i.target_fat_pct); });

  constructor() {
    this.patients.loadAll().subscribe({ error: () => undefined });
    const id = this.route.snapshot.paramMap.get('id');
    const preset = this.route.snapshot.queryParamMap.get('paciente');
    if (id) {
      this.svc.get(id).subscribe({
        next: (d) => { this.id.set(d.id); this.name.set(d.name); this.patientId.set(d.patientId ?? ''); this.inp.set({ ...defaultInputs(), ...d.inputs, slots: d.inputs.slots?.length ? d.inputs.slots : DEFAULT_SLOTS.map((s) => ({ ...s })) }); this.mark(); },
        error: () => { this.toast.error('No se encontró la dieta.'); void this.router.navigateByUrl('/dietocalculo'); },
      });
    } else {
      this.mark();
      if (preset) this.link(preset, true);
    }
  }

  private key(): string { return JSON.stringify({ n: this.name(), p: this.patientId(), i: this.inp() }); }
  private mark(): void { this.snapshot = this.key(); }
  hasUnsavedChanges(): boolean { return !this.saving() && this.key() !== this.snapshot; }

  // ---------- Edición ----------
  protected patch(p: Partial<DietInputs>): void { this.inp.update((i) => ({ ...i, ...p })); }
  protected n(e: Event): number { const v = (e.target as HTMLInputElement).value; return v === '' ? NaN : Number(v); }
  protected opt(e: Event): number | undefined { const v = (e.target as HTMLInputElement).value; return v === '' ? undefined : Number(v); }
  protected err(k: string): string { return this.errors()[k] ?? ''; }
  protected tone(c: Classification): Tone { return TONE[c.tone] ?? 'neutral'; }
  protected fatSource(s: string): string {
    return s === 'captured' ? 'Capturado por la nutrióloga.' : s === 'navy' ? 'Estimado con el método de la marina de EE. UU. (cintura, cuello y cadera).' : 'Estimado con la fórmula de Deurenberg (IMC, edad y sexo). Captura el % medido para mayor precisión.';
  }
  protected formulaName(f: string): string { return (FORMULA_LABEL as Record<string, string>)[f]?.replace(/ \(.*\)$/, '') ?? f; }
  protected toggleAmp(key: string, on: boolean): void {
    const cur = new Set(this.inp().amputations ?? []);
    if (on) cur.add(key); else cur.delete(key);
    this.patch({ amputations: [...cur] });
  }
  protected setGoal(g: DietInputs['goal']): void { this.patch({ goal: g, adjust_kcal: g === 'lose' ? -500 : g === 'gain' ? 300 : undefined }); }
  protected setMacro(k: keyof DietInputs['macros'], e: Event): void { this.patch({ macros: { ...this.inp().macros, [k]: this.n(e) } }); }
  protected preset(c: number, l: number, p: number): void { this.patch({ macros: { carbs_pct: c, lipids_pct: l, protein_pct: p } }); }
  protected setEq(code: string, e: Event): void {
    const raw = (e.target as HTMLInputElement).value;
    const eq = { ...(this.inp().equivalents ?? {}) };
    if (raw === '' || !Number.isFinite(Number(raw))) delete eq[code]; else eq[code] = Number(raw);
    this.patch({ equivalents: Object.keys(eq).length ? eq : undefined });
  }
  protected resetEq(): void { this.patch({ equivalents: undefined }); }
  protected setSlot(i: number, e: Event): void { this.patch({ slots: this.slots().map((s, idx) => (idx === i ? { ...s, pct: this.n(e) } : s)) }); }
  protected slotPreset(kind: 'std' | 'three'): void {
    this.patch({ slots: kind === 'std' ? DEFAULT_SLOTS.map((s) => ({ ...s })) : [{ name: 'Desayuno', pct: 30 }, { name: 'Colación matutina', pct: 0 }, { name: 'Comida', pct: 40 }, { name: 'Colación vespertina', pct: 0 }, { name: 'Cena', pct: 30 }] });
  }

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
      this.inp.set(prefillFromPatient(p, this.repro.of(id), this.inp()));
      this.toast.ok('Datos del expediente aplicados.');
    };
    this.patients.load(id).subscribe({
      error: () => this.toast.error('No se pudo cargar el expediente.'),
      complete: () => this.repro.load(id).subscribe({ error: () => apply(), complete: apply }),
    });
  }

  // ---------- Guardar ----------
  protected save(): void {
    if (this.hasErrors() || !this.name().trim()) { this.toast.error('Escribe un nombre y corrige los datos marcados.'); return; }
    this.saving.set(true);
    this.svc.save(this.id(), { name: this.name(), patientId: this.patientId() || null, patientName: this.patientName(), inputs: this.inp() }).subscribe({
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

  protected print(): void { window.print(); }
}
