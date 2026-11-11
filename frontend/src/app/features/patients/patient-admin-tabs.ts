import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { PatientsService } from '../../core/services/patients.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { DOC_CATEGORY_LABEL, DocumentCategory, Patient, PatientDocument } from '../../shared/models/domain';
import { FieldError } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { Badge, EmptyState } from '../../shared/components/ui';
import { downloadBlob, formatBytes, formatDate, formatDateTime, todayIso } from '../../shared/utils/format';

// ---------- Notas privadas (§3.2) ----------
@Component({
  selector: 'app-notes-tab',
  imports: [ReactiveFormsModule, TuiButton, Icon, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <div class="callout callout--ok"><app-icon name="lock" /><div class="callout-body"><p><strong>Notas privadas.</strong> Solo tú puedes verlas; nunca se muestran al paciente ni se incluyen en sus reportes.</p></div></div>
      <section class="panel" aria-labelledby="h-nota">
        <h2 id="h-nota" class="visually-hidden">Nueva nota</h2>
        <div class="field"><label for="nota">Nueva nota de evolución u observación</label><textarea id="nota" class="textarea" [formControl]="body" maxlength="2000"></textarea></div>
        <div class="form-actions"><button tuiButton type="button" size="m" [disabled]="!body.value.trim()" (click)="add()">Guardar nota</button></div>
      </section>
      <section class="panel panel--flush" aria-label="Notas guardadas">
        <ul class="list-plain list-rows">
          @for (n of notes(); track n.id) {
            <li><div class="grow"><p>{{ n.body }}</p><p class="small muted">{{ n.authorName }} · {{ fdt(n.createdAt) }}</p></div>
              <button type="button" class="icon-btn icon-btn--s" aria-label="Eliminar nota" (click)="remove(n.id)"><app-icon name="trash" [size]="18" /></button></li>
          } @empty { <li><app-empty icon="file-text" title="Sin notas" text="Las notas que escribas aparecerán aquí." /></li> }
        </ul>
      </section>
    </div>
  `,
})
export class NotesTab {
  private readonly patients = inject(PatientsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  readonly patient = input.required<Patient>();
  protected readonly body = inject(FormBuilder).nonNullable.control('');
  protected readonly fdt = formatDateTime;
  protected readonly notes = computed(() => this.patient().notes.filter((n) => !n.deletedAt));

  protected add(): void {
    this.patients.addNote(this.patient().id, this.body.value);
    this.body.reset('');
    this.toast.ok('Nota guardada.');
  }

  protected async remove(id: string): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Eliminar nota', message: 'La nota dejará de mostrarse. Se conserva en auditoría.', confirmLabel: 'Eliminar', tone: 'danger' });
    if (ok) this.patients.deleteNote(this.patient().id, id);
  }
}

// ---------- Documentos clínicos PDF (§3.3, §18.4) ----------
function placeholderPdf(title: string): string {
  const text = `(${title.replace(/[()\\]/g, '')} - documento de ejemplo) Tj`;
  const stream = `BT /F1 16 Tf 72 760 Td ${text} ET`;
  return `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF`;
}

@Component({
  selector: 'app-documents-tab',
  imports: [ReactiveFormsModule, TuiButton, Icon, Modal, FieldError, Badge, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <section class="panel" aria-labelledby="h-doc">
        <div class="panel-head"><h2 id="h-doc">Documentos clínicos</h2><button tuiButton type="button" size="s" (click)="openUpload()"><app-icon name="upload" [size]="16" /> Subir PDF</button></div>
        <div>
          <div class="meter" role="img" [attr.aria-label]="quota().pct + '% de la cuota usada'"><span [style.inline-size.%]="quota().pct"></span></div>
          <p class="small muted" style="margin-block-start: .25rem">{{ bytes(quota().used) }} de {{ bytes(quota().quota) }} · Límite por PDF: {{ bytes(maxPdf()) }}</p>
        </div>
      </section>
      <section class="panel panel--flush" aria-label="Lista de documentos">
        @if (docs().length) {
          <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Documento</th><th scope="col">Categoría</th><th scope="col">Fecha</th><th scope="col">Paciente</th><th scope="col">Cargado por</th><th scope="col"><span class="visually-hidden">Acciones</span></th></tr></thead><tbody>
            @for (d of docs(); track d.id) {
              <tr>
                <td><strong>{{ d.name }}</strong><div class="small muted">{{ d.description }} · {{ bytes(d.sizeBytes) }}</div></td>
                <td>{{ cat[d.category] }}</td><td>{{ fd(d.documentDate) }}</td>
                <td>@if (d.visibleToPatient) { <app-badge tone="info" icon="eye">Visible</app-badge> } @else { <app-badge icon="eye-off">Solo tú</app-badge> }</td>
                <td class="small">{{ d.uploadedBy }}<div class="muted">{{ fdt(d.uploadedAt) }}</div></td>
                <td>
                  @if (d.scanStatus === 'scanning') { <app-badge tone="warn" icon="shield">Analizando…</app-badge> }
                  @else {
                    <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Vista previa de ' + d.name" (click)="open(d)"><app-icon name="eye" [size]="18" /></button>
                    <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Descargar ' + d.name" (click)="download(d)"><app-icon name="download" [size]="18" /></button>
                    <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="(d.visibleToPatient ? 'Ocultar al paciente ' : 'Compartir con el paciente ') + d.name" (click)="toggleVisible(d)"><app-icon [name]="d.visibleToPatient ? 'eye-off' : 'user'" [size]="18" /></button>
                    <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Eliminar ' + d.name" (click)="remove(d)"><app-icon name="trash" [size]="18" /></button>
                  }
                </td>
              </tr>
            }
          </tbody></table></div>
        } @else { <app-empty icon="file" title="Sin documentos" text="Sube estudios, laboratorios o recetas en PDF. Se almacenan de forma privada." /> }
      </section>
    </div>

    <app-modal [(open)]="uploading" title="Subir documento PDF">
      <form [formGroup]="form" id="doc-form" (ngSubmit)="upload()" class="stack" novalidate>
        <div class="field"><label for="d-file">Archivo PDF</label><input id="d-file" class="input" type="file" accept="application/pdf,.pdf" (change)="onFile($event)" aria-describedby="d-file-h d-file-e" /><span class="hint" id="d-file-h">Máximo {{ bytes(maxPdf()) }}. Se valida el tipo real y se analiza antes de habilitar la descarga.</span>@if (fileError()) { <p class="error" id="d-file-e" role="alert">{{ fileError() }}</p> }</div>
        <div class="form-grid">
          <div class="field"><label for="d-name">Nombre</label><input id="d-name" class="input" formControlName="name" /><app-field-error [control]="form.controls.name" /></div>
          <div class="field"><label for="d-cat">Categoría</label><select id="d-cat" class="select" formControlName="category">@for (c of categories; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select></div>
          <div class="field"><label for="d-date">Fecha del documento</label><input id="d-date" class="input" type="date" formControlName="documentDate" /></div>
        </div>
        <div class="field"><label for="d-desc">Descripción</label><input id="d-desc" class="input" formControlName="description" /></div>
        <label class="check"><input type="checkbox" formControlName="visibleToPatient" /> <span>Permitir que el paciente lo consulte</span></label>
      </form>
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="uploading.set(false)">Cancelar</button><button tuiButton type="submit" form="doc-form" size="m" [disabled]="!file()">Subir documento</button></ng-container>
    </app-modal>

    <app-modal [open]="!!preview()" (closed)="preview.set(null)" [title]="preview()?.name ?? 'Vista previa'" size="wide">
      @if (preview(); as d) {
        <div class="callout"><app-icon name="info" /><div class="callout-body">Vista previa simulada. Con el backend real se muestra mediante una URL firmada de corta duración.</div></div>
        <div class="panel" style="min-block-size: 18rem; place-items: center; text-align: center"><app-icon name="file-text" [size]="48" /><h3>{{ d.name }}</h3><p class="muted">{{ cat[d.category] }} · {{ fd(d.documentDate) }} · {{ bytes(d.sizeBytes) }}</p><p>{{ d.description }}</p></div>
      }
    </app-modal>
  `,
})
export class DocumentsTab {
  private readonly http = inject(HttpClient);
  private readonly patients = inject(PatientsService);
  private readonly data = inject(DbService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  readonly patient = input.required<Patient>();
  protected readonly apiMode = inject(PatientsService).apiMode;

  protected readonly cat = DOC_CATEGORY_LABEL;
  protected readonly categories = Object.entries(DOC_CATEGORY_LABEL);
  protected readonly bytes = formatBytes;
  protected readonly fd = formatDate;
  protected readonly fdt = formatDateTime;
  protected readonly uploading = signal(false);
  protected readonly preview = signal<PatientDocument | null>(null);
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal('');
  protected readonly docs = computed(() => this.patient().documents.filter((d) => !d.deletedAt));
  protected readonly quota = computed(() => this.patients.quota(this.patient()));
  protected readonly maxPdf = computed(() => this.data.db().settings.storage.maxPdfBytes);
  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    category: ['laboratorio' as DocumentCategory],
    documentDate: [todayIso()],
    description: [''],
    visibleToPatient: [false],
  });

  protected openUpload(): void {
    this.file.set(null);
    this.fileError.set('');
    this.form.reset({ name: '', category: 'laboratorio', documentDate: todayIso(), description: '', visibleToPatient: false });
    this.uploading.set(true);
  }

  protected onFile(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    this.fileError.set('');
    this.file.set(null);
    if (!f) return;
    const err = this.patients.validateUpload(this.patient(), f);
    if (err) { this.fileError.set(err); return; }
    this.file.set(f);
    if (!this.form.controls.name.value) this.form.controls.name.setValue(f.name.replace(/\.pdf$/i, ''));
  }

  protected upload(): void {
    this.form.markAllAsTouched();
    const f = this.file();
    if (!f || this.form.invalid) return;
    this.patients.addDocument(this.patient(), f, this.form.getRawValue()).subscribe({
      next: () => { this.uploading.set(false); this.toast.ok(this.patients.apiMode ? 'Documento cargado y revisado.' : 'Documento cargado. Se está analizando antes de habilitar la descarga.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo completar la operación.'),
    });
  }

  protected download(d: PatientDocument): void {
    if (this.patients.apiMode && d.url) {
      this.http.get(d.url, { responseType: 'blob' }).subscribe({ next: (b) => saveBlob(b, `${d.name}.pdf`), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo completar la operación.') });
      return;
    }
    downloadBlob(`${d.name}.pdf`, placeholderPdf(d.name), 'application/pdf');
    this.patients.logExport(this.patient().id, `documento "${d.name}"`);
  }

  /** Modo API: vista previa real del PDF en una pestaña nueva (descarga autorizada con la sesión). */
  protected open(d: PatientDocument): void {
    if (this.patients.apiMode && d.url) {
      this.http.get(d.url, { responseType: 'blob' }).subscribe({ next: (b) => window.open(URL.createObjectURL(b), '_blank', 'noopener'), error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo completar la operación.') });
      return;
    }
    this.preview.set(d);
  }

  protected toggleVisible(d: PatientDocument): void {
    const was = d.visibleToPatient;
    this.patients.updateDocument(this.patient().id, d.id, { visibleToPatient: !was }).subscribe({
      next: () => this.toast.info(was ? 'El paciente ya no ve este documento.' : 'El paciente ahora puede consultar este documento.'),
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo completar la operación.'),
    });
  }

  protected async remove(d: PatientDocument): Promise<void> {
    const ok = await this.confirm.ask({ title: 'Eliminar documento', message: `"${d.name}" dejará de mostrarse. La eliminación es lógica y queda en auditoría.`, confirmLabel: 'Eliminar', tone: 'danger' });
    if (ok) this.patients.deleteDocument(this.patient().id, d.id).subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo completar la operación.') });
  }
}

// ---------- Consentimientos (§4.1) ----------
@Component({
  selector: 'app-consents-tab',
  imports: [TuiButton, Icon, Modal, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      @if (pending().length) {
        <div class="callout callout--warn"><app-icon name="lock" /><div class="callout-body">
          <p><strong>Faltan {{ pending().length }} aceptación(es).</strong> Mientras tanto el expediente clínico permanece restringido.</p>
          <p class="small">{{ patient().userId ? 'La persona puede aceptarlos al iniciar sesión.' : 'La persona aún no completa su invitación.' }} También puedes registrar una aceptación presencial.</p>
        </div></div>
      } @else { <div class="callout callout--ok"><app-icon name="check-circle" /><div class="callout-body">Consentimientos completos: el expediente clínico está habilitado.</div></div> }

      <section class="panel panel--flush" aria-labelledby="h-cons">
        <div class="panel-head"><h2 id="h-cons">Documentos vigentes</h2>@if (pending().length) { <button tuiButton type="button" size="s" (click)="open.set(true)">Registrar aceptación presencial</button> }</div>
        <ul class="list-plain list-rows">
          @for (c of docs(); track c.id) {
            <li>
              <div class="grow"><strong>{{ c.title }}</strong> <span class="muted small">versión {{ c.version }}</span></div>
              @if (acceptance(c.id); as a) {
                <app-badge tone="ok" icon="check">Aceptado {{ fd(a.acceptedAt) }} · {{ a.method === 'in_person' ? 'presencial' : 'en línea' }}</app-badge>
                <button tuiButton type="button" size="s" appearance="secondary-destructive" (click)="revoke(a.id)">Revocar</button>
              } @else { <app-badge tone="warn" icon="clock">Pendiente</app-badge> }
            </li>
          }
        </ul>
      </section>

      <section class="panel panel--flush" aria-labelledby="h-his">
        <div class="panel-head"><h2 id="h-his">Historial de aceptaciones</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Documento</th><th scope="col">Versión</th><th scope="col">Fecha y hora</th><th scope="col">Método</th><th scope="col">Evidencia</th><th scope="col">Estado</th></tr></thead><tbody>
          @for (a of history(); track a.id) {
            <tr><td>{{ a.title }}</td><td>v{{ a.version }}</td><td>{{ fdt(a.acceptedAt) }}</td><td>{{ a.method === 'in_person' ? 'Presencial' : 'En línea' }}</td><td class="small">{{ a.evidence }}</td><td>@if (a.revokedAt) { <app-badge tone="crit">Revocado {{ fd(a.revokedAt) }}</app-badge> } @else { <app-badge tone="ok">Vigente</app-badge> }</td></tr>
          } @empty { <tr><td colspan="6" class="muted">Sin aceptaciones registradas.</td></tr> }
        </tbody></table></div>
      </section>
      <p class="small muted">Los textos son marcadores; deben validarse con asesoría jurídica antes de producción (§4.1, §25.1).</p>
    </div>

    <app-modal [(open)]="open" title="Registrar aceptación presencial" size="narrow">
      <p>Confirma que la persona leyó y aceptó, en este momento, los siguientes documentos:</p>
      <ul>@for (c of pending(); track c.id) { <li>{{ c.title }} (v{{ c.version }})</li> }</ul>
      <p class="small muted">Se guardará la fecha, la versión y quién registró la aceptación.</p>
      <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="open.set(false)">Cancelar</button><button tuiButton type="button" size="m" (click)="record()">Confirmar aceptación</button></ng-container>
    </app-modal>
  `,
})
export class ConsentsTab {
  private readonly patients = inject(PatientsService);
  private readonly data = inject(DbService);
  private readonly toast = inject(ToastService);
  readonly patient = input.required<Patient>();
  protected readonly open = signal(false);
  protected readonly fd = formatDate;
  protected readonly fdt = formatDateTime;
  protected readonly docs = computed(() => (this.data.version(), this.patients.activeConsents()));
  protected readonly pending = computed(() => (this.data.version(), this.patients.pendingConsentDocs(this.patient().id)));
  protected readonly history = computed(() => {
    this.data.version();
    return this.patients.acceptancesOf(this.patient().id).map((a) => {
      const d = this.data.db().consentDocuments.find((x) => x.id === a.consentDocumentId);
      return { ...a, title: d?.title ?? 'Documento', version: d?.version ?? 0, evidence: a.method === 'in_person' ? `Registrado por ${a.evidence.recordedBy}` : 'Casilla de aceptación en línea' };
    }).sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));
  });

  protected acceptance(docId: string) {
    return this.patients.acceptancesOf(this.patient().id).find((a) => a.consentDocumentId === docId && !a.revokedAt);
  }

  protected record(): void {
    this.patients.recordInPersonConsent(this.patient().id, this.pending().map((p) => p.id));
    this.open.set(false);
    this.toast.ok('Aceptación registrada. El expediente clínico quedó habilitado.');
  }

  protected revoke(id: string): void {
    this.patients.revokeConsent(this.patient().id, id);
    this.toast.info('Consentimiento revocado. El expediente clínico vuelve a estar restringido.');
  }
}

function saveBlob(b: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
