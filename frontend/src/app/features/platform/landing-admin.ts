import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TuiAppearance } from '@taiga-ui/core/directives/appearance';
import { TuiBadge } from '@taiga-ui/kit/components/badge';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiChevron } from '@taiga-ui/kit/directives/chevron';
import { TuiDataListWrapper } from '@taiga-ui/kit/components/data-list-wrapper';
import { TuiDialog } from '@taiga-ui/core/portals/dialog';
import { TuiInput } from '@taiga-ui/core/components/input';
import { TuiSelect } from '@taiga-ui/kit/components/select';
import { TuiSkeleton } from '@taiga-ui/kit/directives/skeleton';
import { TuiTabs } from '@taiga-ui/kit/components/tabs';
import { TuiTextarea } from '@taiga-ui/kit/components/textarea';
import { ApiError } from '../../core/api/api-client';
import { LandingState, LandingVersion, LandingVersionRow, PlatformApi } from '../../core/api/platform-api';
import { AuthService } from '../../core/auth/auth.service';
import { ICON_NAMES } from '../../shared/components/icon';
import { Icon } from '../../shared/components/icon';
import { BUNDLED_LANDING, LandingContent } from '../landing/landing.content';
import { normalizeLanding } from '../landing/landing-content.service';
import { PfHead } from './head';
import { fdt } from './labels';
import { LANDING_TYPES, ROUTE_DESTS, diffLanding, fieldKey, type Rec } from './landing-schema';

type Dialog = '' | 'request' | 'approve' | 'reject';

/**
 * Administración de la landing (docs/interno/crm-landing.md): editar el borrador por tipo de sección, pedir su publicación y que
 * OTRA persona la apruebe, con historial y vista previa. El servidor valida todo; aquí solo se marca dónde está cada problema.
 */
@Component({
  selector: 'app-platform-landing',
  imports: [NgTemplateOutlet, FormsModule, RouterLink, TuiAppearance, TuiBadge, TuiButton, TuiChevron, TuiDataListWrapper, TuiDialog, TuiInput, TuiSelect, TuiSkeleton, TuiTabs, TuiTextarea, Icon, PfHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './landing-admin.scss',
  template: `
    <app-pf-head title="Landing" sub="El texto de la página pública. Nada se publica sin que otra persona lo apruebe." />

    <tui-tabs class="pf-tabs" [activeItemIndex]="tab()" (activeItemIndexChange)="setTab($event)">
      <button tuiTab type="button">Contenido</button>
      <button tuiTab type="button">Historial</button>
    </tui-tabs>

    @if (error()) { <div class="callout callout--crit" role="alert"><app-icon name="alert-circle" /><div class="callout-body"><strong>{{ error() }}</strong></div></div> }
    @if (notice()) { <div class="callout callout--ok" role="status"><app-icon name="check-circle" /><div class="callout-body"><strong>{{ notice() }}</strong></div></div> }

    @if (tab() === 0) {
      @if (loading()) {
        <p [tuiSkeleton]="true">Cargando el contenido de la landing…</p>
      } @else {
        <!-- Estado -->
        <section class="pf-sec ld-status" aria-label="Estado de la publicación">
          <div class="ld-row">
            <div>
              <h2>Publicada</h2>
              @if (state().published; as p) {
                <p>Versión {{ p.number }} · {{ fdt(p.published_at) }}<br /><span class="pf-muted">{{ p.requested_by ? 'La pidió ' + p.requested_by : '' }}{{ p.decided_by ? ' · la aprobó ' + p.decided_by : '' }}</span></p>
              } @else { <p class="pf-muted">Todavía no hay nada publicado desde el CRM: la página usa su texto original.</p> }
            </div>
            <div>
              <h2>Borrador</h2>
              @if (draft(); as d) {
                @if (d.status === 'pending') {
                  <p><span tuiBadge tuiAppearance="warning" size="m">Pendiente de aprobación</span><br /><span class="pf-muted">La pidió {{ d.requested_by }} · «{{ d.reason }}»</span></p>
                } @else {
                  <p><span tuiBadge [tuiAppearance]="dirty() ? 'warning' : 'neutral'" size="m">{{ dirty() ? 'Con cambios sin guardar' : 'Guardado' }}</span>
                    @if (d.decision_note) { <br /><span class="pf-error">La rechazó {{ d.decided_by }}: «{{ d.decision_note }}»</span> }
                  </p>
                }
              } @else if (editing()) { <p><span tuiBadge tuiAppearance="warning" size="m">Sin guardar</span></p> }
              @else { <p class="pf-muted">No hay borrador.</p> }
            </div>
          </div>

          <div class="pf-actions">
            @if (!draft() && !editing() && canEdit) { <button tuiButton appearance="primary" size="s" type="button" (click)="startDraft()">Crear borrador</button> }
            @if (editing() && !locked()) {
              <button tuiButton appearance="primary" size="s" type="button" [disabled]="busy() || !dirty()" (click)="save()">Guardar borrador</button>
              <button tuiButton appearance="secondary" size="s" type="button" [disabled]="busy() || dirty() || !draft()" (click)="openDialog('request')">Pedir publicación…</button>
            }
            @if (draft() && !dirty()) { <a tuiButton appearance="flat" size="s" routerLink="/vista-previa-landing" target="_blank">Vista previa</a> }
            @if (locked() && canEdit && mine()) { <button tuiButton appearance="secondary" size="s" type="button" [disabled]="busy()" (click)="withdraw()">Retirar mi solicitud</button> }
            @if (locked() && canPublish) {
              @if (mine()) { <span class="pf-muted">Otra persona debe aprobarla: quien la pidió no puede publicarla.</span> }
              @else {
                <button tuiButton appearance="primary" size="s" type="button" (click)="openDialog('approve')">Aprobar y publicar…</button>
                <button tuiButton appearance="secondary" size="s" type="button" (click)="openDialog('reject')">Rechazar…</button>
              }
            }
          </div>
          @if (editing() && dirty() && draft()) { <p class="pf-hint">Guarda el borrador para poder pedir su publicación o verlo en la vista previa.</p> }
        </section>

        <!-- Qué cambiaría (revisión) -->
        @if (locked() && changes().length) {
          <section class="pf-sec" aria-labelledby="h-cambios">
            <h2 id="h-cambios">Qué cambia respecto a lo publicado <small>{{ changes().length }}</small></h2>
            <ul class="ld-diff">
              @for (c of changes(); track $index) {
                <li><strong>{{ c.where }}</strong>
                  @if (c.before) { <del>{{ c.before }}</del> }
                  @if (c.after) { <ins>{{ c.after }}</ins> } @else { <span class="pf-muted">(se quita)</span> }
                </li>
              }
            </ul>
          </section>
        }

        @if (errorList().length) {
          <div class="callout callout--crit" role="alert">
            <app-icon name="alert-circle" />
            <div class="callout-body"><strong>El contenido tiene {{ errorList().length }} problema(s). Están marcados abajo.</strong></div>
          </div>
        }

        <!-- Editor -->
        @if (editing() || locked()) {
          <fieldset class="ld-editor" [disabled]="locked()">
            <section class="pf-sec" aria-labelledby="h-meta">
              <h2 id="h-meta">Datos de la página</h2>
              <ng-container *ngTemplateOutlet="field; context: { o: doc().meta, f: metaTitle, p: 'meta.title' }" />
              <ng-container *ngTemplateOutlet="field; context: { o: doc().meta, f: metaDesc, p: 'meta.description' }" />
            </section>

            <section class="pf-sec" aria-labelledby="h-secs">
              <h2 id="h-secs">Secciones <small>en el orden de la página</small></h2>
              @for (s of rows(); track s.id; let i = $index) {
                <article class="ld-sec" [class.open]="openIdx() === i" [class.off]="s.enabled === false">
                  <header>
                    <button type="button" class="ld-toggle" [attr.aria-expanded]="openIdx() === i" (click)="openIdx.set(openIdx() === i ? -1 : i)">
                      <app-icon [name]="openIdx() === i ? 'chevron-down' : 'chevron-right'" [size]="16" />
                      <strong>{{ types[s.type]?.label ?? s.type }}</strong> <span class="pf-muted">#{{ s.id }}</span>
                    </button>
                    @if (sectionErrors(i); as n) { <span tuiBadge tuiAppearance="negative" size="s">{{ n }} problema(s)</span> }
                    @if (s.enabled === false) { <span tuiBadge tuiAppearance="neutral" size="s">Oculta</span> }
                    <span class="grow"></span>
                    @if (!locked()) {
                      <button tuiButton appearance="flat" size="xs" type="button" [disabled]="i <= 1" (click)="move(i, -1)" [attr.aria-label]="'Subir ' + s.id"><app-icon name="chevron-up" [size]="16" /></button>
                      <button tuiButton appearance="flat" size="xs" type="button" [disabled]="s.type === 'hero' || i === rows().length - 1" (click)="move(i, 1)" [attr.aria-label]="'Bajar ' + s.id"><app-icon name="chevron-down" [size]="16" /></button>
                    }
                  </header>
                  @if (openIdx() === i) {
                    <div class="ld-body">
                      <div class="ld-two">
                        <ng-container *ngTemplateOutlet="field; context: { o: s, f: idField, p: 'sections[' + i + '].id' }" />
                        <ng-container *ngTemplateOutlet="field; context: { o: s, f: navField, p: 'sections[' + i + '].nav' }" />
                      </div>
                      @if (s.type !== 'hero') {
                        <label class="ld-check"><input type="checkbox" [checked]="s.enabled !== false" [disabled]="locked()" (change)="setEnabled(s, $any($event.target).checked)" /> Visible en la página</label>
                      }
                      @for (f of types[s.type].fields; track f.key) {
                        <ng-container *ngTemplateOutlet="field; context: { o: s, f: f, p: 'sections[' + i + '].' + f.key }" />
                      }
                      @if (types[s.type].object; as ob) {
                        <h3>{{ ob.label }}</h3>
                        @for (f of ob.fields; track f.key) {
                          <ng-container *ngTemplateOutlet="field; context: { o: s[ob.key], f: f, p: 'sections[' + i + '].' + ob.key + '.' + f.key }" />
                        }
                      }
                      @for (l of types[s.type].lists; track l.key) {
                        <h3>{{ l.label }} <small class="pf-muted">{{ (s[l.key] ?? []).length }} / {{ l.max }}</small></h3>
                        @for (it of s[l.key] ?? []; track $index; let j = $index) {
                          <div class="ld-item">
                            @if (l.strings) {
                              <ng-container *ngTemplateOutlet="strField; context: { arr: s[l.key], j: j, label: l.noun, p: 'sections[' + i + '].' + l.key + '[' + j + ']' }" />
                            } @else {
                              @for (f of l.fields; track f.key) {
                                <ng-container *ngTemplateOutlet="field; context: { o: it, f: f, p: 'sections[' + i + '].' + l.key + '[' + j + '].' + f.key }" />
                              }
                            }
                            @if (!locked()) { <button tuiButton appearance="flat" size="xs" type="button" class="ld-del" (click)="removeItem(s, l.key, j)" [attr.aria-label]="'Quitar ' + l.noun + ' ' + (j + 1)">Quitar</button> }
                          </div>
                        }
                        @if (!locked() && (s[l.key] ?? []).length < l.max) { <button tuiButton appearance="secondary" size="xs" type="button" (click)="addItem(s, l)">Agregar {{ l.noun }}</button> }
                      }
                      @if (!locked() && s.type !== 'hero') { <p><button tuiButton appearance="secondary-destructive" size="xs" type="button" (click)="removeSection(i)">Quitar esta sección</button></p> }
                    </div>
                  }
                </article>
              }
              @if (!locked()) {
                <div class="ld-add">
                  <tui-textfield tuiChevron [tuiTextfieldCleaner]="false" class="ld-addsel">
                    <label tuiLabel for="ld-newtype">Agregar una sección</label>
                    <input id="ld-newtype" tuiSelect name="nuevo" [(ngModel)]="newType" />
                    <tui-data-list-wrapper *tuiDropdown new [items]="addableLabels" />
                  </tui-textfield>
                  <button tuiButton appearance="secondary" size="s" type="button" (click)="addSection()">Agregar</button>
                </div>
              }
            </section>

            <section class="pf-sec" aria-labelledby="h-foot">
              <h2 id="h-foot">Pie de página</h2>
              <ng-container *ngTemplateOutlet="field; context: { o: doc().footer, f: legalField, p: 'footer.legal' }" />
              @for (l of doc().footer.links; track $index; let j = $index) {
                <div class="ld-item ld-two">
                  <ng-container *ngTemplateOutlet="field; context: { o: l, f: linkLabel, p: 'footer.links[' + j + '].label' }" />
                  <ng-container *ngTemplateOutlet="field; context: { o: l, f: linkTo, p: 'footer.links[' + j + '].to' }" />
                  @if (!locked()) { <button tuiButton appearance="flat" size="xs" type="button" class="ld-del" (click)="removeLink(j)">Quitar</button> }
                </div>
              }
              @if (!locked() && doc().footer.links.length < 8) { <button tuiButton appearance="secondary" size="xs" type="button" (click)="addLink()">Agregar enlace</button> }
            </section>
          </fieldset>
        }
      }
    } @else {
      <div class="pf-table-wrap">
        <table class="pf-table pf-table--cards">
          <caption class="pf-sr">Versiones publicadas de la landing</caption>
          <thead><tr><th scope="col">Versión</th><th scope="col">Publicada</th><th scope="col">Quién</th><th scope="col">Motivo</th><th scope="col"><span class="pf-sr">Acciones</span></th></tr></thead>
          <tbody>
            @for (v of versions(); track v.number) {
              <tr>
                <td class="main"><strong>Versión {{ v.number }}</strong> @if (v.status === 'published') { <span tuiBadge tuiAppearance="positive" size="s">Vigente</span> }</td>
                <td data-label="Publicada" class="pf-muted">{{ fdt(v.published_at) }}</td>
                <td data-label="Quién" class="pf-muted">{{ v.requested_by || '—' }}{{ v.decided_by ? ' → ' + v.decided_by : '' }}</td>
                <td data-label="Motivo">{{ v.reason || '—' }}</td>
                <td class="go-acts"><div class="acts">@if (canEdit && v.status !== 'published') { <button tuiButton appearance="secondary" size="xs" type="button" [disabled]="busy() || locked()" (click)="restore(v.number)">Restaurar como borrador</button> }</div></td>
              </tr>
            } @empty { <tr><td colspan="5" class="pf-empty" style="text-align:center">Todavía no hay versiones publicadas desde el CRM.</td></tr> }
          </tbody>
        </table>
      </div>
    }

    <!-- Campo de texto, área, ícono, destino o lista cerrada, con su error -->
    <ng-template #field let-o="o" let-f="f" let-p="p">
      <div class="ld-field" [class.bad]="err(p)">
        @switch (f.kind) {
          @case ('area') {
            <tui-textfield><label tuiLabel [attr.for]="'f-' + p">{{ f.label }}</label><textarea tuiTextarea [attr.id]="'f-' + p" [name]="p" rows="3" [(ngModel)]="o[f.key]" [disabled]="locked()"></textarea></tui-textfield>
          }
          @case ('icon') {
            <tui-textfield tuiChevron [tuiTextfieldCleaner]="false"><label tuiLabel [attr.for]="'f-' + p">{{ f.label }}</label><input tuiSelect [attr.id]="'f-' + p" [name]="p" [(ngModel)]="o[f.key]" [disabled]="locked()" /><tui-data-list-wrapper *tuiDropdown new [items]="iconNames" /></tui-textfield>
          }
          @case ('dest') {
            <tui-textfield tuiChevron [tuiTextfieldCleaner]="false"><label tuiLabel [attr.for]="'f-' + p">{{ f.label }}</label><input tuiSelect [attr.id]="'f-' + p" [name]="p" [(ngModel)]="o[f.key]" [disabled]="locked()" /><tui-data-list-wrapper *tuiDropdown new [items]="destOptions()" /></tui-textfield>
          }
          @case ('select') {
            <tui-textfield tuiChevron [tuiTextfieldCleaner]="false"><label tuiLabel [attr.for]="'f-' + p">{{ f.label }}</label><input tuiSelect [attr.id]="'f-' + p" [name]="p" [(ngModel)]="o[f.key]" [disabled]="locked()" /><tui-data-list-wrapper *tuiDropdown new [items]="f.options ?? []" /></tui-textfield>
          }
          @default {
            <tui-textfield><label tuiLabel [attr.for]="'f-' + p">{{ f.label }}</label><input tuiInput [attr.id]="'f-' + p" [name]="p" autocomplete="off" [(ngModel)]="o[f.key]" [disabled]="locked()" /></tui-textfield>
          }
        }
        @if (err(p); as m) { <p class="pf-error" role="alert">{{ m }}</p> }
      </div>
    </ng-template>

    <ng-template #strField let-arr="arr" let-j="j" let-label="label" let-p="p">
      <div class="ld-field" [class.bad]="err(p)">
        <tui-textfield><label tuiLabel [attr.for]="'f-' + p">{{ label }} {{ j + 1 }}</label><input tuiInput [attr.id]="'f-' + p" [name]="p" autocomplete="off" [(ngModel)]="arr[j]" [disabled]="locked()" /></tui-textfield>
        @if (err(p); as m) { <p class="pf-error" role="alert">{{ m }}</p> }
      </div>
    </ng-template>

    <ng-template [tuiDialog]="dialog() !== ''" [tuiDialogOptions]="{ label: dialogLabel(), size: 's', dismissible: !busy() }" (tuiDialogChange)="$event || closeDialog()">
      <form class="pf-form" (ngSubmit)="submitDialog()">
        @if (dialog() === 'request') {
          <p class="pf-hint">Otra persona con permiso de publicar tendrá que aprobarla. Al aprobarse, la página pública cambia al instante.</p>
          <tui-textfield><label tuiLabel for="ld-reason">Motivo (mínimo 10 caracteres)</label><textarea id="ld-reason" tuiTextarea name="motivo" rows="3" [(ngModel)]="reason"></textarea></tui-textfield>
        } @else {
          <p class="pf-hint">{{ dialog() === 'approve' ? 'Se publica al instante y queda la versión en el historial.' : 'El texto vuelve a ser un borrador con tu nota.' }}</p>
          <tui-textfield><label tuiLabel for="ld-note">Nota (opcional)</label><textarea id="ld-note" tuiTextarea name="nota" rows="2" [(ngModel)]="reason"></textarea></tui-textfield>
        }
        @if (formError()) { <p class="pf-error" role="alert">{{ formError() }}</p> }
        <div class="pf-actions">
          <button tuiButton type="submit" [appearance]="dialog() === 'reject' ? 'primary-destructive' : 'primary'" size="m" [disabled]="busy()">{{ dialogLabel() }}</button>
          <button tuiButton type="button" appearance="secondary" size="m" (click)="closeDialog()" [disabled]="busy()">Cancelar</button>
        </div>
      </form>
    </ng-template>
  `,
})
export class PlatformLanding {
  private readonly api = inject(PlatformApi);
  private readonly auth = inject(AuthService);
  protected readonly canEdit = this.auth.can('platform:landing:edit');
  protected readonly canPublish = this.auth.can('platform:landing:publish');

  protected readonly tab = signal(0);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly state = signal<LandingState>({ published: null, draft: null });
  protected readonly versions = signal<LandingVersionRow[]>([]);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly editing = signal(false);
  protected readonly openIdx = signal(0);
  protected readonly dialog = signal<Dialog>('');
  protected readonly formError = signal('');
  protected reason = '';
  protected newType = Object.values(LANDING_TYPES).find((t) => t.addable)!.label;

  /** Copia de trabajo que se edita (mutable: los campos escriben directo) y su instantánea guardada. */
  protected readonly doc = signal<LandingContent>(structuredClone(BUNDLED_LANDING));
  private snapshot = '';
  private readonly rev = signal(0);

  protected readonly types = LANDING_TYPES;
  protected readonly iconNames = ICON_NAMES;
  protected readonly fdt = fdt;
  protected readonly metaTitle = fieldKey('title', 'Título de la página', 'text');
  protected readonly metaDesc = fieldKey('description', 'Descripción (la ven los buscadores)', 'area');
  protected readonly idField = fieldKey('id', 'Ancla (id)', 'text');
  protected readonly navField = fieldKey('nav', 'Texto en el menú (vacío = no aparece)', 'text');
  protected readonly legalField = fieldKey('legal', 'Aviso del pie', 'area');
  protected readonly linkLabel = fieldKey('label', 'Texto del enlace', 'text');
  protected readonly linkTo = fieldKey('to', 'Destino', 'dest');

  protected readonly draft = computed(() => this.state().draft);
  protected readonly locked = computed(() => this.draft()?.status === 'pending');
  protected readonly mine = computed(() => !!this.draft()?.requested_by && this.draft()?.requested_by?.toLowerCase() === (this.auth.user()?.email ?? '').toLowerCase());
  protected readonly rows = computed(() => { this.rev(); return this.doc().sections as Rec[]; });
  protected readonly errorList = computed(() => Object.keys(this.errors()));
  protected readonly addableLabels = Object.values(LANDING_TYPES).filter((t) => t.addable).map((t) => t.label);
  protected readonly changes = computed(() => this.locked() && this.state().draft ? diffLanding(this.state().published?.content ?? BUNDLED_LANDING, this.state().draft!.content) : []);
  protected readonly destOptions = computed(() => { this.rev(); return [...(this.doc().sections as Rec[]).filter((s) => s['enabled'] !== false).map((s) => `#${s['id']}`), ...ROUTE_DESTS]; });
  protected readonly dialogLabel = computed(() => ({ request: 'Pedir publicación', approve: 'Aprobar y publicar', reject: 'Rechazar', '': '' })[this.dialog()]);

  constructor() { this.load(); }

  protected dirty(): boolean { return this.editing() && !this.locked() && JSON.stringify(this.doc()) !== this.snapshot; }
  protected err(path: string): string { return this.errors()[path] ?? ''; }
  protected sectionErrors(i: number): number { const p = `sections[${i}].`; return this.errorList().filter((k) => k.startsWith(p)).length; }
  private bump(): void { this.rev.update((n) => n + 1); }

  private adopt(s: LandingState): void {
    this.state.set(s);
    if (s.draft) {
      this.doc.set(structuredClone(normalizeLanding(s.draft.content)));
      this.snapshot = JSON.stringify(this.doc());
      this.editing.set(true);
    } else {
      this.editing.set(false);
    }
    this.errors.set({});
    this.bump();
  }

  protected load(): void {
    this.loading.set(true); this.error.set('');
    this.api.landing().subscribe({
      next: (s) => { this.adopt(s); this.loading.set(false); },
      error: (e: Error) => { this.error.set(e.message); this.loading.set(false); },
    });
  }

  protected setTab(i: number): void { this.tab.set(i); if (i === 1) this.loadVersions(); }

  protected loadVersions(): void {
    this.api.landingVersions().subscribe({ next: (r) => this.versions.set(r.items), error: (e: Error) => this.error.set(e.message) });
  }

  protected startDraft(): void {
    this.doc.set(structuredClone(normalizeLanding(this.state().published?.content ?? BUNDLED_LANDING)));
    this.snapshot = '';
    this.editing.set(true); this.openIdx.set(0); this.notice.set(''); this.bump();
  }

  private fail(e: unknown): void {
    this.busy.set(false);
    if (e instanceof ApiError && e.code === 'invalid_content') { this.errors.set(e.fields); this.error.set(e.message); }
    else this.error.set(e instanceof Error ? e.message : 'No se pudo completar.');
  }

  protected save(after?: () => void): void {
    this.busy.set(true); this.error.set(''); this.notice.set(''); this.errors.set({});
    this.api.landingSaveDraft(this.doc()).subscribe({
      next: (d: LandingVersion) => {
        this.busy.set(false);
        this.state.update((s) => ({ ...s, draft: d }));
        this.snapshot = JSON.stringify(this.doc());
        this.notice.set('Borrador guardado.');
        after?.();
      },
      error: (e) => this.fail(e),
    });
  }

  protected openDialog(d: Dialog): void { this.reason = ''; this.formError.set(''); this.notice.set(''); this.dialog.set(d); }
  protected closeDialog(): void { if (!this.busy()) this.dialog.set(''); }

  protected submitDialog(): void {
    this.busy.set(true); this.formError.set('');
    const d = this.dialog();
    if (d === 'request') {
      this.api.landingRequest(this.reason).subscribe({
        next: () => { this.busy.set(false); this.dialog.set(''); this.notice.set('Publicación pedida: otra persona debe aprobarla.'); this.load(); },
        error: (e: Error) => { this.busy.set(false); this.formError.set(e.message); },
      });
      return;
    }
    this.api.landingDecide(d === 'approve', this.reason).subscribe({
      next: (s) => { this.busy.set(false); this.dialog.set(''); this.adopt(s); this.notice.set(d === 'approve' ? 'Publicada: la página ya muestra este texto.' : 'Rechazada: el texto volvió a borrador.'); },
      error: (e: Error) => { this.busy.set(false); this.formError.set(e.message); },
    });
  }

  protected withdraw(): void {
    this.busy.set(true); this.error.set('');
    this.api.landingWithdraw().subscribe({ next: () => { this.busy.set(false); this.notice.set('Solicitud retirada: vuelve a ser un borrador.'); this.load(); }, error: (e) => this.fail(e) });
  }

  protected restore(n: number): void {
    this.busy.set(true); this.error.set('');
    this.api.landingRestore(n).subscribe({
      next: () => { this.busy.set(false); this.tab.set(0); this.notice.set(`Versión ${n} restaurada como borrador. Revísala y pide su publicación.`); this.load(); },
      error: (e) => this.fail(e),
    });
  }

  // ---- Edición de la estructura ----
  protected move(i: number, dir: -1 | 1): void {
    const a = this.doc().sections as Rec[];
    const j = i + dir;
    if (j < 1 || j >= a.length || i < 1) return; // el hero siempre es el primero
    [a[i], a[j]] = [a[j], a[i]];
    this.openIdx.set(j); this.errors.set({}); this.bump();
  }
  protected setEnabled(s: Rec, on: boolean): void { s['enabled'] = on ? undefined : false; this.bump(); }
  protected removeSection(i: number): void { (this.doc().sections as Rec[]).splice(i, 1); this.openIdx.set(-1); this.errors.set({}); this.bump(); }
  protected addSection(): void {
    const t = Object.entries(LANDING_TYPES).find(([, d]) => d.label === this.newType);
    if (!t) return;
    const secs = this.doc().sections as Rec[];
    let id = t[0], n = 2;
    while (secs.some((s) => s['id'] === id)) id = `${t[0]}-${n++}`;
    secs.push({ ...t[1].make(), type: t[0], id });
    this.openIdx.set(secs.length - 1); this.errors.set({}); this.bump();
  }
  protected addItem(s: Rec, l: { key: string; strings?: boolean; blank: () => unknown }): void { (s[l.key] ??= []).push(l.blank()); this.bump(); }
  protected removeItem(s: Rec, key: string, j: number): void { s[key].splice(j, 1); this.errors.set({}); this.bump(); }
  protected addLink(): void { this.doc().footer.links.push({ label: 'Enlace', to: '/ingresar' }); this.bump(); }
  protected removeLink(j: number): void { this.doc().footer.links.splice(j, 1); this.errors.set({}); this.bump(); }
}
