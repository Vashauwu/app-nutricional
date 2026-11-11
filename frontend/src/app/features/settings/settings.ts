import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { PatientsService } from '../../core/services/patients.service';
import { PlansService } from '../../core/services/plans.service';
import { SettingsService } from '../../core/services/settings.service';
import { ConfirmService, ToastService, contrastRatio, isHex } from '../../core/services/ui.services';
import { ClinicalRule, ConsentType } from '../../shared/models/domain';
import { FieldError, decimalValidator } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { Badge, EmptyState, Pagination } from '../../shared/components/ui';
import { processImage } from '../../shared/utils/image';
import { downloadBlob, formatBytes, formatDateTime, toCsv } from '../../shared/utils/format';

type Tab = 'marca' | 'region' | 'almacenamiento' | 'alertas' | 'consentimientos' | 'sesiones' | 'auditoria' | 'demo';
const MB = 1024 * 1024;
const ZONES = ['America/Mexico_City', 'America/Cancun', 'America/Monterrey', 'America/Chihuahua', 'America/Hermosillo', 'America/Tijuana', 'America/Mazatlan'];

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, TuiButton, Icon, Modal, Badge, EmptyState, Pagination, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .preview { display: grid; gap: var(--space-3); padding: var(--space-5); border-radius: var(--radius-m); border: 1px solid var(--line); background: var(--nutri-marfil); }
    .pv-logo { inline-size: 3.5rem; block-size: 3.5rem; border-radius: .875rem; display: grid; place-items: center; font-family: var(--nutri-font-display); font-size: 1.75rem; object-fit: cover; }
    .color { display: flex; gap: var(--space-2); align-items: center; } .color input[type='color'] { inline-size: 3rem; block-size: var(--tap); padding: 0; border: 1px solid var(--line); border-radius: var(--radius-s); background: var(--surface); }
    .layout { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr); align-items: start; } @media (max-width: 62rem) { .layout { grid-template-columns: minmax(0, 1fr); } }
    textarea.doc { min-block-size: 12rem; }
  `,
  template: `
    <div class="page">
      <header class="page-header"><div><h1>Configuración</h1><p class="sub">Identidad visual, región, cuotas, alertas, consentimientos, sesiones y auditoría.</p></div></header>

      <div class="tabs" role="tablist" aria-label="Secciones de configuración" (keydown)="onTabKey($event)">
        @for (t of tabs; track t.id) { <button type="button" role="tab" [id]="'st-' + t.id" [attr.aria-selected]="tab() === t.id" [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="tab.set(t.id)">{{ t.label }}</button> }
      </div>

      @switch (tab()) {
        @case ('marca') {
          <div class="layout">
            <form [formGroup]="brandForm" (ngSubmit)="saveBrand()" class="panel" novalidate>
              <h2 class="panel-head" style="font-size: 1.125rem">Identidad de la nutrióloga</h2>
              <p class="small muted">Se aplica sin cambios de código: encabezados, PDF e impresiones.</p>
              <div class="form-grid">
                <div class="field"><label for="b-n">Nombre comercial</label><input id="b-n" class="input" formControlName="businessName" /><app-field-error [control]="brandForm.controls.businessName" /></div>
                <div class="field"><label for="b-t">Lema</label><input id="b-t" class="input" formControlName="tagline" /></div>
                <div class="field"><label for="b-p">Color principal</label><div class="color"><input type="color" aria-label="Elegir color principal" [value]="brandForm.controls.primary.value" (input)="brandForm.controls.primary.setValue($any($event.target).value)" /><input id="b-p" class="input" formControlName="primary" /></div>
                  <app-field-error [control]="brandForm.controls.primary" [messages]="{ pattern: 'Usa un color hexadecimal, p. ej. #514653.' }" />
                  @if (primaryContrast() < 4.5) { <p class="error" role="alert">Contraste bajo ({{ primaryContrast().toFixed(1) }}:1). Para botones y texto se requiere al menos 4.5:1; no se aplicará.</p> } @else { <span class="hint">Contraste {{ primaryContrast().toFixed(1) }}:1 · cumple WCAG AA.</span> }</div>
                <div class="field"><label for="b-s">Color secundario (superficies)</label><div class="color"><input type="color" aria-label="Elegir color secundario" [value]="brandForm.controls.secondary.value" (input)="brandForm.controls.secondary.setValue($any($event.target).value)" /><input id="b-s" class="input" formControlName="secondary" /></div><app-field-error [control]="brandForm.controls.secondary" [messages]="{ pattern: 'Usa un color hexadecimal.' }" /></div>
                <div class="field"><label for="b-ph">Teléfono</label><input id="b-ph" class="input" formControlName="phone" /></div>
                <div class="field"><label for="b-em">Correo de contacto</label><input id="b-em" class="input" type="email" formControlName="email" /><app-field-error [control]="brandForm.controls.email" /></div>
              </div>
              <div class="field"><label for="b-ad">Dirección</label><input id="b-ad" class="input" formControlName="address" /></div>
              <div class="form-grid"><div class="field"><label for="b-cr">Credenciales profesionales</label><input id="b-cr" class="input" formControlName="credentials" /></div><div class="field"><label for="b-li">Cédula o registro</label><input id="b-li" class="input" formControlName="licenseNumber" /></div></div>
              <div class="form-grid">
                <div class="field"><label for="b-lg">Logotipo</label><input id="b-lg" class="input" type="file" accept="image/png,image/jpeg,image/webp" (change)="onImage($event, 'logo')" /></div>
                <div class="field"><label for="b-fo">Fotografía profesional</label><input id="b-fo" class="input" type="file" accept="image/png,image/jpeg,image/webp" (change)="onImage($event, 'photo')" /></div>
              </div>
              @if (imgError()) { <p class="error" role="alert">{{ imgError() }}</p> }
              <div class="form-actions"><button tuiButton type="submit" size="m">Guardar identidad</button></div>
            </form>
            <aside class="preview" aria-label="Vista previa de la marca">
              <p class="eyebrow">Vista previa (PDF / encabezado)</p>
              <div class="row">@if (logo()) { <img class="pv-logo" [src]="logo()" alt="" /> } @else { <span class="pv-logo" [style.background]="brandForm.controls.secondary.value">{{ initial() }}</span> }
                <div><strong style="font-size: 1.25rem; font-family: var(--nutri-font-display)">{{ brandForm.controls.businessName.value }}</strong><p class="small muted">{{ brandForm.controls.tagline.value }}</p></div></div>
              <hr style="border: 0; border-block-start: 3px solid; inline-size: 100%" [style.border-color]="brandForm.controls.primary.value" />
              @if (photo()) { <img [src]="photo()" alt="Fotografía profesional" style="max-inline-size: 8rem; border-radius: var(--radius-m)" /> }
              <p class="small">{{ brandForm.controls.credentials.value }}<br />{{ brandForm.controls.licenseNumber.value }}</p>
              <p class="small muted">{{ brandForm.controls.phone.value }} · {{ brandForm.controls.email.value }}<br />{{ brandForm.controls.address.value }}</p>
            </aside>
          </div>
        }
        @case ('region') {
          <form [formGroup]="regionForm" (ngSubmit)="saveRegion()" class="panel" style="max-inline-size: 40rem" novalidate>
            <h2 class="panel-head" style="font-size: 1.125rem">Región y formato</h2>
            <dl style="display: grid; grid-template-columns: auto 1fr; gap: .25rem var(--space-4); margin: 0"><dt class="muted">Idioma</dt><dd style="margin: 0">Español (México)</dd><dt class="muted">Moneda</dt><dd style="margin: 0">MXN</dd><dt class="muted">Unidades</dt><dd style="margin: 0">kg · cm · g · ml</dd><dt class="muted">Fecha</dt><dd style="margin: 0">DD/MM/AAAA</dd></dl>
            <div class="field"><label for="r-z">Zona horaria</label><select id="r-z" class="select" formControlName="timezone">@for (z of zones; track z) { <option [value]="z">{{ z }}</option> }</select></div>
            <div class="field"><label for="r-w">La semana inicia en</label><select id="r-w" class="select" formControlName="weekStart"><option value="mon">Lunes (propuesta inicial)</option><option value="sun">Domingo</option></select></div>
            <div class="form-actions"><button tuiButton type="submit" size="m">Guardar región</button></div>
          </form>
        }
        @case ('almacenamiento') {
          <div class="stack">
            <form [formGroup]="storageForm" (ngSubmit)="saveStorage()" class="panel" novalidate>
              <h2 class="panel-head" style="font-size: 1.125rem">Cuotas y límites de carga</h2>
              <div class="form-grid">
                <div class="field"><label for="s-q">Cuota base por paciente (MB)</label><input id="s-q" class="input" inputmode="decimal" formControlName="quotaMb" /><app-field-error [control]="storageForm.controls.quotaMb" /></div>
                <div class="field"><label for="s-i">Máximo por imagen (MB)</label><input id="s-i" class="input" inputmode="decimal" formControlName="imageMb" /><app-field-error [control]="storageForm.controls.imageMb" /></div>
                <div class="field"><label for="s-p">Máximo por PDF (MB)</label><input id="s-p" class="input" inputmode="decimal" formControlName="pdfMb" /><app-field-error [control]="storageForm.controls.pdfMb" /></div>
                <div class="field"><label for="s-w">Alertar al llegar a (%)</label><input id="s-w" class="input" inputmode="numeric" formControlName="warnPct" /><app-field-error [control]="storageForm.controls.warnPct" /></div>
              </div>
              <div class="form-actions"><button tuiButton type="submit" size="m">Guardar límites</button></div>
            </form>
            <section class="panel panel--flush" aria-labelledby="h-use">
              <div class="panel-head"><h2 id="h-use">Uso por paciente</h2><span class="small muted">Las ampliaciones individuales las autorizas tú.</span></div>
              <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Paciente</th><th scope="col">Uso</th><th scope="col" class="num">Cuota (MB)</th><th scope="col"><span class="visually-hidden">Acciones</span></th></tr></thead><tbody>
                @for (r of usage(); track r.id) {
                  <tr><td>{{ r.name }}</td><td style="min-inline-size: 12rem"><div class="meter" role="img" [attr.aria-label]="r.pct + '% usado'"><span [style.inline-size.%]="r.pct" [style.background]="r.warn ? 'var(--warn)' : null"></span></div><span class="small muted">{{ bytes(r.used) }} ({{ r.pct }} %)@if (r.warn) { · <strong>cerca del límite</strong> }</span></td>
                    <td class="num"><label class="visually-hidden" [for]="'q-' + r.id">Cuota de {{ r.name }} en MB</label><input [id]="'q-' + r.id" class="input" style="max-inline-size: 7rem; text-align: end" inputmode="decimal" [value]="r.quotaMb" #qi /></td>
                    <td><button tuiButton type="button" size="s" appearance="secondary" (click)="setQuota(r.id, qi.value)">Ampliar</button></td></tr>
                }
              </tbody></table></div>
            </section>
          </div>
        }
        @case ('alertas') {
          <div class="stack">
            <form [formGroup]="alertForm" (ngSubmit)="saveThresholds()" class="panel" novalidate>
              <h2 class="panel-head" style="font-size: 1.125rem">Umbrales de desviación</h2>
              <p class="small muted">Se comparan los totales del día contra los objetivos del plan. Estos valores deben validarlos tú; no se infieren diagnósticos.</p>
              <div class="form-grid">
                <div class="field"><label for="a-e">Energía: tolerancia ±%</label><input id="a-e" class="input" inputmode="decimal" formControlName="energyTolerancePct" /><app-field-error [control]="alertForm.controls.energyTolerancePct" /></div>
                <div class="field"><label for="a-m">Macronutrientes: tolerancia ±%</label><input id="a-m" class="input" inputmode="decimal" formControlName="macroTolerancePct" /><app-field-error [control]="alertForm.controls.macroTolerancePct" /></div>
                <div class="field"><label for="a-q">Equivalentes: tolerancia ± eq.</label><input id="a-q" class="input" inputmode="decimal" formControlName="equivalentTolerance" /><app-field-error [control]="alertForm.controls.equivalentTolerance" /></div>
              </div>
              <div class="form-actions"><button tuiButton type="submit" size="m">Guardar umbrales</button></div>
            </form>
            <section class="panel panel--flush" aria-labelledby="h-rules">
              <div class="panel-head"><h2 id="h-rules">Reglas clínicas configurables</h2><button tuiButton type="button" size="s" (click)="openRule()"><app-icon name="plus" [size]="16" /> Nueva regla</button></div>
              <p class="small muted" style="padding: 0 var(--space-5)">Si el paciente tiene la indicación o condición, los platillos que mencionan alguna palabra disparan la alerta. Las alergias y alimentos que no consume siempre se evalúan.</p>
              <ul class="list-plain list-rows">
                @for (r of rules(); track r.id) {
                  <li><div class="grow"><strong>{{ r.keyword }}</strong> <app-badge [tone]="r.level === 'critical' ? 'crit' : r.level === 'warning' ? 'warn' : 'info'">{{ r.level === 'critical' ? 'Crítica' : r.level === 'warning' ? 'Advertencia' : 'Informativa' }}</app-badge> @if (!r.enabled) { <app-badge icon="ban">Desactivada</app-badge> }<p class="small muted">{{ r.message }} · Palabras: {{ r.triggers.join(', ') }}</p></div>
                    <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Editar regla ' + r.keyword" (click)="openRule(r)"><app-icon name="edit" [size]="18" /></button>
                    <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Eliminar regla ' + r.keyword" (click)="deleteRule(r)"><app-icon name="trash" [size]="18" /></button></li>
                } @empty { <li><app-empty icon="alert" title="Sin reglas" /></li> }
              </ul>
            </section>
          </div>
        }
        @case ('consentimientos') {
          <div class="grid grid--2">
            @for (t of consentTypes; track t.type) {
              <section class="panel" [attr.aria-label]="t.label">
                <h2 class="panel-head" style="font-size: 1.125rem">{{ t.label }}</h2>
                <p class="small muted">Versión vigente {{ latest(t.type)?.version }} · {{ acceptCount(t.type) }} aceptación(es). Editar el texto publica una versión nueva; las anteriores no se sobrescriben.</p>
                <div class="field"><label [for]="'doc-' + t.type">Texto vigente</label><textarea [id]="'doc-' + t.type" class="textarea doc" [value]="drafts()[t.type] ?? latest(t.type)?.content ?? ''" (input)="setDraft(t.type, $any($event.target).value)"></textarea></div>
                <div class="form-actions"><button tuiButton type="button" size="m" [disabled]="!dirtyDoc(t.type)" (click)="publishDoc(t.type, t.label)">Publicar como versión {{ (latest(t.type)?.version ?? 0) + 1 }}</button></div>
                <details><summary class="small">Versiones anteriores</summary><ul class="small">@for (v of versions(t.type); track v.id) { <li>v{{ v.version }} · {{ fdt(v.publishedAt) }} · {{ v.isActive ? 'vigente' : 'reemplazada' }} · {{ acceptances(v.id) }} aceptación(es)</li> }</ul></details>
              </section>
            }
          </div>
          <div class="callout callout--warn"><app-icon name="alert" /><div class="callout-body">Estos textos son marcadores. Antes de producción deben validarse con asesoría jurídica en protección de datos y atención sanitaria en México (§4.1, §25.1).</div></div>
        }
        @case ('sesiones') {
          <section class="panel panel--flush" aria-labelledby="h-ses">
            <div class="panel-head"><h2 id="h-ses">Sesiones activas</h2><button tuiButton type="button" size="s" appearance="secondary-destructive" [disabled]="sessions().length < 2" (click)="revokeOthers()">Cerrar todas las demás</button></div>
            <ul class="list-plain list-rows">
              @for (s of sessions(); track s.id) {
                <li><app-icon name="shield" /><div class="grow"><strong>{{ s.device }} · {{ s.browser }}</strong> @if (s.id === auth.currentSessionId()) { <app-badge tone="ok" icon="check">Esta sesión</app-badge> }<p class="small muted">Inicio {{ fdt(s.createdAt) }} · Última actividad {{ fdt(s.lastSeenAt) }}</p></div>
                  @if (s.id !== auth.currentSessionId()) { <button tuiButton type="button" size="s" appearance="secondary" (click)="revoke(s.id)">Cerrar sesión</button> }</li>
              }
            </ul>
          </section>
        }
        @case ('auditoria') {
          <section class="panel panel--flush" aria-labelledby="h-aud">
            <div class="panel-head"><h2 id="h-aud">Auditoría interna</h2><div class="row"><div class="field"><label class="visually-hidden" for="au-q">Filtrar</label><input id="au-q" class="input" type="search" placeholder="Filtrar por acción o resumen…" (input)="auditQ.set($any($event.target).value); auditPage.set(1)" /></div><button tuiButton type="button" size="s" appearance="secondary" (click)="exportAudit()"><app-icon name="download" [size]="16" /> CSV</button></div></div>
            <p class="small muted" style="padding: 0 var(--space-5)">No visible para pacientes. No contiene contraseñas ni tokens.</p>
            <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Fecha</th><th scope="col">Actor</th><th scope="col">Acción</th><th scope="col">Recurso</th><th scope="col">Detalle</th><th scope="col">Solicitud</th></tr></thead><tbody>
              @for (a of auditPageItems(); track a.id) { <tr><td class="small">{{ fdt(a.at) }}</td><td>{{ a.actor }}</td><td><code class="small">{{ a.action }}</code></td><td class="small">{{ a.resourceType }}</td><td>{{ a.summary }}</td><td class="small muted"><code>{{ a.requestId }}</code></td></tr> } @empty { <tr><td colspan="6" class="muted">Sin eventos.</td></tr> }
            </tbody></table></div>
            <app-pagination [page]="auditPage()" [pageSize]="12" [total]="auditFiltered().length" (pageChange)="auditPage.set($event)" />
          </section>
        }
        @case ('demo') {
          <section class="panel" style="max-inline-size: 44rem" aria-labelledby="h-demo">
            <h2 id="h-demo" class="panel-head" style="font-size: 1.125rem">Herramientas de demostración</h2>
            <p class="small muted">Sirven para probar flujos que dependen del backend: conexión, concurrencia y datos de ejemplo. No existirán en producción.</p>
            <label class="check"><input type="checkbox" [checked]="data.forcedOffline()" (change)="data.forcedOffline.set($any($event.target).checked)" /><span><strong>Simular sin conexión</strong><br /><span class="small muted">El editor de planes encola cambios y la app de la paciente muestra el estado sin conexión.</span></span></label>
            <div class="field"><label for="cc">Simular edición concurrente</label>
              <div class="row"><select id="cc" class="select" style="max-inline-size: 22rem" (change)="ccPlan.set($any($event.target).value)"><option value="">Elige un plan…</option>@for (p of plansList(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }</select><button tuiButton type="button" size="m" appearance="secondary" [disabled]="!ccPlan()" (click)="simulateConcurrent()">Simular cambio de otra sesión</button></div>
              <span class="hint">Abre el plan en el editor, haz un cambio y luego usa este botón: al guardar verás el aviso de conflicto.</span></div>
            <hr style="border: 0; border-block-start: 1px solid var(--line); inline-size: 100%" />
            <div><button tuiButton type="button" size="m" appearance="secondary-destructive" (click)="resetDemo()">Restablecer datos de ejemplo</button></div>
          </section>
        }
      }
    </div>

    <app-modal [(open)]="ruleOpen" [title]="ruleForm.controls.id.value ? 'Editar regla clínica' : 'Nueva regla clínica'">
      <form [formGroup]="ruleForm" id="rule-form" (ngSubmit)="saveRule()" class="stack" novalidate>
        <div class="field"><label for="ru-k">Indicación o condición</label><input id="ru-k" class="input" formControlName="keyword" placeholder="Ej.: hipertensión" /><app-field-error [control]="ruleForm.controls.keyword" /></div>
        <div class="field"><label for="ru-t">Palabras que disparan la alerta</label><input id="ru-t" class="input" formControlName="triggers" aria-describedby="ru-t-h" /><span class="hint" id="ru-t-h">Separadas por comas. Se buscan en nombres, etiquetas e ingredientes.</span><app-field-error [control]="ruleForm.controls.triggers" /></div>
        <div class="field"><label for="ru-m">Mensaje</label><input id="ru-m" class="input" formControlName="message" /><app-field-error [control]="ruleForm.controls.message" /></div>
        <div class="field"><label for="ru-l">Nivel</label><select id="ru-l" class="select" formControlName="level"><option value="info">Informativa</option><option value="warning">Advertencia</option><option value="critical">Crítica</option></select></div>
        <label class="check"><input type="checkbox" formControlName="enabled" /> Regla activa</label>
      </form>
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="ruleOpen.set(false)">Cancelar</button><button tuiButton type="submit" form="rule-form" size="m">Guardar regla</button></ng-container>
    </app-modal>
  `,
})
export class SettingsPage {
  protected readonly data = inject(DbService);
  protected readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly patients = inject(PatientsService);
  private readonly plans = inject(PlansService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly tab = signal<Tab>('marca');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'marca', label: 'Marca' }, { id: 'region', label: 'Región' }, { id: 'almacenamiento', label: 'Almacenamiento' }, { id: 'alertas', label: 'Alertas' },
    { id: 'consentimientos', label: 'Consentimientos' }, { id: 'sesiones', label: 'Sesiones' }, { id: 'auditoria', label: 'Auditoría' }, { id: 'demo', label: 'Demostración' },
  ].filter((t) => !(this.settings.apiMode && t.id === 'demo')) as { id: Tab; label: string }[];
  protected readonly zones = ZONES;

  private applyStore(): void {
    const s = this.settings.get();
    this.brandForm.reset({ businessName: s.brand.businessName, tagline: s.brand.tagline, primary: s.brand.primary, secondary: s.brand.secondary, phone: s.brand.phone, email: s.brand.email, address: s.brand.address, credentials: s.brand.credentials, licenseNumber: s.brand.licenseNumber });
    this.primary.set(s.brand.primary);
    this.logo.set(s.brand.logoDataUrl);
    this.photo.set(s.brand.photoDataUrl);
    this.regionForm.reset({ timezone: s.region.timezone, weekStart: s.region.weekStart });
    this.storageForm.reset({ quotaMb: String(s.storage.defaultQuotaBytes / MB), imageMb: String(s.storage.maxImageBytes / MB), pdfMb: String(s.storage.maxPdfBytes / MB), warnPct: String(s.storage.warnThresholdPct) });
    this.alertForm.reset({ energyTolerancePct: String(s.alerts.energyTolerancePct), macroTolerancePct: String(s.alerts.macroTolerancePct), equivalentTolerance: String(s.alerts.equivalentTolerance) });
  }
  protected readonly fdt = formatDateTime;
  protected readonly bytes = formatBytes;
  protected readonly consentTypes: { type: ConsentType; label: string }[] = [{ type: 'privacy', label: 'Aviso de privacidad' }, { type: 'informed', label: 'Consentimiento informado' }];

  // ---------- Marca ----------
  private readonly s0 = this.settings.get();
  protected readonly brandForm = this.fb.nonNullable.group({
    businessName: [this.s0.brand.businessName, Validators.required], tagline: [this.s0.brand.tagline],
    primary: [this.s0.brand.primary, [Validators.required, Validators.pattern(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)]],
    secondary: [this.s0.brand.secondary, [Validators.required, Validators.pattern(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)]],
    phone: [this.s0.brand.phone], email: [this.s0.brand.email, Validators.email], address: [this.s0.brand.address],
    credentials: [this.s0.brand.credentials], licenseNumber: [this.s0.brand.licenseNumber],
  });
  private readonly primary = signal(this.s0.brand.primary);
  protected readonly logo = signal<string | undefined>(this.s0.brand.logoDataUrl);
  protected readonly photo = signal<string | undefined>(this.s0.brand.photoDataUrl);
  protected readonly imgError = signal('');
  protected readonly primaryContrast = computed(() => (isHex(this.primary()) ? contrastRatio(this.primary(), '#FAF7F2') : 21));
  protected readonly initial = computed(() => this.brandForm.controls.businessName.value.trim()[0]?.toUpperCase() ?? 'N');

  // ---------- Región ----------
  protected readonly regionForm = this.fb.nonNullable.group({ timezone: [this.s0.region.timezone], weekStart: [this.s0.region.weekStart] });

  // ---------- Almacenamiento ----------
  protected readonly storageForm = this.fb.nonNullable.group({
    quotaMb: [String(this.s0.storage.defaultQuotaBytes / MB), [Validators.required, decimalValidator, Validators.min(1)]],
    imageMb: [String(this.s0.storage.maxImageBytes / MB), [Validators.required, decimalValidator, Validators.min(1)]],
    pdfMb: [String(this.s0.storage.maxPdfBytes / MB), [Validators.required, decimalValidator, Validators.min(1)]],
    warnPct: [String(this.s0.storage.warnThresholdPct), [Validators.required, decimalValidator, Validators.min(1), Validators.max(100)]],
  });
  protected readonly usage = computed(() => this.patients.all().map((p) => { const q = this.patients.quota(p); return { id: p.id, name: this.patients.fullName(p), ...q, quotaMb: Math.round(q.quota / MB) }; }));

  // ---------- Alertas ----------
  protected readonly alertForm = this.fb.nonNullable.group({
    energyTolerancePct: [String(this.s0.alerts.energyTolerancePct), [Validators.required, decimalValidator, Validators.min(1), Validators.max(50)]],
    macroTolerancePct: [String(this.s0.alerts.macroTolerancePct), [Validators.required, decimalValidator, Validators.min(1), Validators.max(50)]],
    equivalentTolerance: [String(this.s0.alerts.equivalentTolerance), [Validators.required, decimalValidator, Validators.min(0)]],
  });
  protected readonly rules = computed(() => this.data.db().settings.alerts.clinicalRules);
  protected readonly ruleOpen = signal(false);
  protected readonly ruleForm = this.fb.nonNullable.group({ id: [''], keyword: ['', Validators.required], triggers: ['', Validators.required], message: ['', Validators.required], level: ['warning' as ClinicalRule['level']], enabled: [true] });

  // ---------- Consentimientos ----------
  protected readonly drafts = signal<Record<string, string>>({});
  protected latest = (t: ConsentType) => this.settings.consentVersions(t).find((v) => v.isActive);
  protected versions = (t: ConsentType) => this.settings.consentVersions(t);
  protected acceptances = (id: string): number => this.settings.acceptanceCount(id);
  protected acceptCount = (t: ConsentType): number => this.acceptances(this.latest(t)?.id ?? '');
  protected setDraft(t: ConsentType, v: string): void { this.drafts.update((d) => ({ ...d, [t]: v })); }
  protected dirtyDoc = (t: ConsentType): boolean => this.drafts()[t] !== undefined && this.drafts()[t] !== this.latest(t)?.content;

  // ---------- Sesiones / auditoría / demo ----------
  protected readonly sessions = computed(() => this.auth.mySessions());
  protected readonly auditQ = signal('');
  protected readonly auditPage = signal(1);
  protected readonly auditFiltered = computed(() => {
    const q = this.auditQ().toLowerCase();
    return this.data.db().audit.filter((a) => !q || `${a.action} ${a.summary} ${a.actor}`.toLowerCase().includes(q));
  });
  protected readonly auditPageItems = computed(() => this.auditFiltered().slice((this.auditPage() - 1) * 12, this.auditPage() * 12));
  protected readonly ccPlan = signal('');
  protected readonly plansList = computed(() => this.data.db().plans.filter((p) => !p.deletedAt && p.status !== 'archived'));

  constructor() {
    this.brandForm.controls.primary.valueChanges.subscribe((v) => this.primary.set(v));
    // Modo API: la configuración vive en el servidor; los formularios se rellenan al llegar.
    this.settings.load().subscribe({ next: () => this.applyStore(), error: () => undefined });
  }

  protected onTabKey(e: KeyboardEvent): void {
    const i = this.tabs.findIndex((t) => t.id === this.tab());
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const t = this.tabs[(n + this.tabs.length) % this.tabs.length];
    this.tab.set(t.id);
    setTimeout(() => document.getElementById('st-' + t.id)?.focus());
  }

  protected async onImage(e: Event, which: 'logo' | 'photo'): Promise<void> {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    this.imgError.set('');
    if (!f) return;
    try {
      const r = await processImage(f, this.data.db().settings.storage.maxImageBytes);
      (which === 'logo' ? this.logo : this.photo).set(r.dataUrl);
    } catch (err) {
      this.imgError.set(err instanceof Error ? err.message : 'No se pudo procesar la imagen.');
      input.value = '';
    }
  }

  protected saveBrand(): void {
    this.brandForm.markAllAsTouched();
    if (this.brandForm.invalid) return;
    if (this.primaryContrast() < 4.5) { this.toast.error('El color principal no tiene contraste suficiente.'); return; }
    this.settings.saveBrand({ ...this.brandForm.getRawValue(), logoDataUrl: this.logo(), photoDataUrl: this.photo() }).subscribe({
      next: () => this.toast.ok('Identidad actualizada. Ya se aplica en toda la plataforma.'),
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  protected saveRegion(): void { this.settings.saveRegion(this.regionForm.getRawValue()).subscribe({ next: () => this.toast.ok('Región actualizada.'), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') }); }

  protected saveStorage(): void {
    this.storageForm.markAllAsTouched();
    if (this.storageForm.invalid) return;
    const v = this.storageForm.getRawValue();
    this.settings.saveStorage({ defaultQuotaBytes: Math.round(Number(v.quotaMb) * MB), maxImageBytes: Math.round(Number(v.imageMb) * MB), maxPdfBytes: Math.round(Number(v.pdfMb) * MB), warnThresholdPct: Number(v.warnPct) }).subscribe({
      next: () => this.toast.ok('Límites actualizados.'),
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  protected setQuota(id: string, mb: string): void {
    if (!/^\d+(\.\d+)?$/.test(mb) || Number(mb) <= 0) { this.toast.error('Escribe una cuota válida en MB.'); return; }
    this.patients.update(id, { quotaOverrideBytes: Math.round(Number(mb) * MB) });
    this.toast.ok('Cuota individual actualizada.');
  }

  protected saveThresholds(): void {
    this.alertForm.markAllAsTouched();
    if (this.alertForm.invalid) return;
    const v = this.alertForm.getRawValue();
    this.settings.saveAlertThresholds({ energyTolerancePct: Number(v.energyTolerancePct), macroTolerancePct: Number(v.macroTolerancePct), equivalentTolerance: Number(v.equivalentTolerance) }).subscribe({
      next: () => this.toast.ok('Umbrales guardados. Las alertas se recalculan al instante.'),
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  protected openRule(r?: ClinicalRule): void {
    this.ruleForm.reset({ id: r?.id ?? '', keyword: r?.keyword ?? '', triggers: r?.triggers.join(', ') ?? '', message: r?.message ?? '', level: r?.level ?? 'warning', enabled: r?.enabled ?? true });
    this.ruleOpen.set(true);
  }

  protected saveRule(): void {
    this.ruleForm.markAllAsTouched();
    if (this.ruleForm.invalid) return;
    const { id, triggers, ...v } = this.ruleForm.getRawValue();
    this.settings.saveRule({ ...v, id: id || undefined, triggers: triggers.split(',').map((t) => t.trim()).filter(Boolean) }).subscribe({
      next: () => { this.ruleOpen.set(false); this.toast.ok('Regla guardada.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  protected async deleteRule(r: ClinicalRule): Promise<void> {
    if (await this.confirm.ask({ title: 'Eliminar regla', message: `Se eliminará la regla "${r.keyword}".`, confirmLabel: 'Eliminar', tone: 'danger' })) this.settings.deleteRule(r.id).subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') });
  }

  protected async publishDoc(t: ConsentType, label: string): Promise<void> {
    const text = this.drafts()[t];
    if (!text?.trim()) return;
    const ok = await this.confirm.ask({ title: 'Publicar nueva versión', message: `Se publicará una versión nueva de "${label}". Los pacientes deberán aceptarla antes de continuar con su expediente.`, confirmLabel: 'Publicar' });
    if (!ok) return;
    this.settings.publishConsentVersion(t, label, text.trim()).subscribe({
      next: () => { this.drafts.update((d) => { const { [t]: _, ...rest } = d; return rest; }); this.toast.ok('Versión publicada.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
    });
  }

  protected revoke(id: string): void { this.auth.revokeSession(id); this.toast.ok('Sesión cerrada.'); }
  protected revokeOthers(): void { this.auth.revokeOtherSessions(); this.toast.ok('Se cerraron las demás sesiones.'); }

  protected exportAudit(): void {
    const rows = [['Fecha', 'Actor', 'Acción', 'Recurso', 'Id', 'Detalle', 'Solicitud'], ...this.auditFiltered().map((a) => [a.at, a.actor, a.action, a.resourceType, a.resourceId, a.summary, a.requestId])];
    downloadBlob('auditoria.csv', toCsv(rows), 'text/csv;charset=utf-8');
    this.data.mutate((d) => this.data.audit(d, 'export.audit', 'audit_log', '*', 'Exportó la auditoría'));
  }

  protected simulateConcurrent(): void {
    const id = this.ccPlan();
    this.data.mutate((d) => {
      const p = d.plans.find((x) => x.id === id);
      if (!p) return;
      p.revision += 1;
      p.updatedAt = new Date().toISOString();
      p.updatedBy = 'Otra sesión (simulada)';
      if (p.days[0]) p.days[0].notes = `${p.days[0].notes} [editado en otra sesión]`.trim();
    });
    this.toast.info('Otra sesión modificó el plan. Si tienes cambios sin guardar en el editor, verás el conflicto al guardar.');
  }

  protected async resetDemo(): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Restablecer datos', message: 'Se perderán los cambios hechos a los datos de ejemplo y se cerrará tu sesión.', confirmLabel: 'Restablecer', tone: 'danger' });
    if (!ok) return;
    this.settings.resetDemo();
    this.auth.logout();
    void this.router.navigate(['/ingresar']);
  }
}
