import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { PatientsService } from '../../core/services/patients.service';
import { PlansService } from '../../core/services/plans.service';
import { TrackingService } from '../../core/services/tracking.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { latestMeasurement } from '../../core/nutrition/engine';
import { GOAL_LABEL, Goal, PATIENT_STATUS_LABEL, PLAN_STATUS_LABEL, SEX_LABEL, Sex } from '../../shared/models/domain';
import { AlertItem, Badge, EmptyState, PATIENT_TONE, PLAN_TONE } from '../../shared/components/ui';
import { FieldError, adultValidator } from '../../shared/components/forms';
import { Icon } from '../../shared/components/icon';
import { InviteLink } from '../../shared/components/invite-link';
import { Modal } from '../../shared/components/modal';
import { Ring } from '../../shared/components/charts';
import { ageFrom, formatBytes, formatDate, initials } from '../../shared/utils/format';
import { TrackingCard } from '../tracking/tracking-card';
import { ClinicalTab, MeasurementsTab, PreferencesTab } from './patient-clinical-tabs';
import { ConsentsTab, DocumentsTab, NotesTab } from './patient-admin-tabs';

type TabId = 'resumen' | 'antropometria' | 'clinico' | 'preferencias' | 'notas' | 'documentos' | 'consentimientos' | 'planes' | 'seguimiento';

const TABS: { id: TabId; label: string; clinical: boolean }[] = [
  { id: 'resumen', label: 'Resumen', clinical: false },
  { id: 'antropometria', label: 'Antropometría', clinical: true },
  { id: 'clinico', label: 'Clínico', clinical: true },
  { id: 'preferencias', label: 'Preferencias', clinical: true },
  { id: 'notas', label: 'Notas privadas', clinical: true },
  { id: 'documentos', label: 'Documentos', clinical: true },
  { id: 'consentimientos', label: 'Consentimientos', clinical: false },
  { id: 'planes', label: 'Planes', clinical: true },
  { id: 'seguimiento', label: 'Seguimiento', clinical: true },
];

@Component({
  selector: 'app-patient-detail',
  imports: [InviteLink, 
    RouterLink, ReactiveFormsModule, TuiButton, Icon, Badge, EmptyState, AlertItem, Modal, Ring, FieldError, TrackingCard,
    MeasurementsTab, ClinicalTab, PreferencesTab, NotesTab, DocumentsTab, ConsentsTab,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); }
    .head h1 { font-size: clamp(1.5rem, 3vw, 2rem); }
    dl { display: grid; grid-template-columns: minmax(7rem, auto) 1fr; gap: .5rem var(--space-4); margin: 0; }
    dt { color: var(--muted); font-size: .875rem; } dd { margin: 0; font-weight: 500; overflow-wrap: anywhere; }
    .cols { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); align-items: start; }
    .meas { display: grid; grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr)); gap: var(--space-3); }
    .meas div { padding: var(--space-3); border-radius: var(--radius-s); background: var(--nutri-marfil); } .meas b { display: block; font-size: 1.25rem; font-variant-numeric: tabular-nums; } .meas span { font-size: .8125rem; color: var(--muted); }
    .lock { text-align: center; }
  `,
  template: `
    @if (patient(); as p) {
      <div class="page">
        <nav class="breadcrumb" aria-label="Migas de pan"><a routerLink="/pacientes">Pacientes</a><app-icon name="chevron-right" [size]="14" /><span aria-current="page">{{ name() }}</span></nav>

        <header class="head">
          <span class="avatar avatar--l" aria-hidden="true">{{ ini() }}</span>
          <div class="grow">
            <h1>{{ name() }}</h1>
            <div class="row">
              <app-badge [tone]="tone[p.status]">{{ statusLabel[p.status] }}</app-badge>
              <span class="small muted">{{ age() }} años · {{ sexLabel[p.profile.sex] }} · {{ goalLabel[p.goal] }}</span>
              @if (!consentOk()) { <app-badge tone="warn" icon="lock">Expediente restringido</app-badge> }
            </div>
          </div>
          <div class="actions row">
            @if (!p.deletedAt) {
              <a tuiButton size="m" routerLink="/planes/nuevo" [queryParams]="{ paciente: p.id }" [attr.aria-disabled]="!consentOk()"><app-icon name="calendar" [size]="18" /> Nuevo plan</a>
              <button tuiButton type="button" size="m" appearance="secondary" (click)="openEdit()"><app-icon name="edit" [size]="18" /> Editar datos</button>
              @if (p.status === 'invited') { <button tuiButton type="button" size="m" appearance="secondary" (click)="resend()">Reenviar invitación</button> }
              <button tuiButton type="button" size="m" appearance="secondary-destructive" (click)="deactivate()">Desactivar</button>
            } @else {
              <button tuiButton type="button" size="m" (click)="restore()"><app-icon name="refresh" [size]="18" /> Restaurar paciente</button>
            }
          </div>
        </header>
        <app-invite-link [link]="shareLink()" [who]="name()" (closed)="shareLink.set(null)" />

        @if (p.deletedAt) { <div class="callout callout--warn" role="status"><app-icon name="ban" /><div class="callout-body">Paciente desactivado el {{ fd(p.deletedAt) }}. Su historial se conserva y no aparece en las consultas habituales.</div></div> }

        <div class="tabs" role="tablist" aria-label="Secciones del expediente" (keydown)="onTabKey($event)">
          @for (t of tabs; track t.id) {
            <button type="button" role="tab" [id]="'tab-' + t.id" [attr.aria-selected]="activeTab() === t.id" [attr.aria-controls]="'panel-' + t.id" [attr.tabindex]="activeTab() === t.id ? 0 : -1" (click)="go(t.id)">
              {{ t.label }}@if (t.clinical && !consentOk()) { <app-icon name="lock" [size]="14" /> }
            </button>
          }
        </div>

        <div role="tabpanel" [id]="'panel-' + activeTab()" [attr.aria-labelledby]="'tab-' + activeTab()" tabindex="0">
          @if (locked()) {
            <div class="panel lock">
              <app-empty icon="lock" title="Expediente clínico restringido" text="La captura y consulta clínica se habilita cuando la persona acepta el aviso de privacidad y el consentimiento informado.">
                <div class="row"><button tuiButton type="button" size="m" (click)="go('consentimientos')">Ir a consentimientos</button></div>
              </app-empty>
            </div>
          } @else {
            @switch (activeTab()) {
              @case ('resumen') { @if (true) {
                <div class="cols">
                  <section class="panel" aria-labelledby="h-datos">
                    <div class="panel-head"><h2 id="h-datos">Datos personales</h2></div>
                    <dl>
                      <dt>Nacimiento</dt><dd>{{ fd(p.profile.birthDate) }} ({{ age() }} años)</dd>
                      <dt>Sexo</dt><dd>{{ sexLabel[p.profile.sex] }}</dd>
                      <dt>Correo</dt><dd>{{ p.profile.email }}</dd>
                      <dt>Teléfono</dt><dd>{{ p.profile.phone }}</dd>
                      <dt>Alta</dt><dd>{{ fd(p.createdAt) }}</dd>
                    </dl>
                    <div class="eyebrow">Objetivo</div>
                    <p><strong>{{ goalLabel[p.goal] }}</strong>@if (p.goalNotes) { · {{ p.goalNotes }} }</p>
                  </section>

                  <section class="panel" aria-labelledby="h-med">
                    <div class="panel-head"><h2 id="h-med">Última medición</h2><button type="button" class="link-btn small" (click)="go('antropometria')">Ver historial</button></div>
                    @if (last(); as m) {
                      <p class="small muted">{{ fd(m.measuredAt) }}</p>
                      <div class="meas">
                        <div><b>{{ m.weightKg }}</b><span>Peso (kg)</span></div>
                        <div><b>{{ m.bmi }}</b><span>IMC</span></div>
                        @if (m.waistCm) { <div><b>{{ m.waistCm }}</b><span>Cintura (cm)</span></div> }
                        @if (m.hipCm) { <div><b>{{ m.hipCm }}</b><span>Cadera (cm)</span></div> }
                        @if (m.bodyFatPct) { <div><b>{{ m.bodyFatPct }}%</b><span>Grasa corporal</span></div> }
                      </div>
                    } @else { <app-empty icon="scale" title="Sin mediciones" text="Registra la primera medición en Antropometría." /> }
                  </section>

                  <section class="panel" aria-labelledby="h-cum">
                    <div class="panel-head"><h2 id="h-cum">Cumplimiento (14 días)</h2><button type="button" class="link-btn small" (click)="go('seguimiento')">Ver seguimiento</button></div>
                    @if (compliance().pct !== null) {
                      <div class="row"><app-ring [pct]="compliance().pct ?? 0" label="cumplido" /><div><p><strong>{{ compliance().done }}</strong> de {{ compliance().planned }} comidas realizadas</p><p class="small muted">{{ compliance().skipped }} omitidas · {{ compliance().pending }} sin registro</p></div></div>
                    } @else { <p class="muted">Sin comidas programadas en el periodo.</p> }
                  </section>

                  <section class="panel" aria-labelledby="h-plan">
                    <div class="panel-head"><h2 id="h-plan">Plan actual</h2></div>
                    @if (currentPlan(); as pl) {
                      <p><a [routerLink]="['/planes', pl.id]"><strong>{{ pl.name }}</strong></a></p>
                      <p class="small muted">{{ fd(pl.startDate) }} – {{ fd(pl.endDate) }}</p>
                      <div class="row"><app-badge [tone]="planTone[pl.status]">{{ planLabel[pl.status] }}</app-badge></div>
                      @for (a of planAlerts(); track a.id) { <app-alert-item [alert]="a" /> }
                    } @else { <p class="muted">Sin plan vigente.</p> }
                  </section>

                  <section class="panel" aria-labelledby="h-alm">
                    <div class="panel-head"><h2 id="h-alm">Almacenamiento</h2></div>
                    <div class="meter" role="img" [attr.aria-label]="quota().pct + '% usado'"><span [style.inline-size.%]="quota().pct" [style.background]="quota().warn ? 'var(--warn)' : null"></span></div>
                    <p class="small">{{ bytes(quota().used) }} de {{ bytes(quota().quota) }} ({{ quota().pct }} %)</p>
                    @if (quota().warn) { <div class="callout callout--warn"><app-icon name="alert" /><div class="callout-body">Cerca del límite de la cuota. Puedes ampliarla en Configuración › Almacenamiento.</div></div> }
                  </section>
                </div>
              } }
              @case ('antropometria') { <app-measurements-tab [patient]="p" /> }
              @case ('clinico') { <app-clinical-tab [patient]="p" /> }
              @case ('preferencias') { <app-preferences-tab [patient]="p" /> }
              @case ('notas') { <app-notes-tab [patient]="p" /> }
              @case ('documentos') { <app-documents-tab [patient]="p" /> }
              @case ('consentimientos') { <app-consents-tab [patient]="p" /> }
              @case ('planes') {
                <section class="panel panel--flush" aria-label="Planes del paciente">
                  <div class="panel-head"><h2>Planes</h2><a tuiButton size="s" routerLink="/planes/nuevo" [queryParams]="{ paciente: p.id }">Nuevo plan</a></div>
                  @if (plans().length) {
                    <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Plan</th><th scope="col">Periodo</th><th scope="col">Estado</th><th scope="col">Actualizado</th></tr></thead><tbody>
                      @for (pl of plans(); track pl.id) { <tr><td><a class="row-link" [routerLink]="['/planes', pl.id]">{{ pl.name }}</a></td><td>{{ fd(pl.startDate) }} – {{ fd(pl.endDate) }}</td><td><app-badge [tone]="planTone[pl.status]">{{ planLabel[pl.status] }}</app-badge></td><td>{{ fd(pl.updatedAt) }}</td></tr> }
                    </tbody></table></div>
                  } @else { <app-empty icon="calendar" title="Sin planes" text="Crea el primer plan alimentario para este paciente." /> }
                </section>
              }
              @case ('seguimiento') {
                <section class="stack" aria-label="Seguimiento">
                  @for (e of entries(); track e.id) { <app-tracking-card [entry]="e" [showPatient]="false" /> } @empty { <div class="panel"><app-empty icon="activity" title="Sin registros de seguimiento" text="Aparecerán cuando el paciente marque comidas, suba fotos o comente." /></div> }
                </section>
              }
            }
          }
        </div>
      </div>

      <app-modal [(open)]="editing" title="Editar datos del paciente">
        <form [formGroup]="editForm" id="edit-form" (ngSubmit)="saveEdit()" class="stack" novalidate>
          <div class="form-grid">
            <div class="field"><label for="e-first">Nombre(s)</label><input id="e-first" class="input" formControlName="firstName" /><app-field-error [control]="editForm.controls.firstName" /></div>
            <div class="field"><label for="e-last">Apellidos</label><input id="e-last" class="input" formControlName="lastName" /><app-field-error [control]="editForm.controls.lastName" /></div>
            <div class="field"><label for="e-birth">Nacimiento</label><input id="e-birth" class="input" type="date" formControlName="birthDate" /><app-field-error [control]="editForm.controls.birthDate" /></div>
            <div class="field"><label for="e-sex">Sexo</label><select id="e-sex" class="select" formControlName="sex"><option value="F">Femenino</option><option value="M">Masculino</option><option value="O">Otro</option></select></div>
            <div class="field"><label for="e-email">Correo</label><input id="e-email" class="input" type="email" formControlName="email" /><app-field-error [control]="editForm.controls.email" /></div>
            <div class="field"><label for="e-phone">Teléfono</label><input id="e-phone" class="input" type="tel" formControlName="phone" /><app-field-error [control]="editForm.controls.phone" /></div>
            <div class="field"><label for="e-goal">Objetivo</label><select id="e-goal" class="select" formControlName="goal">@for (g of goals; track g[0]) { <option [value]="g[0]">{{ g[1] }}</option> }</select></div>
          </div>
          <div class="field"><label for="e-notes">Detalle del objetivo</label><textarea id="e-notes" class="textarea" formControlName="goalNotes"></textarea></div>
        </form>
        <ng-container modalFooter>
          <button tuiButton type="button" appearance="secondary" size="m" (click)="editing.set(false)">Cancelar</button>
          <button tuiButton type="submit" form="edit-form" size="m">Guardar cambios</button>
        </ng-container>
      </app-modal>
    } @else if (loading()) {
      <div class="page" role="status" aria-label="Cargando expediente"><span class="skeleton" style="block-size: 4rem"></span><span class="skeleton" style="block-size: 18rem"></span></div>
    } @else {
      <div class="page"><app-empty icon="users" title="Paciente no encontrado" text="Es posible que el enlace sea incorrecto."><a tuiButton routerLink="/pacientes" appearance="secondary" size="m">Volver a pacientes</a></app-empty></div>
    }
  `,
})
export class PatientDetail {
  private readonly patients = inject(PatientsService);
  private readonly plansSvc = inject(PlansService);
  private readonly tracking = inject(TrackingService);
  private readonly data = inject(DbService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly id = input.required<string>();
  readonly tab = input<string>('resumen');

  protected readonly tabs = TABS;
  protected readonly tone = PATIENT_TONE;
  protected readonly planTone = PLAN_TONE;
  protected readonly statusLabel = PATIENT_STATUS_LABEL;
  protected readonly planLabel = PLAN_STATUS_LABEL;
  protected readonly goalLabel = GOAL_LABEL;
  protected readonly sexLabel = SEX_LABEL;
  protected readonly goals = Object.entries(GOAL_LABEL);
  protected readonly fd = formatDate;
  protected readonly bytes = formatBytes;
  protected readonly editing = signal(false);
  protected readonly loading = signal(false);

  protected readonly patient = computed(() => this.patients.get(this.id()));
  protected readonly name = computed(() => (this.patient() ? this.patients.fullName(this.patient()!) : ''));
  protected readonly ini = computed(() => initials(this.patient()?.profile.firstName ?? '', this.patient()?.profile.lastName ?? ''));
  protected readonly age = computed(() => (this.patient() ? ageFrom(this.patient()!.profile.birthDate) : 0));
  protected readonly consentOk = computed(() => this.patient() ? (this.data.version(), this.patients.consentComplete(this.patient()!.id)) : false);
  protected readonly activeTab = computed<TabId>(() => (TABS.some((t) => t.id === this.tab()) ? (this.tab() as TabId) : 'resumen'));
  protected readonly locked = computed(() => !this.consentOk() && (TABS.find((t) => t.id === this.activeTab())?.clinical ?? false));
  protected readonly last = computed(() => (this.patient() ? latestMeasurement(this.patient()!.measurements) : undefined));
  protected readonly quota = computed(() => this.patients.quota(this.patient()!));
  protected readonly plans = computed(() => this.plansSvc.plansOf(this.id()).sort((a, b) => b.startDate.localeCompare(a.startDate)));
  protected readonly currentPlan = computed(() => this.plansSvc.currentFor(this.id()) ?? this.plans().find((p) => p.status === 'draft'));
  protected readonly planAlerts = computed(() => {
    const pl = this.currentPlan();
    return pl ? this.plansSvc.alertsFor(pl).slice(0, 3) : [];
  });
  protected readonly compliance = computed(() => {
    this.data.version();
    const end = new Date();
    const from = new Date(end);
    from.setDate(end.getDate() - 13);
    const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return this.tracking.compliance(this.id(), iso(from), iso(end));
  });
  protected readonly entries = computed(() => this.tracking.entriesOf(this.id()).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 30));

  protected readonly editForm = this.fb.nonNullable.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    birthDate: ['', [Validators.required, adultValidator]],
    sex: ['F' as Sex],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', Validators.required],
    goal: ['maintenance' as Goal],
    goalNotes: [''],
  });

  constructor() {
    // Modo API: el expediente se pide al servidor al abrir (y al cambiar de paciente).
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.loading.set(true);
        this.patients.load(id).subscribe({
          complete: () => this.loading.set(false),
          error: () => this.loading.set(false),
        });
        this.tracking.loadPatient(id).subscribe({ error: () => undefined });
        this.patients.loadDocuments(id).subscribe({ error: () => undefined });
      });
    });
  }

  protected readonly shareLink = signal<string | null>(null);

  protected resend(): void {
    this.patients.resendInvite(this.id()).subscribe({
      next: (r) => { if (r.inviteLink) this.shareLink.set(r.inviteLink); else this.toast.ok(r.emailed ? 'Invitación reenviada por correo.' : 'Invitación reenviada.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo completar la operación.'),
    });
  }

  protected go(tab: TabId): void {
    void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge' });
  }

  protected onTabKey(e: KeyboardEvent): void {
    const i = TABS.findIndex((t) => t.id === this.activeTab());
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length];
    this.go(t.id);
    setTimeout(() => document.getElementById('tab-' + t.id)?.focus());
  }

  protected openEdit(): void {
    const p = this.patient();
    if (!p) return;
    this.editForm.reset({ ...p.profile, goal: p.goal, goalNotes: p.goalNotes });
    this.editing.set(true);
  }

  protected saveEdit(): void {
    this.editForm.markAllAsTouched();
    if (this.editForm.invalid) return;
    const { goal, goalNotes, ...profile } = this.editForm.getRawValue();
    if (this.patients.emailInUse(profile.email, this.id())) {
      this.editForm.controls.email.setErrors({ taken: true });
      return;
    }
    this.patients.update(this.id(), { profile, goal, goalNotes });
    this.editing.set(false);
    this.toast.ok('Datos actualizados.');
  }

  protected async deactivate(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Desactivar paciente',
      message: `${this.name()} dejará de aparecer en las consultas habituales y perderá acceso. Su historial se conserva y podrás restaurarlo.`,
      confirmLabel: 'Desactivar',
      tone: 'danger',
    });
    if (!ok) return;
    this.patients.setActive(this.id(), false);
    this.toast.ok('Paciente desactivado.');
  }

  protected restore(): void {
    this.patients.setActive(this.id(), true);
    this.toast.ok('Paciente restaurado.');
  }
}
