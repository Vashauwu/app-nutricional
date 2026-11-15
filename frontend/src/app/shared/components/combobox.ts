import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, model, signal } from '@angular/core';
import { normalizeText } from '../utils/format';
import { Icon } from './icon';

export interface ComboOption {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Selector con búsqueda (patrón ARIA «combobox» con lista): sustituye a los <select> nativos cuando la lista
 * puede ser larga (pacientes). Escribe para filtrar; flechas, Enter y Escape funcionan como se espera.
 * `value` es el id elegido ('' = sin selección).
 */
@Component({
  selector: 'app-combobox',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { position: relative; display: block; }
    .box { position: relative; }
    .box input { padding-inline-end: 4.5rem; }
    .btns { position: absolute; inset-block: 0; inset-inline-end: .25rem; display: flex; align-items: center; }
    .btns button { display: grid; place-items: center; inline-size: 2rem; block-size: 2rem; border: 0; border-radius: var(--radius-s); background: none; color: var(--muted); cursor: pointer; }
    .btns button:hover { background: color-mix(in srgb, var(--nutri-borde) 70%, transparent); color: var(--nutri-texto); }
    ul { position: absolute; inset-inline: 0; inset-block-start: calc(100% + .25rem); z-index: 50; margin: 0; padding: .25rem; list-style: none; max-block-size: 16rem; overflow: auto;
      border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); box-shadow: var(--shadow-m); }
    li { display: flex; align-items: center; gap: .5rem; min-block-size: 2.5rem; padding: 0 .75rem; border-radius: var(--radius-s); cursor: pointer; }
    li[aria-selected='true'] { background: color-mix(in srgb, var(--nutri-lavanda) 60%, transparent); }
    li .hint { margin-inline-start: auto; font-size: .8125rem; color: var(--muted); }
    li.none { color: var(--muted); cursor: default; }
  `,
  template: `
    <div class="field">
      <label [for]="id" [class.visually-hidden]="hideLabel()">{{ label() }}</label>
      <div class="box">
        <input [id]="id" class="input" type="text" role="combobox" aria-autocomplete="list" [attr.aria-expanded]="open()" [attr.aria-controls]="id + '-l'" [attr.aria-activedescendant]="open() ? id + '-o' + active() : null"
          autocomplete="off" [placeholder]="placeholder()" [value]="text()" (input)="onInput($any($event.target).value)" (focus)="open.set(true)" (keydown)="onKey($event)" />
        <span class="btns">
          @if (value()) { <button type="button" aria-label="Quitar selección" (click)="clear()"><app-icon name="x" [size]="16" /></button> }
          <button type="button" tabindex="-1" aria-hidden="true" (click)="toggle()"><app-icon name="chevron-down" [size]="16" /></button>
        </span>
      </div>
    </div>
    @if (open()) {
      <ul role="listbox" [id]="id + '-l'" [attr.aria-label]="label()">
        @if (showAll()) { <li role="option" [id]="id + '-o0'" [attr.aria-selected]="active() === 0" (mousedown)="$event.preventDefault(); pick(null)" (mouseenter)="active.set(0)">{{ allLabel() }}</li> }
        @for (o of filtered(); track o.id; let i = $index) {
          <li role="option" [id]="id + '-o' + (i + offset())" [attr.aria-selected]="active() === i + offset()" (mousedown)="$event.preventDefault(); pick(o)" (mouseenter)="active.set(i + offset())">
            <span>{{ o.label }}</span>@if (o.hint) { <span class="hint">{{ o.hint }}</span> }
          </li>
        } @empty { <li class="none" role="presentation">Sin resultados para «{{ query() }}»</li> }
      </ul>
    }
  `,
})
export class Combobox {
  readonly options = input.required<ComboOption[]>();
  readonly value = model('');
  readonly label = input.required<string>();
  readonly placeholder = input('Escribe para buscar…');
  /** Oculta la etiqueta visible (sigue disponible para lectores de pantalla), p. ej. dentro de una barra de filtros. */
  readonly hideLabel = input(false);
  /** Primera opción «todos» que limpia el filtro. */
  readonly allowAll = input(false);
  readonly allLabel = input('Todos');

  protected readonly id = `cb-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly query = signal('');
  private readonly typing = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** «Todos» solo aparece cuando no se está filtrando. */
  protected readonly showAll = computed(() => this.allowAll() && !(this.typing() && this.query().trim()));
  protected readonly offset = computed(() => (this.showAll() ? 1 : 0));
  protected readonly selected = computed(() => this.options().find((o) => o.id === this.value()));
  /** Texto del campo: lo escrito mientras se busca; si no, la opción elegida. */
  protected readonly text = computed(() => (this.typing() ? this.query() : (this.selected()?.label ?? '')));
  protected readonly filtered = computed(() => {
    const q = normalizeText(this.typing() ? this.query().trim() : '');
    return this.options().filter((o) => !q || normalizeText(`${o.label} ${o.hint ?? ''}`).includes(q)).slice(0, 50);
  });

  protected onInput(v: string): void { this.typing.set(true); this.query.set(v); this.open.set(true); this.active.set(this.offset()); }
  protected toggle(): void { this.open.update((o) => !o); }
  protected clear(): void { this.pick(null); }

  protected pick(o: ComboOption | null): void {
    this.value.set(o?.id ?? '');
    this.typing.set(false);
    this.query.set('');
    this.open.set(false);
  }

  protected onKey(e: KeyboardEvent): void {
    const n = this.filtered().length + this.offset();
    if (e.key === 'ArrowDown') { e.preventDefault(); this.open.set(true); this.active.set(n ? (this.active() + 1) % n : 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set(n ? (this.active() - 1 + n) % n : 0); }
    else if (e.key === 'Enter' && this.open()) {
      e.preventDefault();
      const i = this.active();
      if (this.showAll() && i === 0) this.pick(null);
      else { const o = this.filtered()[i - this.offset()]; if (o) this.pick(o); }
    } else if (e.key === 'Escape') { this.open.set(false); this.typing.set(false); }
  }

  @HostListener('document:click', ['$event'])
  protected outside(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) { this.open.set(false); this.typing.set(false); }
  }
}
