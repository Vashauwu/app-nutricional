import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';

interface PaletteSwatch {
  readonly name: string;
  readonly hex: string;
  readonly token: string;
  readonly use: string;
}

/**
 * Pantalla provisional de Fase 0: verifica que el tema (paleta §19.3,
 * tipografías y Taiga UI) esté cableado. Se reemplaza por el dashboard real (§13).
 */
@Component({
  selector: 'app-dashboard',
  imports: [TuiButton],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected readonly palette: readonly PaletteSwatch[] = [
    { name: 'Rosa pastel', hex: '#F4C9D6', token: '--nutri-rosa', use: 'Alertas críticas' },
    { name: 'Verde salvia', hex: '#D7E8D5', token: '--nutri-salvia', use: 'Cumplimiento' },
    { name: 'Lavanda', hex: '#DDD6F2', token: '--nutri-lavanda', use: 'Acentos' },
    { name: 'Amarillo mantequilla', hex: '#F8E8B8', token: '--nutri-mantequilla', use: 'Advertencias' },
    { name: 'Azul cielo', hex: '#D8E8F2', token: '--nutri-cielo', use: 'Informativas' },
    { name: 'Marfil', hex: '#FAF7F2', token: '--nutri-marfil', use: 'Fondo' },
    { name: 'Ciruela grisáceo', hex: '#514653', token: '--nutri-texto', use: 'Texto y acciones' },
    { name: 'Gris rosado', hex: '#E9E3E5', token: '--nutri-borde', use: 'Bordes' },
  ];
}
