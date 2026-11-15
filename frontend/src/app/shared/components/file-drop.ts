import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Icon } from './icon';

/**
 * Zona para elegir o arrastrar una imagen (reemplaza el selector nativo del navegador).
 * El <input type="file"> sigue siendo el control real: funciona con teclado y lectores de pantalla.
 */
@Component({
  selector: 'app-file-drop',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .drop { position: relative; display: flex; align-items: center; gap: var(--space-4); padding: var(--space-4); border: 1.5px dashed color-mix(in srgb, var(--nutri-texto) 40%, var(--nutri-borde));
      border-radius: var(--radius-m); background: var(--nutri-marfil); cursor: pointer; min-block-size: 5.5rem; }
    .drop:hover, .drop.over { border-color: var(--brand-ink); background: color-mix(in srgb, var(--nutri-lavanda) 40%, var(--nutri-marfil)); }
    .drop:focus-within { outline: 2px solid var(--brand-ink); outline-offset: 2px; }
    input { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; opacity: 0; cursor: pointer; }
    .thumb { flex: none; inline-size: 3.5rem; block-size: 3.5rem; border-radius: var(--radius-s); object-fit: cover; background: var(--surface); border: 1px solid var(--line); }
    .ph { flex: none; display: grid; place-items: center; inline-size: 3.5rem; block-size: 3.5rem; border-radius: var(--radius-s); background: var(--surface); border: 1px solid var(--line); color: var(--muted); }
    .txt { display: grid; gap: .125rem; min-inline-size: 0; }
    .txt strong { font-weight: 600; }
    .clear { position: relative; z-index: 1; margin-inline-start: auto; }
  `,
  template: `
    <div class="field">
      <span class="label" [id]="id + '-l'">{{ label() }}</span>
      <div class="drop" [class.over]="over()" (dragover)="$event.preventDefault(); over.set(true)" (dragleave)="over.set(false)" (drop)="onDrop($event)">
        @if (current()) { <img class="thumb" [src]="current()" alt="" /> } @else { <span class="ph"><app-icon name="image" /></span> }
        <span class="txt">
          <strong>{{ current() ? 'Cambiar imagen' : 'Elegir o arrastrar una imagen' }}</strong>
          <span class="small muted">{{ hint() }}</span>
        </span>
        <input [id]="id" type="file" [accept]="accept()" [attr.aria-labelledby]="id + '-l'" (change)="onChange($event)" />
        @if (current() && clearable()) { <button type="button" class="icon-btn clear" [attr.aria-label]="'Quitar ' + label().toLowerCase()" (click)="clear($event)"><app-icon name="x" [size]="18" /></button> }
      </div>
    </div>
  `,
})
export class FileDrop {
  readonly label = input.required<string>();
  readonly hint = input('PNG, JPG o WebP.');
  readonly accept = input('image/png,image/jpeg,image/webp');
  /** Vista previa actual (data URL o URL). */
  readonly current = input('');
  readonly clearable = input(true);
  readonly picked = output<File>();
  readonly cleared = output<void>();
  protected readonly over = signal(false);
  protected readonly id = `fd-${Math.random().toString(36).slice(2, 8)}`;

  protected onChange(e: Event): void {
    const el = e.target as HTMLInputElement;
    const f = el.files?.[0];
    if (f) this.picked.emit(f);
    el.value = '';
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.over.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.picked.emit(f);
  }

  protected clear(e: Event): void {
    e.stopPropagation();
    this.cleared.emit();
  }
}
