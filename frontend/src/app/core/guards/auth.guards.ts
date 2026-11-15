import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { Role } from '../../shared/models/domain';

/**
 * Los guards solo mejoran la experiencia: la autorización real vive en el
 * backend en cada operación (§2.2).
 */
export const roleGuard =
  (role: Role): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isAuthenticated()) return router.createUrlTree(['/ingresar']);
    if (auth.role() === role) return true;
    return router.createUrlTree([auth.role() === 'patient' ? '/paciente' : '/']);
  };

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return true;
  return router.createUrlTree([auth.role() === 'patient' ? '/paciente' : '/']);
};

/** El expediente permanece restringido hasta cumplir las aceptaciones (§4.1). */
export const consentGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.pendingConsents(auth.patientId()).length ? router.createUrlTree(['/paciente/consentimiento']) : true;
};
