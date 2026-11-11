import { Routes } from '@angular/router';
import { consentGuard, guestGuard, roleGuard } from './core/guards/auth.guards';
import { unsavedChangesGuard } from './core/guards/unsaved.guard';

// Feature-based + lazy loading (§21.5). Los guards mejoran la experiencia;
// la autorización real es del backend (§2.2).
export const routes: Routes = [
  { path: 'ingresar', title: 'Ingresar', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login').then((m) => m.Login) },
  { path: 'recuperar', title: 'Recuperar contraseña', canActivate: [guestGuard], loadComponent: () => import('./features/auth/recovery').then((m) => m.ForgotPassword) },
  { path: 'restablecer/:token', title: 'Nueva contraseña', loadComponent: () => import('./features/auth/recovery').then((m) => m.ResetPassword) },

  {
    path: 'paciente',
    canActivate: [roleGuard('patient')],
    loadComponent: () => import('./core/layout/patient-shell').then((m) => m.PatientShell),
    children: [
      { path: 'consentimiento', title: 'Aviso y consentimiento', loadComponent: () => import('./features/patient-app/consent').then((m) => m.PatientConsent) },
      {
        path: '',
        canActivate: [consentGuard],
        children: [
          { path: '', pathMatch: 'full', title: 'Hoy', loadComponent: () => import('./features/patient-app/today').then((m) => m.PatientToday) },
          { path: 'semana', title: 'Mi semana', loadComponent: () => import('./features/patient-app/week').then((m) => m.PatientWeek) },
          { path: 'platillo/:fecha/:item', title: 'Platillo', loadComponent: () => import('./features/patient-app/dish-detail').then((m) => m.PatientDish) },
          { path: 'progreso', title: 'Mi progreso', loadComponent: () => import('./features/patient-app/progress-docs-profile').then((m) => m.PatientProgress) },
          { path: 'documentos', title: 'Mis archivos', loadComponent: () => import('./features/patient-app/progress-docs-profile').then((m) => m.PatientDocuments) },
          { path: 'perfil', title: 'Mi perfil', loadComponent: () => import('./features/patient-app/progress-docs-profile').then((m) => m.PatientProfileView) },
        ],
      },
    ],
  },

  {
    path: '',
    canActivate: [roleGuard('nutritionist')],
    loadComponent: () => import('./core/layout/nutri-shell').then((m) => m.NutriShell),
    children: [
      { path: '', pathMatch: 'full', title: 'Inicio', loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard) },
      { path: 'pacientes', title: 'Pacientes', loadComponent: () => import('./features/patients/patient-list').then((m) => m.PatientList) },
      { path: 'pacientes/nuevo', title: 'Nuevo paciente', loadComponent: () => import('./features/patients/patient-create').then((m) => m.PatientCreate) },
      { path: 'pacientes/:id', title: 'Expediente', loadComponent: () => import('./features/patients/patient-detail').then((m) => m.PatientDetail) },
      { path: 'platillos', title: 'Platillos', loadComponent: () => import('./features/dishes/dish-library').then((m) => m.DishLibrary) },
      { path: 'platillos/nuevo', title: 'Nuevo platillo', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/dishes/dish-editor').then((m) => m.DishEditor) },
      { path: 'platillos/:id', title: 'Platillo', loadComponent: () => import('./features/dishes/dish-detail').then((m) => m.DishDetail) },
      { path: 'platillos/:id/editar', title: 'Editar platillo', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/dishes/dish-editor').then((m) => m.DishEditor) },
      { path: 'catalogo', title: 'Catálogo SMAE', loadComponent: () => import('./features/smae/catalog').then((m) => m.Catalog) },
      { path: 'planes', title: 'Planes', loadComponent: () => import('./features/meal-plans/plan-list').then((m) => m.PlanList) },
      { path: 'planes/nuevo', title: 'Nuevo plan', loadComponent: () => import('./features/meal-plans/plan-create').then((m) => m.PlanCreate) },
      { path: 'planes/:id', title: 'Editor de plan', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/meal-plans/plan-editor').then((m) => m.PlanEditor) },
      { path: 'seguimiento', title: 'Seguimiento', loadComponent: () => import('./features/tracking/tracking-feed').then((m) => m.TrackingFeed) },
      { path: 'reportes', title: 'Reportes', loadComponent: () => import('./features/reports/reports').then((m) => m.Reports) },
      { path: 'configuracion', title: 'Configuración', loadComponent: () => import('./features/settings/settings').then((m) => m.SettingsPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
