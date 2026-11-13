import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { InsightsService } from '../../core/services/insights.service';
import { PatientsService } from '../../core/services/patients.service';
import { ToastService } from '../../core/services/ui.services';
import { DOC_CATEGORY_LABEL, GOAL_LABEL, PatientDocument } from '../../shared/models/domain';
import { BarChart, LineChart, Ring } from '../../shared/components/charts';
import { Icon } from '../../shared/components/icon';
import { FieldError } from '../../shared/components/forms';
import { Modal } from '../../shared/components/modal';
import { EmptyState } from '../../shared/components/ui';
import { addDays, ageFrom, downloadBlob, formatBytes, formatDate, formatDateTime, shortDate, startOfWeek } from '../../shared/utils/format';
import { PatientContext } from './patient-context';

@Component({
  selector: 'app-patient-progress',
  imports: [LineChart, BarChart, Ring, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <h1 style="font-size: 1.5rem">Mi progreso</h1>
      <section class="panel" aria-labelledby="h-c">
        <h2 id="h-c" class="panel-head" style="font-size: 1.0625rem">Cumplimiento</h2>
        <p class="small muted">Es independiente de tu evolución física: refleja cuántas comidas marcaste como realizadas.</p>
        <div class="row"><app-ring [pct]="comp().pct ?? 0" label="en 2 semanas" [size]="110" /><div><p><strong>{{ comp().done }}</strong> de {{ comp().planned }} comidas</p><p class="small muted">{{ comp().skipped }} omitidas · {{ comp().pending }} sin registro</p></div></div>
        <app-bar-chart [data]="weekly()" aLabel="Programadas" bLabel="Realizadas" title="Cumplimiento por semana" />
      </section>
      <section class="panel" aria-labelledby="h-m">
        <h2 id="h-m" class="panel-head" style="font-size: 1.0625rem">Mi evolución</h2>
        @if (!patient()?.measurementsVisibleToPatient) {
          <app-empty icon="scale" title="Tu nutrióloga aún no habilita esta sección" text="Podrá mostrarte tus mediciones cuando lo considere oportuno." />
        } @else if (weight().length) {
          <app-line-chart [series]="[{ label: 'Peso', points: weight() }]" unit="kg" title="Evolución de mi peso" />
          <p class="small muted">Última medición: {{ last()?.weightKg }} kg · IMC {{ last()?.bmi }}</p>
        } @else { <app-empty icon="scale" title="Aún no hay mediciones" /> }
      </section>
    </div>
  `,
})
export class PatientProgress {
  private readonly ctx = inject(PatientContext);
  private readonly insights = inject(InsightsService);
  private readonly data = inject(DbService);
  protected readonly patient = this.ctx.patient;
  protected readonly comp = computed(() => (this.data.version(), this.ctx.compliance(addDays(this.ctx.today, -13), this.ctx.today)));
  protected readonly weekly = computed(() => {
    this.data.version();
    const id = this.patient()?.id;
    if (!id) return [];
    return this.insights.weeklyCompliance(id, 4).map((w) => ({ label: shortDate(w.label), a: w.result.planned, b: w.result.done }));
  });
  protected readonly weight = computed(() => (this.patient() ? this.insights.anthropometrics(this.patient()!).weight : []));
  protected readonly last = computed(() => this.patient()?.measurements.slice().sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0]);
  protected readonly start = startOfWeek;
}

@Component({
  selector: 'app-patient-documents',
  imports: [TuiButton, Icon, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <h1 style="font-size: 1.5rem">Mis archivos</h1>
      <p class="muted">Documentos que tu nutrióloga decidió compartir contigo.</p>
      <section class="panel panel--flush">
        <ul class="list-plain list-rows">
          @for (d of docs(); track d.id) {
            <li><app-icon name="file-text" /><div class="grow"><strong>{{ d.name }}</strong><p class="small muted">{{ cat[d.category] }} · {{ fd(d.documentDate) }} · {{ bytes(d.sizeBytes) }}</p></div>
              <button tuiButton type="button" size="s" appearance="secondary" [disabled]="!online()" (click)="download(d)"><app-icon name="download" [size]="16" /> Descargar</button></li>
          } @empty { <li><app-empty icon="file" title="Sin archivos compartidos" /></li> }
        </ul>
      </section>
      @if (!online()) { <p class="small muted" role="status">Las descargas requieren conexión.</p> }
    </div>
  `,
})
export class PatientDocuments {
  private readonly http = inject(HttpClient);
  private readonly ctx = inject(PatientContext);
  private readonly data = inject(DbService);
  protected readonly cat = DOC_CATEGORY_LABEL;
  protected readonly fd = formatDate;
  protected readonly bytes = formatBytes;
  protected readonly online = this.data.isOnline;
  protected readonly docs = computed(() => (this.ctx.patient()?.documents ?? []).filter((d) => d.visibleToPatient && !d.deletedAt && d.scanStatus === 'clean'));

  protected download(d: PatientDocument): void {
    if (d.url) {
      this.http.get(d.url, { responseType: 'blob' }).subscribe((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${d.name}.pdf`; a.click(); URL.revokeObjectURL(a.href); });
      return;
    }
    // Modo simulado: archivo de ejemplo.
    downloadBlob(`${d.name}.pdf`, `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF`, 'application/pdf');
  }
}

@Component({
  selector: 'app-patient-profile',
  imports: [TuiButton, Icon, Modal, ReactiveFormsModule, FieldError, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <h1 style="font-size: 1.5rem">Mi perfil</h1>
      @if (p(); as pt) {
        <section class="panel" aria-labelledby="h-d">
          <h2 id="h-d" class="panel-head" style="font-size: 1.0625rem">Mis datos</h2>
          <dl style="display: grid; grid-template-columns: auto 1fr; gap: .375rem var(--space-4); margin: 0"><dt class="muted">Nombre</dt><dd style="margin: 0">{{ pt.profile.firstName }} {{ pt.profile.lastName }}</dd><dt class="muted">Edad</dt><dd style="margin: 0">{{ age() === '—' ? '—' : age() + ' años' }}</dd><dt class="muted">Correo</dt><dd style="margin: 0">{{ pt.profile.email }}</dd><dt class="muted">Objetivo</dt><dd style="margin: 0">{{ goal[pt.goal] }}</dd></dl>
          <p class="small muted">Para corregir tus datos o ejercer tus derechos ARCO, contacta a tu nutrióloga{{ contact() ? ': ' + contact() : '' }}.</p>
        </section>
        <section class="panel" aria-labelledby="h-a">
          <h2 id="h-a" class="panel-head" style="font-size: 1.0625rem">Mis aceptaciones</h2>
          <ul class="list-plain">@for (a of accepted(); track a.id) { <li class="small"><app-icon name="check-circle" [size]="16" /> {{ a.title }} (v{{ a.version }}) · {{ fdt(a.at) }}</li> }</ul>
        </section>
        <section class="panel" aria-labelledby="h-s">
          <h2 id="h-s" class="panel-head" style="font-size: 1.0625rem">Sesiones</h2>
          <ul class="list-plain">@for (s of sessions(); track s.id) { <li class="small">{{ s.device }} · {{ s.browser }} @if (s.id === auth.currentSessionId()) { <strong>(este dispositivo)</strong> } <br /><span class="muted">Última actividad {{ fdt(s.lastSeenAt) }}</span></li> }</ul>
          <div class="row"><button tuiButton type="button" size="s" appearance="secondary" (click)="others()">Cerrar las demás sesiones</button></div>
        </section>
        <section class="panel" aria-labelledby="h-p">
          <h2 id="h-p" class="panel-head" style="font-size: 1.0625rem">Este dispositivo</h2>
          <p class="small muted">Al cerrar sesión se borra la información guardada para uso sin conexión.</p>
          <div class="row"><button tuiButton type="button" size="m" appearance="secondary-destructive" (click)="logout()"><app-icon name="log-out" [size]="18" /> Cerrar sesión</button></div>
        </section>
        <section class="panel" aria-labelledby="h-c">
          <h2 id="h-c" class="panel-head" style="font-size: 1.0625rem">Privacidad y cuenta</h2>
          <p class="small"><a routerLink="/privacidad">Aviso de privacidad</a> · <a routerLink="/terminos">Términos de uso</a></p>
          <p class="small muted">Si ya no quieres usar la plataforma, puedes dar de baja tu cuenta. Tu expediente clínico se conserva bloqueado el tiempo que exige la ley.</p>
          <div class="row"><button tuiButton type="button" size="m" appearance="secondary-destructive" (click)="openDelete()"><app-icon name="trash" [size]="18" /> Eliminar mi cuenta</button></div>
        </section>
        <app-modal [(open)]="deleting" title="Eliminar mi cuenta" size="narrow">
          <div class="callout callout--warn"><app-icon name="alert-circle" /><div class="callout-body">
            <p><strong>Esta acción cierra tu acceso de inmediato.</strong></p>
            <p class="small">No podrás volver a iniciar sesión ni ver tu plan. Tu expediente clínico no se borra: la NOM-004 obliga a conservarlo al menos cinco años, y queda desactivado. Si cambias de opinión, tu nutrióloga puede reactivar tu atención.</p>
          </div></div>
          @if (deleteError()) { <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body">{{ deleteError() }}</div></div> }
          <form id="delete-form" [formGroup]="deleteForm" (ngSubmit)="confirmDelete()" novalidate>
            <div class="field">
              <label for="del-pw">Escribe tu contraseña para confirmar</label>
              <input id="del-pw" class="input" type="password" formControlName="password" autocomplete="current-password" aria-describedby="del-pw-err" />
              <app-field-error id="del-pw-err" [control]="deleteForm.controls.password" />
            </div>
          </form>
          <ng-container modalFooter>
            <button tuiButton type="button" size="m" appearance="secondary" (click)="deleting.set(false)">Cancelar</button>
            <button tuiButton type="submit" form="delete-form" size="m" appearance="primary-destructive" [disabled]="deleteBusy()">{{ deleteBusy() ? 'Eliminando…' : 'Eliminar mi cuenta' }}</button>
          </ng-container>
        </app-modal>
      }
    </div>
  `,
})
export class PatientProfileView {
  protected readonly auth = inject(AuthService);
  private readonly ctx = inject(PatientContext);
  private readonly data = inject(DbService);
  private readonly patients = inject(PatientsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly p = this.ctx.patient;
  protected readonly goal = GOAL_LABEL;
  protected readonly fdt = formatDateTime;
  protected readonly brand = computed(() => this.data.db().settings.brand);
  protected readonly age = computed(() => {
    const a = this.p() ? ageFrom(this.p()!.profile.birthDate) : NaN;
    return Number.isFinite(a) ? String(a) : '—';
  });
  /** Teléfono y correo de la consulta; si no están configurados no se muestra una línea vacía ("· ."). */
  protected readonly contact = computed(() => [this.brand().phone, this.brand().email].filter((x) => x && x.trim()).join(' · '));
  protected readonly sessions = this.auth.mySessions;
  protected readonly accepted = computed(() => {
    const id = this.p()?.id;
    if (!id) return [];
    return this.patients.acceptancesOf(id).filter((a) => !a.revokedAt).map((a) => {
      const d = this.data.db().consentDocuments.find((x) => x.id === a.consentDocumentId);
      return { id: a.id, title: d?.title ?? 'Documento', version: d?.version ?? 0, at: a.acceptedAt };
    });
  });
  protected readonly signal_ = signal(0);

  private readonly fb = inject(FormBuilder);
  protected readonly deleting = signal(false);
  protected readonly deleteBusy = signal(false);
  protected readonly deleteError = signal('');
  protected readonly deleteForm = this.fb.nonNullable.group({ password: ['', Validators.required] });

  protected openDelete(): void { this.deleteForm.reset(); this.deleteError.set(''); this.deleting.set(true); }
  protected confirmDelete(): void {
    this.deleteForm.markAllAsTouched();
    if (this.deleteForm.invalid || this.deleteBusy()) return;
    this.deleteBusy.set(true);
    this.deleteError.set('');
    this.auth.deleteOwnAccount(this.deleteForm.controls.password.value).subscribe({
      next: () => { this.deleting.set(false); this.toast.ok('Tu cuenta se dio de baja.'); void this.router.navigate(['/ingresar']); },
      error: (e: unknown) => { this.deleteBusy.set(false); this.deleteError.set(e instanceof Error ? e.message : 'No se pudo dar de baja la cuenta.'); },
    });
  }

  protected others(): void { this.auth.revokeOtherSessions(); this.toast.ok('Se cerraron las demás sesiones.'); }
  protected logout(): void { this.auth.logout(); void this.router.navigate(['/ingresar']); }
}
