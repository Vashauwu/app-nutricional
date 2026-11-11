import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

// '/auth/me' lo gestiona AuthService.restore() en el arranque: así una persona sin sesión puede abrir
// /recuperar o /restablecer/:token sin que se la mande a iniciar sesión.
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/password', '/auth/logout', '/auth/me'];

/**
 * Si la API responde 401 (access token vencido) se intenta UNA renovación con el
 * refresh token y se reintenta la petición. Si falla, la sesión terminó y se
 * manda a iniciar sesión. Solo actúa en modo API.
 */
export const refreshInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.apiMode || !req.url.startsWith('/api/') || NO_REFRESH.some((p) => req.url.includes(p))) return next(req);
  return next(req).pipe(
    catchError((err) => {
      if (err.status !== 401) return throwError(() => err);
      return auth.refresh().pipe(
        switchMap((ok) => {
          if (ok) return next(req);
          auth.sessionLost();
          void router.navigate(['/ingresar']);
          return throwError(() => err);
        }),
      );
    }),
  );
};
