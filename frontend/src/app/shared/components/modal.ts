import { ChangeDetectionStrategy, Component, ElementRef, effect, input, model, output, viewChild } from '@angular/core';
import { Icon } from './icon';

let seq = 0;

/** Diálogo accesible basado en <dialog>: foco atrapado, Esc cierra, clic en el fondo cierra. */
@Component({
  selector: 'app-modal',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog { border: 0; padding: 0; border-radius: var(--radius-l); background: var(--surface); color: var(--nutri-texto);
      inline-size: min(100% - 2rem, 34rem); max-block-size: min(92dvh, 52rem); box-shadow: var(--shadow-m); overflow: hidden; }
    dialog.wide { inline-size: min(100% - 2rem, 60rem); }
    dialog.narrow { inline-size: min(100% - 2rem, 26rem); }
    dialog::backdrop { background: rgb(81 70 83 / 45%); }
    .inner { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-block-size: inherit; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem 1rem 1.5rem; border-block-end: 1px solid var(--line); }
    h2 { font-size: 1.25rem; }
    .body { overflow: auto; padding: 1.5rem; display: grid; gap: 1rem; align-content: start; }
    footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; padding: 1rem 1.5rem; border-block-start: 1px solid var(--line); background: var(--nutri-marfil); }
    footer:empty { display: none; }
    @media (prefers-reduced-motion: no-preference) { dialog[open] { animation: pop .18s ease-out; } @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } } }
  `,
  template: `
    <dialog #dlg [class.wide]="size() === 'wide'" [class.narrow]="size() === 'narrow'" [attr.aria-labelledby]="titleId" (cancel)="$event.preventDefault(); requestClose()" (click)="onBackdrop($event)">
      <div class="inner">
        <header>
          <h2 [id]="titleId">{{ title() }}</h2>
          <button type="button" class="icon-btn" aria-label="Cerrar" (click)="requestClose()"><app-icon name="x" /></button>
        </header>
        <div class="body"><ng-content /></div>
        <footer><ng-content select="[modalFooter]" /></footer>
      </div>
    </dialog>
  `,
})
export class Modal {
  readonly open = model(false);
  readonly title = input.required<string>();
  readonly size = input<'narrow' | 'normal' | 'wide'>('normal');
  readonly closed = output<void>();
  protected readonly titleId = `modal-title-${++seq}`;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      if (this.open() && !el.open) el.showModal();
      if (!this.open() && el.open) el.close();
    });
  }

  requestClose(): void {
    this.open.set(false);
    this.closed.emit();
  }

  protected onBackdrop(e: MouseEvent): void {
    if (e.target === this.dlg().nativeElement) this.requestClose();
  }
}
