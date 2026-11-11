import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DbService } from '../../core/data/db.service';
import { FoodView } from '../../core/nutrition/engine';
import { normalizeText } from '../../shared/utils/format';
import { Icon } from '../../shared/components/icon';

let seq = 0;

/** Combobox accesible para elegir un alimento del catálogo SMAE o personalizado. */
@Component({
  selector: 'app-food-picker',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { position: relative; display: block; }
    ul { position: absolute; inset-inline: 0; z-index: 15; margin: .25rem 0 0; padding: .25rem; list-style: none; max-block-size: 18rem; overflow: auto; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-s); box-shadow: var(--shadow-m); }
    li { display: flex; align-items: center; gap: .5rem; padding: .5rem .625rem; min-block-size: 2.75rem; border-radius: .375rem; cursor: pointer; }
    li[aria-selected='true'], li:hover { background: var(--nutri-lavanda); }
    .sub { font-size: .8125rem; color: var(--muted); }
    .tag { margin-inline-start: auto; font-size: .75rem; font-weight: 600; padding: .05rem .5rem; border-radius: 999px; background: var(--nutri-mantequilla); white-space: nowrap; }
  `,
  template: `
    <div class="field">
      <label [for]="id" [class.visually-hidden]="hideLabel()">{{ label() }}</label>
      <div class="input-affix">
        <app-icon name="search" [size]="18" />
        <input [id]="id" class="input" role="combobox" aria-autocomplete="list" [attr.aria-expanded]="open()" [attr.aria-controls]="id + '-list'" [attr.aria-activedescendant]="open() && results().length ? id + '-o' + active() : null"
          [value]="term()" (input)="onInput($any($event.target).value)" (focus)="open.set(true)" (blur)="onBlur()" (keydown)="onKey($event)" [placeholder]="placeholder()" autocomplete="off" />
      </div>
    </div>
    @if (open() && term().trim().length > 0) {
      <ul [id]="id + '-list'" role="listbox" [attr.aria-label]="label()">
        @for (f of results(); track f.ref.id; let i = $index) {
          <li role="option" [id]="id + '-o' + i" [attr.aria-selected]="i === active()" (mousedown)="$event.preventDefault(); pick(f)">
            <div><div>{{ f.name }}</div><div class="sub">{{ f.equivalence?.subgroupCode ?? 'Sin equivalencia SMAE' }} · {{ f.profile.energy }} kcal / {{ f.profile.basisQuantity }} {{ f.profile.basisUnit }}</div></div>
            @if (!f.official) { <span class="tag">Personalizado</span> }
          </li>
        } @empty { <li role="option" aria-selected="false" aria-disabled="true">Sin resultados para "{{ term() }}"</li> }
      </ul>
    }
  `,
})
export class FoodPicker {
  private readonly data = inject(DbService);
  readonly label = input('Buscar alimento');
  readonly placeholder = input('Escribe para buscar (p. ej. pollo, manzana)…');
  readonly hideLabel = input(false);
  readonly picked = output<FoodView>();

  protected readonly id = `fp-${++seq}`;
  protected readonly term = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly results = computed(() => {
    const t = normalizeText(this.term());
    if (!t) return [];
    return this.data.activeFoods().filter((f) => normalizeText(`${f.name} ${f.tags.join(' ')}`).includes(t)).slice(0, 8);
  });

  protected onInput(v: string): void { this.term.set(v); this.open.set(true); this.active.set(0); }
  protected onBlur(): void { setTimeout(() => this.open.set(false), 120); }
  protected pick(f: FoodView): void { this.picked.emit(f); this.term.set(''); this.open.set(false); }

  protected onKey(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.open.set(true); this.active.set(n ? (this.active() + 1) % n : 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set(n ? (this.active() - 1 + n) % n : 0); }
    else if (e.key === 'Enter' && this.open() && n) { e.preventDefault(); this.pick(this.results()[this.active()]); }
    else if (e.key === 'Escape') this.open.set(false);
  }
}
