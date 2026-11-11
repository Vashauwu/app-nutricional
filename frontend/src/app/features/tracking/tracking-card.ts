import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { PatientsService } from '../../core/services/patients.service';
import { TrackingService } from '../../core/services/tracking.service';
import { ToastService } from '../../core/services/ui.services';
import { TrackingEntry, TrackingPhoto } from '../../shared/models/domain';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { Badge } from '../../shared/components/ui';
import { formatDate, formatDateTime } from '../../shared/utils/format';

/** Registro de una comida con su hilo de comentarios (§12.3, §12.4). La conversación es por tiempo de comida, no un chat global. */
@Component({
  selector: 'app-tracking-card',
  imports: [RouterLink, ReactiveFormsModule, TuiButton, Icon, Modal, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    article { border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); padding: var(--space-4) var(--space-5); display: grid; gap: var(--space-3); }
    article.review { border-inline-start: 4px solid var(--brand-primary); }
    .top { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); align-items: center; }
    h3 { font-size: 1.0625rem; }
    blockquote { margin: 0; padding: .5rem .75rem; border-inline-start: 3px solid var(--nutri-lavanda); background: var(--nutri-marfil); border-radius: 0 var(--radius-s) var(--radius-s) 0; }
    .photos { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .photos button { padding: 0; border: 1px solid var(--line); border-radius: var(--radius-s); overflow: hidden; cursor: pointer; inline-size: 5.5rem; block-size: 5.5rem; background: none; }
    .photos img { inline-size: 100%; block-size: 100%; object-fit: cover; }
    .thread { display: grid; gap: var(--space-2); }
    .msg { padding: .5rem .75rem; border-radius: var(--radius-s); background: var(--nutri-cielo); max-inline-size: 90%; }
    .msg.nutri { background: var(--nutri-lavanda); justify-self: end; }
    .msg b { font-size: .8125rem; } .msg time { font-size: .75rem; color: var(--muted); margin-inline-start: .5rem; }
    form { display: flex; gap: var(--space-2); align-items: flex-end; }
    form .textarea { min-block-size: 3rem; }
    .big { inline-size: 100%; max-block-size: 70dvh; object-fit: contain; border-radius: var(--radius-s); }
  `,
  template: `
    <article [class.review]="entry().needsReview">
      <div class="top">
        @if (showPatient()) { <a [routerLink]="['/pacientes', entry().patientId]"><strong>{{ patientName() }}</strong></a> · }
        <span>{{ fd(entry().date) }} · {{ entry().slotName }}</span>
        <app-badge [tone]="entry().status === 'done' ? 'ok' : 'warn'" [icon]="entry().status === 'done' ? 'check' : 'skip'">{{ entry().status === 'done' ? 'Realizada' : 'Omitida' }}</app-badge>
        @if (entry().needsReview) { <app-badge tone="accent">Por revisar</app-badge> }
        <span class="grow"></span><span class="small muted">{{ fdt(entry().recordedAt) }}</span>
      </div>
      <h3>{{ entry().dishName }} <span class="small muted">· versión {{ entry().dishVersion }} (la que tenía asignada)</span></h3>
      @if (entry().patientComment) { <blockquote>{{ entry().patientComment }}</blockquote> }
      @if (entry().photos.length) {
        <div class="photos" role="group" aria-label="Fotografías del registro">
          @for (p of entry().photos; track p.id) { <button type="button" [attr.aria-label]="'Ver foto: ' + p.alt" (click)="photo.set(p)"><img [src]="p.dataUrl" [alt]="p.alt" loading="lazy" /></button> }
        </div>
      }
      @if (entry().thread.length) {
        <div class="thread" role="log" [attr.aria-label]="'Conversación de ' + entry().slotName">
          @for (c of entry().thread; track c.id) { <div class="msg" [class.nutri]="c.authorRole === 'nutritionist'"><b>{{ c.authorName }}</b><time>{{ fdt(c.at) }}</time><p>{{ c.body }}</p></div> }
        </div>
      }
      @if (canReply()) {
        <form [formGroup]="form" (ngSubmit)="reply()">
          <div class="field grow"><label [for]="'r-' + entry().id" class="visually-hidden">Responder</label><textarea [id]="'r-' + entry().id" class="textarea" formControlName="body" placeholder="Responder sobre esta comida…" maxlength="1000"></textarea></div>
          <button tuiButton type="submit" size="m" [disabled]="!form.controls.body.value.trim()"><app-icon name="send" [size]="16" /> Responder</button>
          @if (entry().needsReview) { <button tuiButton type="button" size="m" appearance="secondary" (click)="reviewed()">Marcar revisado</button> }
        </form>
      }
    </article>
    <app-modal [open]="!!photo()" (closed)="photo.set(null)" [title]="photo()?.alt ?? 'Fotografía'" size="wide">
      @if (photo(); as p) { <img class="big" [src]="p.dataUrl" [alt]="p.alt" /> }
    </app-modal>
  `,
})
export class TrackingCard {
  private readonly tracking = inject(TrackingService);
  private readonly patients = inject(PatientsService);
  private readonly auth = inject(AuthService);
  private readonly data = inject(DbService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  readonly entry = input.required<TrackingEntry>();
  readonly showPatient = input(true);
  protected readonly photo = signal<TrackingPhoto | null>(null);
  protected readonly fd = formatDate;
  protected readonly fdt = formatDateTime;
  protected readonly form = this.fb.nonNullable.group({ body: [''] });
  protected readonly canReply = computed(() => this.auth.role() === 'nutritionist');
  protected readonly patientName = computed(() => (this.data.version(), this.patients.get(this.entry().patientId) ? this.patients.fullName(this.patients.get(this.entry().patientId)!) : '—'));

  protected reply(): void {
    this.tracking.addComment(this.entry().id, 'nutritionist', this.auth.user()?.name ?? 'Nutrióloga', this.form.controls.body.value).subscribe({
      next: () => { this.form.reset({ body: '' }); this.toast.ok('Respuesta enviada. La paciente la verá de inmediato.'); },
      error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar.'),
    });
  }

  protected reviewed(): void {
    this.tracking.markReviewed(this.entry().id).subscribe({ error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo marcar.') });
  }
}
