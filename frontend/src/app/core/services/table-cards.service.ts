import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/**
 * Convierte toda `<table class="table">` en tarjetas en pantallas angostas: copia el texto de cada encabezado
 * a `data-label` de su celda (el CSS de `.table--cards` lo muestra como etiqueta). Las tablas ya etiquetadas a
 * mano o marcadas con `table--keep` no se tocan. Observa el DOM para cubrir las que aparecen después de cargar.
 */
@Injectable({ providedIn: 'root' })
export class TableCardsService {
  private readonly doc = inject(DOCUMENT);
  private queued = false;

  start(): void {
    const win = this.doc.defaultView;
    if (!win || typeof MutationObserver === 'undefined') return;
    new MutationObserver(() => this.schedule()).observe(this.doc.body, { childList: true, subtree: true });
    this.schedule();
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    (this.doc.defaultView?.requestAnimationFrame ?? setTimeout)(() => {
      this.queued = false;
      this.doc.querySelectorAll<HTMLTableElement>('table.table:not(.table--keep)').forEach((t) => this.label(t));
    });
  }

  private label(t: HTMLTableElement): void {
    const heads = Array.from(t.querySelectorAll<HTMLTableCellElement>('thead th'));
    if (!heads.length) return;
    t.classList.add('table--cards');
    t.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => {
      let col = 0;
      Array.from(tr.cells).forEach((td, i) => {
        const th = heads[col];
        if (!td.hasAttribute('data-label') && th) {
          const text = (th.textContent ?? '').trim();
          // Primera columna = título de la tarjeta (sin etiqueta); las de acciones sin texto tampoco la llevan.
          if (i === 0) td.classList.add('cell-main');
          else if (text) td.setAttribute('data-label', text);
        }
        col += td.colSpan || 1;
      });
    });
  }
}
