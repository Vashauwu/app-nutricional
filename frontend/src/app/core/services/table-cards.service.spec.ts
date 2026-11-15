import { TestBed } from '@angular/core/testing';
import { TableCardsService } from './table-cards.service';

describe('TableCardsService', () => {
  it('etiqueta las celdas con su encabezado y marca la primera como título', async () => {
    document.body.insertAdjacentHTML('beforeend', '<table class="table" id="t1"><thead><tr><th>Nombre</th><th>Edad</th></tr></thead><tbody><tr><td>Ana</td><td>30</td></tr></tbody></table>');
    TestBed.inject(TableCardsService).start();
    await new Promise((r) => setTimeout(r, 60));
    const t = document.getElementById('t1')!;
    expect(t.classList.contains('table--cards')).toBe(true);
    const cells = t.querySelectorAll('td');
    expect(cells[0].classList.contains('cell-main')).toBe(true);
    expect(cells[1].getAttribute('data-label')).toBe('Edad');
    t.remove();
  });
});
