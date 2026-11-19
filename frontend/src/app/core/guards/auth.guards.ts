import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { Role } from '../../shared/models/domain';

/**
 * Los guards solo mejoran la experiencia: la autorización real vive en el
 * backend en cada operación (§2.2).
 */
/** Primera pantalla de la plataforma que esta sesión puede ver (null si no tiene ninguna). */
export const platformHome = (auth: AuthService): string | null =>
  auth.can('platform:read') ? '/plataforma' : auth.can('platform:landing:edit') || auth.can('platform:landing:publish') ? '/plataforma/landing' : null;

export const roleGuard =
  (role: Role): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isAuthenticated()) return router.createUrlTree(['/ingresar']);
    if (auth.role() === role) return true;
    // El equipo del CRM no tiene consulta: va a su zona (o, sin ningún permiso, de vuelta al ingreso, sin ciclos).
    if (auth.isPlatformStaff()) return router.createUrlTree([platformHome(auth) ?? '/ingresar']);
    return router.createUrlTree([auth.role() === 'patient' ? '/paciente' : '/']);
  };

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return true;
  if (auth.isPlatformStaff()) { const home = platformHome(auth); return home ? router.createUrlTree([home]) : true; }
  return router.createUrlTree([auth.role() === 'patient' ? '/paciente' : '/']);
};

/** El expediente permanece restringido hasta cumplir las aceptaciones (§4.1). */
export const consentGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.pendingConsents(auth.patientId()).length ? router.createUrlTree(['/paciente/consentimiento']) : true;
};

/** Zona de la plataforma: solo quien tiene el permiso. El servidor valida igual en cada llamada. */
export const permissionGuard =
  (...permissions: string[]): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isAuthenticated()) return router.createUrlTree(['/ingresar']);
    if (permissions.some((p) => auth.can(p))) return true;
    // Sin el permiso: a lo que sí puede ver (el equipo) o al inicio (una nutrióloga).
    return router.createUrlTree([auth.isPlatformStaff() ? (platformHome(auth) ?? '/ingresar') : '/']);
  };
