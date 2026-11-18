import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

/** Carga las piezas visuales compartidas del panel (.pf-*) una sola vez, solo en la zona /plataforma. */
@Component({
  selector: 'app-pf-styles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./platform-ui.scss', './platform-tables.scss'],
  template: '',
})
export class PfStyles {}
