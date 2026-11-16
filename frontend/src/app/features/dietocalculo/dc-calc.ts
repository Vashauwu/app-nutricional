import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { ConfirmService } from '../../core/services/ui.services';
import { Icon } from '../../shared/components/icon';
import { Switch } from '../../shared/components/switch';
import { Badge, Tone } from '../../shared/components/ui';
import { ACTIVITY_FACTOR, AMPUTATION_LABEL, Activity, Classification, DietInputs, FatMethodId, Formula, defaultInputs } from './engine';
import { DietoStore, TONE, numVal, optVal } from './dieto-store';

type Sub = 'gasto' | 'antro' | 'comp' | 'macros' | 'embarazo';

const ACTIVITY: { id: Activity; label: string }[] = [
  { id: 'sedentary', label: 'Sedentario' }, { id: 'light', label: 'Ligero' }, { id: 'moderate', label: 'Moderado' }, { id: 'intense', label: 'Activo' }, { id: 'very_intense', label: 'Muy activo' },
];
const GOALS: { adj: number; label: string }[] = [
  { adj: -500, label: 'Déficit −500' }, { adj: -300, label: 'Déficit −300' }, { adj: 0, label: 'Mantenimiento' }, { adj: 300, label: 'Superávit +300' }, { adj: 500, label: 'Superávit +500' },
];
// [hidratos, proteína, lípidos]
const PRESETS: [number, number, number][] = [[55, 20, 25], [60, 15, 25], [45, 25, 30], [40, 30, 30]];
const BMI_TEXT: Record<string, string> = {
  'Bajo peso': 'Bajo peso (< 18.5 kg/m²). Evalúa desnutrición u otras patologías de base.',
  'Peso normal': 'Peso normal (18.5 a 24.9 kg/m²).',
  'Sobrepeso': 'Sobrepeso (25 a 29.9 kg/m²). Riesgo cardiometabólico creciente.',
  'Obesidad grado I': 'Obesidad grado I (30 a 34.9 kg/m²).',
  'Obesidad grado II': 'Obesidad grado II (35 a 39.9 kg/m²).',
  'Obesidad grado III': 'Obesidad grado III (≥ 40 kg/m²).',
};

/** Pestaña «Cálculos»: datos del paciente y cinco subpestañas (gasto, antropometría, composición, macros, embarazo). */
@Component({
  selector: 'app-dc-calc',
  imports: [TuiButton, Icon, Badge, Switch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: var(--space-5); align-content: start; min-inline-size: 0; }
    .opt { border: 1px solid var(--line); border-radius: var(--radius-m); padding: var(--space-3) var(--space-4); }
    .opt summary { cursor: pointer; min-block-size: var(--tap); line-height: var(--tap); }
    .opt[open] summary { margin-block-end: var(--space-2); }
  `,
  template: `
    @let i = s.inp();
    @let res = s.r();
    <section class="panel stack" aria-labelledby="h-datos">
      <div class="row row--between">
        <div class="row">
          <h2 id="h-datos" class="m-0 u-h2-ui">Paso 1 · Datos del paciente</h2>
          @if (i.pregnancy) { <app-badge tone="info" icon="heart">Embarazada</app-badge> }
          @if (i.lactation) { <app-badge tone="info" icon="heart">Lactancia</app-badge> }
          <app-badge [tone]="tone(res.anthro.bmi_class)">IMC {{ res.anthro.bmi }} · {{ res.anthro.bmi_class.label }}</app-badge>
          <app-badge>Peso ideal {{ res.anthro.ideal_weight_kg }} kg</app-badge>
        </div>
        <div class="row no-print">
          <button type="button" class="icon-btn" aria-label="Restablecer los datos" title="Restablecer los datos" (click)="reset()"><app-icon name="refresh" [size]="18" /></button>
          <div class="dc-seg" role="radiogroup" aria-label="Sexo">
            <button type="button" role="radio" [attr.aria-checked]="i.sex === 'F'" (click)="s.patch({ sex: 'F' })">Mujer</button>
            <button type="button" role="radio" [attr.aria-checked]="i.sex === 'M'" (click)="s.patch({ sex: 'M', pregnancy: undefined, lactation: '' })">Hombre</button>
          </div>
        </div>
      </div>
      <div class="dc-grid dc-grid--m">
        <div class="field">
          <label for="f-age">1. Edad <span class="dc-req">· requerido</span></label>
          <div class="dc-unit"><input id="f-age" class="input" type="number" inputmode="decimal" min="14" max="110" step="1" [value]="i.age" [attr.aria-invalid]="!!s.err('age')" [attr.aria-describedby]="s.err('age') ? 'e-age' : null" (input)="s.patch({ age: num($event) })" /><span>años</span></div>
          @if (s.err('age')) { <p id="e-age" class="error" role="alert">{{ s.err('age') }}</p> }
        </div>
        <div class="field">
          <label for="f-w">2. Peso actual <span class="dc-req">· requerido</span></label>
          <div class="dc-unit"><input id="f-w" class="input" type="number" inputmode="decimal" min="20" max="400" step="0.1" [value]="i.weight_kg" [attr.aria-invalid]="!!s.err('weight_kg')" [attr.aria-describedby]="s.err('weight_kg') ? 'e-w' : null" (input)="s.patch({ weight_kg: num($event) })" /><span>kg</span></div>
          @if (s.err('weight_kg')) { <p id="e-w" class="error" role="alert">{{ s.err('weight_kg') }}</p> }
        </div>
        <div class="field">
          <label for="f-h">3. Talla <span class="dc-req">· requerido</span></label>
          <div class="dc-unit"><input id="f-h" class="input" type="number" inputmode="decimal" min="100" max="250" step="0.1" [value]="i.height_cm" [attr.aria-invalid]="!!s.err('height_cm')" [attr.aria-describedby]="s.err('height_cm') ? 'e-h' : null" (input)="s.patch({ height_cm: num($event) })" /><span>cm</span></div>
          @if (s.err('height_cm')) { <p id="e-h" class="error" role="alert">{{ s.err('height_cm') }}</p> }
        </div>
        <div class="field">
          <label for="f-bf">% de grasa corporal <span class="dc-req">· opcional</span></label>
          <div class="dc-unit"><input id="f-bf" class="input" type="number" inputmode="decimal" min="0" max="70" step="0.1" [value]="i.body_fat_pct ?? ''" (input)="s.patch({ body_fat_pct: opt($event) })" /><span>%</span></div>
          @if (s.err('body_fat_pct')) { <p class="error" role="alert">{{ s.err('body_fat_pct') }}</p> }
        </div>
      </div>
      <details class="opt" [open]="hasOptional()">
        <summary><strong>Perímetros opcionales (cintura, cadera, cuello) y meta</strong></summary>
        <div class="dc-grid dc-grid--m u-mt-1">
          <div class="field"><label for="f-waist">Cintura (cm)</label><input id="f-waist" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Ej: 80" [value]="i.waist_cm ?? ''" (input)="s.patch({ waist_cm: opt($event) })" /></div>
          <div class="field"><label for="f-hip">Cadera (cm)</label><input id="f-hip" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Ej: 98" [value]="i.hip_cm ?? ''" (input)="s.patch({ hip_cm: opt($event) })" /></div>
          <div class="field"><label for="f-neck">Cuello (cm)</label><input id="f-neck" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Ej: 36" [value]="i.neck_cm ?? ''" (input)="s.patch({ neck_cm: opt($event) })" /></div>
          <div class="field"><label for="f-tf">% de grasa meta</label><input id="f-tf" class="input" type="number" inputmode="decimal" step="0.1" placeholder="Ej: 15" [value]="i.target_fat_pct ?? ''" (input)="s.patch({ target_fat_pct: opt($event) })" /></div>
        </div>
      </details>
      <div class="row" role="group" aria-label="Condiciones especiales">
        <app-switch [checked]="i.athlete" (checkedChange)="s.patch({ athlete: $event })">Deportista</app-switch>
        <app-switch [checked]="i.hospitalized" (checkedChange)="s.patch({ hospitalized: $event, stress_factor: $event ? (i.stress_factor ?? 1.2) : undefined })">Hospitalizado</app-switch>
        <app-switch [checked]="!!i.amputations?.length" (checkedChange)="s.patch({ amputations: $event ? ['foot'] : [] })">Amputación</app-switch>
        @if (i.sex === 'F') {
          <app-switch [checked]="!!i.pregnancy" (checkedChange)="togglePregnancy($event)">Embarazo</app-switch>
          <app-switch [checked]="!!i.lactation" (checkedChange)="toggleLactation($event)">Lactancia</app-switch>
        }
      </div>
      @if (i.hospitalized) {
        <div class="field maxw-24"><label for="f-stress">Factor de estrés (1.0 – 2.0)</label><input id="f-stress" class="input" type="number" step="0.05" min="1" max="2" [value]="i.stress_factor ?? 1.2" (input)="s.patch({ stress_factor: num($event) })" /></div>
      }
      @if (i.amputations?.length) {
        <fieldset class="fieldset-reset" aria-label="Segmentos amputados"><legend class="small muted">Segmentos amputados (el peso se corrige para calcular el IMC)</legend>
          <div class="row">@for (a of ampKeys; track a) { <label class="check"><input type="checkbox" [checked]="i.amputations!.includes(a)" (change)="toggleAmp(a, $event)" /> {{ ampLabel[a] }}</label> }</div>
        </fieldset>
      }
    </section>

    <div class="dc-subtabs no-print" role="tablist" aria-label="Cálculos" (keydown)="onSubKey($event)">
      <button type="button" class="dc-subtab" role="tab" id="st-gasto" [attr.aria-selected]="sub() === 'gasto'" [attr.tabindex]="sub() === 'gasto' ? 0 : -1" (click)="sub.set('gasto')"><app-icon name="zap" [size]="18" /> Gasto y prescripción <span class="badge">{{ res.energy.prescription_kcal }} kcal</span></button>
      <button type="button" class="dc-subtab" role="tab" id="st-antro" [attr.aria-selected]="sub() === 'antro'" [attr.tabindex]="sub() === 'antro' ? 0 : -1" (click)="sub.set('antro')"><app-icon name="scale" [size]="18" /> Antropometría e IMC <span class="badge">IMC {{ res.anthro.bmi }}</span></button>
      <button type="button" class="dc-subtab" role="tab" id="st-comp" [attr.aria-selected]="sub() === 'comp'" [attr.tabindex]="sub() === 'comp' ? 0 : -1" (click)="sub.set('comp')"><app-icon name="activity" [size]="18" /> Composición corporal <span class="badge">{{ res.composition.fat_pct }} %</span></button>
      <button type="button" class="dc-subtab" role="tab" id="st-macros" [attr.aria-selected]="sub() === 'macros'" [attr.tabindex]="sub() === 'macros' ? 0 : -1" (click)="sub.set('macros')"><app-icon name="pie" [size]="18" /> Macronutrimentos</button>
      @if (i.pregnancy || i.lactation) {
        <button type="button" class="dc-subtab" role="tab" id="st-embarazo" [attr.aria-selected]="sub() === 'embarazo'" [attr.tabindex]="sub() === 'embarazo' ? 0 : -1" (click)="sub.set('embarazo')"><app-icon name="heart" [size]="18" /> Embarazo y lactancia</button>
      }
    </div>

    <div role="tabpanel" [attr.aria-labelledby]="'st-' + sub()" class="stack">
      @switch (sub()) {
        @case ('gasto') {
          <section class="panel stack" aria-labelledby="h-eq">
            <div class="row row--between">
              <h2 id="h-eq" class="m-0 u-h2-ui">Paso 2 · Ecuación de gasto energético</h2>
              <button type="button" class="link-btn no-print" [attr.aria-expanded]="allEq()" (click)="allEq.set(!allEq())">{{ allEq() ? 'Ver principales (4)' : 'Ver todas las ecuaciones (' + res.energy.equations.length + ')' }}</button>
            </div>
            <div class="dc-grid dc-grid--m" role="radiogroup" aria-label="Ecuación de gasto basal">
              @for (e of shownEq(); track e.id) {
                <button type="button" class="dc-tile" role="radio" [attr.aria-checked]="res.energy.formula_used === e.id" [disabled]="!e.available" (click)="setFormula(e.id)">
                  <span class="t-row"><span class="t-name">{{ e.name }}</span></span>
                  <span class="t-tag">{{ e.tag }}</span>
                  @if (e.available) {
                    <span class="t-row"><span class="dc-sub">TMB basal</span><span class="dc-sub">GET mant.</span></span>
                    <span class="t-row"><b class="dc-num">{{ e.bmr }} <small class="dc-sub">kcal</small></b><b class="dc-num">{{ e.get }} <small class="dc-sub">kcal</small></b></span>
                  } @else {
                    <span class="dc-sub">{{ e.note || 'Faltan datos para calcularla.' }}</span>
                  }
                </button>
              }
            </div>
            @if (i.formula === 'valencia' && res.energy.formula_used !== 'valencia') { <p class="small muted" role="status">La ecuación de Valencia no está disponible para este paciente; se usó Mifflin-St Jeor.</p> }
          </section>

          <div class="grid grid--2">
            <section class="panel stack" aria-labelledby="h-naf">
              <div class="row row--between"><h2 id="h-naf" class="m-0 u-h2-ui">Nivel de actividad física</h2><span class="dc-sub">× {{ res.energy.activity_factor }}</span></div>
              <div class="dc-grid dc-grid--5" role="radiogroup" aria-label="Nivel de actividad física">
                @for (a of activities; track a.id) {
                  <button type="button" class="dc-tile" role="radio" [attr.aria-checked]="i.activity === a.id" [disabled]="i.hospitalized" (click)="s.patch({ activity: a.id })"><span class="t-name">{{ a.label }}</span><span class="dc-sub">{{ af[a.id] }}</span></button>
                }
              </div>
              <h3 class="m-0 t-sm">Objetivo clínico (ajuste sobre el gasto)</h3>
              <div class="dc-pills" role="radiogroup" aria-label="Objetivo clínico">
                @for (g of goals; track g.adj) {
                  <button type="button" class="dc-pill" role="radio" [attr.aria-checked]="(i.adjust_kcal ?? 0) === g.adj" (click)="s.patch({ adjust_kcal: g.adj || undefined, goal: g.adj < 0 ? 'lose' : g.adj > 0 ? 'gain' : 'maintain' })">{{ g.label }}</button>
                }
              </div>
              <div class="dc-grid dc-grid--m">
                <div class="field"><label for="f-adj">Ajuste personalizado (kcal/día)</label><input id="f-adj" class="input" type="number" step="50" [value]="i.adjust_kcal ?? 0" (input)="s.patch({ adjust_kcal: num($event) || undefined })" /></div>
                <div class="field">
                  <label for="f-eta">Efecto térmico de los alimentos (ETA %)</label>
                  <div class="row"><app-switch [checked]="i.thermic" (checkedChange)="s.patch({ thermic: $event })">Sumar</app-switch><input id="f-eta" class="input dc-num-in" type="number" min="0" max="30" step="1" [disabled]="!i.thermic" [value]="i.thermic_pct ?? 10" (input)="s.patch({ thermic_pct: opt($event) })" /></div>
                  @if (s.err('thermic_pct')) { <p class="error" role="alert">{{ s.err('thermic_pct') }}</p> }
                </div>
              </div>
            </section>

            <section class="panel stack" aria-labelledby="h-rx">
              <h2 id="h-rx" class="m-0 u-h2-ui">Paso 3 · Prescripción final</h2>
              <p class="dc-metric">{{ res.energy.prescription_kcal }} <small>kcal/día</small></p>
              <dl class="dc-kv">
                <dt>Gasto basal ({{ eqName(res.energy.formula_used) }})</dt><dd>{{ res.energy.bmr }} kcal</dd>
                <dt>Factor de actividad</dt><dd>× {{ res.energy.activity_factor }}</dd>
                @if (res.energy.stress_factor) { <dt>Factor de estrés</dt><dd>× {{ res.energy.stress_factor }}</dd> }
                @if (res.energy.thermic_kcal) { <dt>Efecto térmico ({{ res.energy.thermic_pct }} %)</dt><dd>+{{ res.energy.thermic_kcal }} kcal</dd> }
                <dt>Gasto energético total</dt><dd>{{ res.energy.tee }} kcal</dd>
                @if (res.energy.pregnancy_kcal) { <dt>Embarazo</dt><dd>+{{ res.energy.pregnancy_kcal }} kcal</dd> }
                @if (res.energy.lactation_kcal) { <dt>Lactancia</dt><dd>+{{ res.energy.lactation_kcal }} kcal</dd> }
                @if (res.energy.adjust_kcal) { <dt>Ajuste</dt><dd>{{ res.energy.adjust_kcal }} kcal</dd> }
              </dl>
              <div class="field"><label for="f-kt">Fijar la prescripción en (kcal)</label><input id="f-kt" class="input" type="number" step="10" placeholder="Automática" [value]="i.kcal_target ?? ''" (input)="s.patch({ kcal_target: opt($event) })" />@if (s.err('kcal_target')) { <p class="error" role="alert">{{ s.err('kcal_target') }}</p> }</div>
              <h3 class="m-0 t-sm">Macronutrimentos (HCO / PRO / LIP)</h3>
              <div class="dc-pills no-print" role="group" aria-label="Distribuciones habituales">
                @for (p of presets; track p.join()) { <button type="button" class="dc-pill" (click)="s.setPercentMacros(p[0], p[2], p[1])">{{ p[0] }} / {{ p[1] }} / {{ p[2] }}</button> }
              </div>
              <div class="dc-grid dc-grid--s">
                <div class="dc-tile"><span class="dc-sub">{{ res.macros.carbs_pct }} % HCO</span><b class="dc-num">{{ res.macros.carbs_g }} g</b></div>
                <div class="dc-tile"><span class="dc-sub">{{ res.macros.protein_pct }} % PRO</span><b class="dc-num">{{ res.macros.protein_g }} g</b></div>
                <div class="dc-tile"><span class="dc-sub">{{ res.macros.lipids_pct }} % LIP</span><b class="dc-num">{{ res.macros.lipids_g }} g</b></div>
              </div>
              <button tuiButton type="button" size="m" class="no-print" (click)="goDieto.emit()"><app-icon name="circle-right" [size]="18" /> Aplicar al Dietocálculo</button>
            </section>
          </div>
        }

        @case ('antro') {
          <div class="grid grid--2">
            <section class="panel stack" aria-labelledby="h-imc">
              <h2 id="h-imc" class="m-0 u-h2-ui">IMC (NOM-008)</h2>
              <p class="dc-metric">{{ res.anthro.bmi }} <small>kg/m²</small></p>
              <div class="dc-tile">
                <b>{{ res.anthro.bmi_class.label }}</b>
                <span class="dc-sub">{{ bmiText(res.anthro.bmi_class) }}</span>
                @if (res.anthro.bmi_class.note) { <span class="dc-sub">{{ res.anthro.bmi_class.note }}</span> }
              </div>
              <dl class="dc-kv"><dt>Peso usado para el cálculo</dt><dd>{{ res.anthro.weight_used_kg }} kg</dd></dl>
            </section>
            <section class="panel stack" aria-labelledby="h-asc">
              <h2 id="h-asc" class="m-0 u-h2-ui">Perímetros y superficie corporal</h2>
              <div class="dc-grid dc-grid--s">
                <div class="dc-tile"><span class="dc-sub">ICC (cintura/cadera)</span>@if (res.anthro.waist_hip !== undefined) { <b class="dc-num">{{ res.anthro.waist_hip }}</b><app-badge [tone]="tone(res.anthro.waist_hip_class!)">{{ res.anthro.waist_hip_class!.label }}</app-badge> } @else { <span class="dc-sub">Requiere cintura y cadera</span> }</div>
                <div class="dc-tile"><span class="dc-sub">ICT (cintura/talla)</span>@if (res.anthro.waist_height !== undefined) { <b class="dc-num">{{ res.anthro.waist_height }}</b><app-badge [tone]="tone(res.anthro.waist_height_class!)">{{ res.anthro.waist_height_class!.label }}</app-badge> } @else { <span class="dc-sub">Requiere cintura y talla</span> }</div>
                <div class="dc-tile"><span class="dc-sub">ASC Mosteller</span><b class="dc-num">{{ res.anthro.bsa_mosteller }} <small class="dc-sub">m²</small></b><span class="dc-sub">Du Bois: {{ res.anthro.bsa_dubois }} m²</span></div>
                <div class="dc-tile"><span class="dc-sub">Cintura</span>@if (res.anthro.waist_class; as c) { <app-badge [tone]="tone(c)">{{ c.label }}</app-badge> @if (c.note) { <span class="dc-sub">{{ c.note }}</span> } } @else { <span class="dc-sub">Requiere cintura</span> }</div>
              </div>
            </section>
          </div>

          <section class="panel stack" aria-labelledby="h-noamb">
            <h2 id="h-noamb" class="m-0 u-h2-ui">Paciente no ambulatorio y complexión</h2>
            <div class="dc-grid dc-grid--m">
              <div class="field"><label for="f-knee">Altura de rodilla (cm)</label><input id="f-knee" class="input" type="number" inputmode="decimal" step="0.1" [value]="i.knee_height_cm ?? ''" (input)="s.patch({ knee_height_cm: opt($event) })" /></div>
              <div class="field"><label for="f-wrist">Circunferencia de muñeca (cm)</label><input id="f-wrist" class="input" type="number" inputmode="decimal" step="0.1" [value]="i.wrist_cm ?? ''" (input)="s.patch({ wrist_cm: opt($event) })" /></div>
            </div>
            <div class="dc-grid dc-grid--m">
              <div class="dc-tile"><span class="dc-sub">Chumlea · altura de rodilla</span>@if (res.anthro.stature_chumlea_cm) { <b class="dc-num">{{ res.anthro.stature_chumlea_cm }} <small class="dc-sub">cm</small></b><span class="dc-sub">Estatura estimada</span> } @else { <span class="dc-sub">Requiere altura de rodilla y edad</span> }</div>
              <div class="dc-tile"><span class="dc-sub">Grant · muñeca</span>@if (res.anthro.frame) { <b>{{ res.anthro.frame }}</b><span class="dc-sub">r = talla / muñeca = {{ res.anthro.frame_ratio }}</span> } @else { <span class="dc-sub">Requiere talla y muñeca</span> }</div>
            </div>
            <p class="small muted">Las fórmulas de Mendoza-Núñez, Hirani, Arango y Frisancho (codo) no están cargadas: faltan validar sus coeficientes con la publicación.</p>
          </section>

          <section class="panel stack" aria-labelledby="h-ideal">
            <div class="row row--between"><h2 id="h-ideal" class="m-0 u-h2-ui">Pesos teóricos e ideales</h2><span class="dc-sub">Promedio: <b>{{ res.anthro.ideal_avg_kg }} kg</b></span></div>
            <div class="dc-grid dc-grid--s">
              @for (w of res.anthro.ideal_weights; track w.id) { <div class="dc-tile"><span class="dc-sub">{{ w.name }}</span><b class="dc-num">{{ w.kg }} <small class="dc-sub">kg</small></b></div> }
              <div class="dc-tile"><span class="dc-sub">Peso ajustado (obesidad, 25 %)</span>@if (res.anthro.adjusted_weight_kg) { <b class="dc-num">{{ res.anthro.adjusted_weight_kg }} <small class="dc-sub">kg</small></b> } @else { <span class="dc-sub">Requiere peso mayor al ideal</span> }</div>
            </div>
          </section>
        }

        @case ('comp') {
          <section class="panel stack" aria-labelledby="h-pli">
            <h2 id="h-pli" class="m-0 u-h2-ui">Pliegues cutáneos (mm) y brazo</h2>
            <div class="dc-grid dc-grid--s">
              @for (f of folds; track f.key) {
                <div class="field"><label [for]="'sf-' + f.key">{{ f.label }}</label><input [id]="'sf-' + f.key" class="input" type="number" inputmode="decimal" step="0.1" min="0" [value]="fold(f.key)" (input)="setFold(f.key, $event)" /></div>
              }
              <div class="field"><label for="f-arm">Circunferencia del brazo (cm)</label><input id="f-arm" class="input" type="number" inputmode="decimal" step="0.1" min="0" [value]="i.arm_circ_cm ?? ''" (input)="s.patch({ arm_circ_cm: opt($event) })" /></div>
            </div>
            @if (s.err('skinfolds')) { <p class="error" role="alert">{{ s.err('skinfolds') }}</p> }
          </section>
          <section class="stack" aria-labelledby="h-meth">
            <h2 id="h-meth" class="m-0 u-h2-ui">Método para el % de grasa</h2>
            <div class="dc-grid dc-grid--m" role="radiogroup" aria-label="Método de % de grasa">
              @for (m of res.composition.methods; track m.id) {
                <div class="dc-tile" [class.is-sel]="res.composition.fat_source === m.id">
                  <span class="t-row"><b class="t-name">{{ m.name }}</b><span class="t-tag">{{ m.tag }}</span></span>
                  @if (m.available) {
                    <b class="dc-num">{{ m.fat_pct }} <small class="dc-sub">%</small></b>
                    @if (res.composition.fat_source === m.id) { <app-badge tone="accent" icon="check">En uso</app-badge> }
                    @else { <button type="button" class="link-btn no-print" (click)="useMethod(m.id)">Usar este método</button> }
                  } @else { <span class="dc-sub">{{ m.requires }}</span> }
                </div>
              }
            </div>
          </section>
          <section class="panel stack" aria-labelledby="h-compo">
            <h2 id="h-compo" class="m-0 u-h2-ui">Resultado</h2>
            <div class="dc-grid dc-grid--s">
              <div class="dc-tile"><span class="dc-sub">Masa magra (MLG)</span><b class="dc-num">{{ res.composition.lean_mass_kg }} <small class="dc-sub">kg</small></b></div>
              <div class="dc-tile"><span class="dc-sub">Masa grasa</span><b class="dc-num">{{ res.composition.fat_mass_kg }} <small class="dc-sub">kg</small></b></div>
              <div class="dc-tile"><span class="dc-sub">FFMI (índice de masa libre de grasa)</span><b class="dc-num">{{ res.composition.ffmi }} <small class="dc-sub">kg/m²</small></b></div>
              <div class="dc-tile"><span class="dc-sub">Agua corporal total (Watson)</span><b class="dc-num">{{ res.composition.tbw_l }} <small class="dc-sub">L</small></b></div>
              <div class="dc-tile"><span class="dc-sub">cAMA (Heymsfield)</span>@if (res.composition.cama_cm2 !== undefined) { <b class="dc-num">{{ res.composition.cama_cm2 }} <small class="dc-sub">cm²</small></b> } @else { <span class="dc-sub">Requiere brazo y tríceps</span> }</div>
              <div class="dc-tile"><span class="dc-sub">AGB (Frisancho)</span>@if (res.composition.agb_cm2 !== undefined) { <b class="dc-num">{{ res.composition.agb_cm2 }} <small class="dc-sub">cm²</small></b> } @else { <span class="dc-sub">Requiere brazo y tríceps</span> }</div>
              @if (res.composition.target_weight_kg) { <div class="dc-tile"><span class="dc-sub">Peso meta con {{ res.composition.target_fat_pct }} % de grasa</span><b class="dc-num">{{ res.composition.target_weight_kg }} <small class="dc-sub">kg</small></b></div> }
            </div>
          </section>
        }

        @case ('macros') {
          <section class="panel stack" aria-labelledby="h-mac">
            <h2 id="h-mac" class="m-0 u-h2-ui">Distribución de macronutrimentos</h2>
            <div class="dc-grid dc-grid--m">
              <div class="field"><label for="m-pk">Proteína (g por kg de peso)</label><div class="dc-unit"><input id="m-pk" class="input" type="number" step="0.1" min="0" max="4" [value]="i.macros.protein_g_per_kg ?? res.macros.protein_g_per_kg" (input)="s.setProteinPerKg(opt($event))" /><span>g/kg</span></div></div>
              <div class="field"><label for="m-lp">Lípidos (% del total calórico)</label><div class="dc-unit"><input id="m-lp" class="input" type="number" step="1" min="0" max="60" [value]="i.macros.lipids_pct || res.macros.lipids_pct" (input)="setLipids($event)" /><span>%</span></div></div>
            </div>
            @if (s.err('macros')) { <p class="error" role="alert">{{ s.err('macros') }}</p> }
            <div class="dc-grid dc-grid--m">
              <div class="dc-tile"><span class="t-row"><b>Proteínas</b><span class="dc-sub">{{ res.macros.protein_pct }} %</span></span><b class="dc-num">{{ res.macros.protein_g }} g</b><span class="dc-sub">{{ rnd(res.macros.protein_g * 4) }} kcal · {{ res.macros.protein_g_per_kg }} g/kg</span></div>
              <div class="dc-tile"><span class="t-row"><b>Lípidos</b><span class="dc-sub">{{ res.macros.lipids_pct }} %</span></span><b class="dc-num">{{ res.macros.lipids_g }} g</b><span class="dc-sub">{{ rnd(res.macros.lipids_g * 9) }} kcal</span></div>
              <div class="dc-tile"><span class="t-row"><b>Hidratos de carbono</b><span class="dc-sub">{{ res.macros.carbs_pct }} %</span></span><b class="dc-num">{{ res.macros.carbs_g }} g</b><span class="dc-sub">{{ rnd(res.macros.carbs_g * 4) }} kcal</span></div>
            </div>
            <button tuiButton type="button" size="m" class="no-print" (click)="goDieto.emit()"><app-icon name="circle-right" [size]="18" /> Aplicar al Dietocálculo (raciones equivalentes)</button>
          </section>
        }

        @case ('embarazo') {
          @if (i.pregnancy; as pg) {
            <section class="panel stack" aria-labelledby="h-pg">
              <h2 id="h-pg" class="m-0 u-h2-ui">Embarazo</h2>
              <div class="dc-grid dc-grid--m">
                <div class="field"><label for="f-pw">Semanas de gestación</label><input id="f-pw" class="input" type="number" min="1" max="42" [value]="pg.weeks" (input)="s.patch({ pregnancy: { ...pg, weeks: num($event) } })" />@if (s.err('pregnancy.weeks')) { <p class="error" role="alert">{{ s.err('pregnancy.weeks') }}</p> }</div>
                <div class="field"><label for="f-ppw">Peso pregestacional (kg)</label><input id="f-ppw" class="input" type="number" step="0.1" placeholder="Si no lo sabes, se usa el actual" [value]="pg.pre_weight_kg ?? ''" (input)="s.patch({ pregnancy: { ...pg, pre_weight_kg: opt($event) } })" /></div>
              </div>
              <app-switch [checked]="!!pg.multiple" (checkedChange)="s.patch({ pregnancy: { ...pg, multiple: $event } })">Embarazo múltiple</app-switch>
              @if (res.pregnancy; as p) {
                <dl class="dc-kv">
                  <dt>Trimestre</dt><dd>{{ p.trimester }}</dd>
                  <dt>IMC pregestacional</dt><dd>{{ p.pre_bmi }} · {{ p.pre_bmi_class }}</dd>
                  <dt>Ganancia total recomendada</dt><dd>{{ p.gain_min_total_kg }} – {{ p.gain_max_total_kg }} kg</dd>
                  <dt>Ganancia esperada a la semana {{ pg.weeks }}</dt><dd>{{ p.gain_min_now_kg }} – {{ p.gain_max_now_kg }} kg</dd>
                  @if (p.current_gain_kg !== undefined || p.gain_status) { <dt>Ganancia actual</dt><dd>{{ p.current_gain_kg ?? 0 }} kg · {{ p.gain_status }}</dd> }
                  <dt>Energía adicional</dt><dd>+{{ p.extra_kcal }} kcal</dd>
                </dl>
                <p class="dc-sub">Fuente: {{ p.source }}.</p>
              }
            </section>
          }
          @if (i.lactation) {
            <section class="panel stack" aria-labelledby="h-lac">
              <h2 id="h-lac" class="m-0 u-h2-ui">Lactancia</h2>
              <div class="dc-seg" role="radiogroup" aria-label="Meses de lactancia">
                <button type="button" role="radio" [attr.aria-checked]="i.lactation === '0-6'" (click)="s.patch({ lactation: '0-6' })">0 a 6 meses (+330 kcal)</button>
                <button type="button" role="radio" [attr.aria-checked]="i.lactation === '7-12'" (click)="s.patch({ lactation: '7-12' })">7 a 12 meses (+400 kcal)</button>
              </div>
            </section>
          }
        }
      }
    </div>
  `,
})
export class DcCalc {
  protected readonly s = inject(DietoStore);
  private readonly confirm = inject(ConfirmService);
  readonly goDieto = output<void>();

  protected readonly sub = signal<Sub>('gasto');
  protected readonly allEq = signal(false);
  protected readonly activities = ACTIVITY;
  protected readonly goals = GOALS;
  protected readonly presets = PRESETS;
  protected readonly af: Record<string, number> = ACTIVITY_FACTOR;
  protected readonly ampLabel = AMPUTATION_LABEL;
  protected readonly ampKeys = Object.keys(AMPUTATION_LABEL);
  protected readonly folds: { key: 'triceps' | 'biceps' | 'subscapular' | 'suprailiac' | 'abdominal' | 'calf'; label: string }[] = [
    { key: 'triceps', label: 'Tríceps (mm)' }, { key: 'biceps', label: 'Bíceps (mm)' }, { key: 'subscapular', label: 'Subescapular (mm)' },
    { key: 'suprailiac', label: 'Suprailíaco (mm)' }, { key: 'abdominal', label: 'Abdominal (mm)' }, { key: 'calf', label: 'Pantorrilla (mm)' },
  ];
  protected readonly shownEq = computed(() => {
    const all = this.s.r().energy.equations;
    return this.allEq() ? all : all.slice(0, 4);
  });
  protected readonly hasOptional = computed(() => { const i = this.s.inp(); return !!(i.waist_cm || i.hip_cm || i.neck_cm || i.target_fat_pct); });

  protected readonly num = numVal;
  protected readonly opt = optVal;
  protected tone(c: Classification): Tone { return TONE[c.tone] ?? 'neutral'; }
  protected bmiText(c: Classification): string { return BMI_TEXT[c.label] ?? c.label; }
  protected eqName(id: string): string { return (this.s.r().energy.equations.find((e) => e.id === id)?.name ?? id).replace(/\s*\(\d{4}(\/\d{4})?\)/, ''); }
  protected rnd(x: number): number { return Math.round(x); }

  protected async reset(): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Restablecer los datos', message: 'Se borran los datos capturados y los ajustes de esta dieta (no el expediente del paciente).', confirmLabel: 'Restablecer', tone: 'danger' }))) return;
    this.s.set(defaultInputs());
  }

  protected togglePregnancy(on: boolean): void { this.s.patch({ pregnancy: on ? { weeks: 20 } : undefined, lactation: on ? '' : this.s.inp().lactation }); if (on) this.sub.set('embarazo'); }
  protected toggleLactation(on: boolean): void { this.s.patch({ lactation: on ? '0-6' : '', pregnancy: on ? undefined : this.s.inp().pregnancy }); if (on) this.sub.set('embarazo'); }
  protected toggleAmp(key: string, e: Event): void {
    const cur = new Set(this.s.inp().amputations ?? []);
    if ((e.target as HTMLInputElement).checked) cur.add(key); else cur.delete(key);
    this.s.patch({ amputations: [...cur] });
  }

  protected fold(k: string): number | string { return (this.s.inp().skinfolds as Record<string, number | undefined> | undefined)?.[k] ?? ''; }
  protected setFold(k: string, e: Event): void {
    const sf: Record<string, number | undefined> = { ...(this.s.inp().skinfolds ?? {}) };
    sf[k] = optVal(e);
    this.s.patch({ skinfolds: sf as DietInputs['skinfolds'] });
  }
  protected setFormula(id: string): void { this.s.patch({ formula: id as Formula }); }
  protected useMethod(id: FatMethodId): void { this.s.patch({ fat_method: id }); }
  protected setLipids(e: Event): void {
    const v = numVal(e);
    const m = this.s.inp().macros;
    if ((m.protein_g_per_kg ?? 0) > 0) this.s.patch({ macros: { ...m, lipids_pct: v } });
    else this.s.patch({ macros: { ...m, lipids_pct: v, carbs_pct: Math.max(0, 100 - v - m.protein_pct) } });
  }

  protected onSubKey(e: KeyboardEvent): void {
    const ids = (['gasto', 'antro', 'comp', 'macros', ...(this.s.inp().pregnancy || this.s.inp().lactation ? ['embarazo'] : [])]) as Sub[];
    const idx = ids.indexOf(this.sub());
    const next = e.key === 'ArrowRight' ? (idx + 1) % ids.length : e.key === 'ArrowLeft' ? (idx - 1 + ids.length) % ids.length : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    this.sub.set(ids[next]);
    queueMicrotask(() => document.getElementById('st-' + ids[next])?.focus());
  }
}
