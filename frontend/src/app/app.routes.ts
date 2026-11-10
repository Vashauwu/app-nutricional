import { Routes } from '@angular/router';

// Feature-based + lazy loading (§21.5). Cada feature se agrega aquí conforme
// se implemente su fase; los guards de rol viven en core/guards.
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Inicio',
  },
  { path: '**', redirectTo: '' },
];
