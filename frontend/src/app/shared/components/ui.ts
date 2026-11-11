import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, model, numberAttribute, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { IconName, Icon } from './icon';
import { NutriAlert, PatientStatus, PlanStatus } from '../models/domain';
import { shortDate } from '../utils/format';

// ---------- Estado vacío ----------
@Component({
  selector: 'app-empty',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty">
      <app-icon [name]="icon()" [size]="36" />
      <h3>{{ title() }}</h3>
      @if (text()) { <p>{{ text() }}</p> }
      <ng-content />
    </div>
  `,
})
export class EmptyState {
  readonly icon = input<IconName>('search');
  readonly title = input.required<string>();
  readonly text = input('');
}

// ---------- Esqueleto de carga ----------
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="status" aria-label="Cargando" style="display: grid; gap: .75rem; padding: 1rem 1.25rem">
      @for (r of rows(); track r) { <span class="skeleton" [style.block-size]="height()" [style.inline-size]="r % 3 === 0 ? '70%' : '100%'"></span> }
      <span class="visually-hidden">Cargando…</span>
    </div>
  `,
})
export class Skeleton {
  readonly count = input(4, { transform: numberAttribute });
  readonly height = input('2.5rem');
  protected readonly rows = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}

// ---------- Error recuperable ----------
@Component({
  selector: 'app-load-error',
  imports: [Icon, TuiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty" role="alert">
      <app-icon name="alert-circle" [size]="36" />
      <h3>No pudimos cargar esta información</h3>
      <p>{{ message() }}</p>
      <button tuiButton type="button" appearance="secondary" size="m" (click)="retry.emit()">Reintentar</button>
    </div>
  `,
})
export class LoadError {
  readonly message = input('Revisa tu conexión e inténtalo de nuevo.');
  readonly retry = output<void>();
}

// ---------- Búsqueda ----------
@Component({
  selector: 'app-search',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <label [for]="id" [class.visually-hidden]="hideLabel()">{{ label() }}</label>
      <div class="input-affix">
        <app-icon name="search" [size]="18" />
        <input [id]="id" class="input" type="search" [placeholder]="placeholder()" [value]="value()" (input)="value.set($any($event.target).value)" autocomplete="off" />
      </div>
    </div>
  `,
})
export class SearchBox {
  readonly value = model('');
  readonly label = input('Buscar');
  readonly placeholder = input('Buscar…');
  readonly hideLabel = input(true, { transform: booleanAttribute });
  protected readonly id = `search-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- Paginación tradicional (§20.2) ----------
@Component({
  selector: 'app-pagination',
  imports: [Icon, TuiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (total() > 0) {
      <nav class="row row--between" aria-label="Paginación" style="padding: .75rem 1.25rem">
        <p class="small muted" aria-live="polite">Mostrando {{ from() }}–{{ to() }} de {{ total() }}</p>
        <div class="row">
          <button tuiButton type="button" appearance="secondary" size="s" [disabled]="page() <= 1" (click)="pageChange.emit(page() - 1)"><app-icon name="chevron-left" [size]="16" /> Anterior</button>
          <span class="small">Página {{ page() }} de {{ pages() }}</span>
          <button tuiButton type="button" appearance="secondary" size="s" [disabled]="page() >= pages()" (click)="pageChange.emit(page() + 1)">Siguiente <app-icon name="chevron-right" [size]="16" /></button>
        </div>
      </nav>
    }
  `,
})
export class Pagination {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly pageChange = output<number>();
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly from = computed(() => (this.page() - 1) * this.pageSize() + 1);
  protected readonly to = computed(() => Math.min(this.page() * this.pageSize(), this.total()));
}

// ---------- Estados con texto (no dependen solo del color, §20.1) ----------
export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'accent' | 'neutral';

export const PLAN_TONE: Record<PlanStatus, Tone> = { draft: 'warn', published: 'ok', finished: 'info', archived: 'neutral' };
export const PATIENT_TONE: Record<PatientStatus, Tone> = { active: 'ok', invited: 'accent', inactive: 'neutral' };

@Component({
  selector: 'app-badge',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="'badge badge--' + tone()">@if (icon()) { <app-icon [name]="icon()!" [size]="14" /> }<ng-content /></span>`,
})
export class Badge {
  readonly tone = input<Tone>('neutral');
  readonly icon = input<IconName | null>(null);
}

// ---------- Alerta nutricional (§14) ----------
const LEVEL: Record<NutriAlert['level'], { label: string; icon: IconName; cls: string }> = {
  critical: { label: 'Crítica', icon: 'alert', cls: 'callout--crit' },
  warning: { label: 'Advertencia', icon: 'alert-circle', cls: 'callout--warn' },
  info: { label: 'Informativa', icon: 'info', cls: '' },
};

@Component({
  selector: 'app-alert-item',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="callout" [class]="'callout ' + meta().cls">
      <app-icon [name]="meta().icon" />
      <div class="callout-body">
        <p><strong>{{ meta().label }}:</strong> {{ alert().title }}</p>
        <p class="small">{{ alert().reason }}</p>
        <p class="small muted">Origen: {{ alert().source }}@if (alert().date) { · {{ dateLabel() }} }</p>
        @if (alert().planId && link()) {
          <a class="small" [routerLink]="['/planes', alert().planId]" [queryParams]="alert().date ? { fecha: alert().date } : null">Revisar en el plan</a>
        }
      </div>
    </div>
  `,
})
export class AlertItem {
  readonly alert = input.required<NutriAlert>();
  readonly link = input(true, { transform: booleanAttribute });
  protected readonly meta = computed(() => LEVEL[this.alert().level]);
  protected readonly dateLabel = computed(() => (this.alert().date ? shortDate(this.alert().date!) : ''));
}
