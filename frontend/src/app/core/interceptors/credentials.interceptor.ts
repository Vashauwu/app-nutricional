import { HttpInterceptorFn } from '@angular/common/http';

/**
 * La sesión viaja en cookies HttpOnly (§5.1); nunca se guardan tokens en
 * localStorage/sessionStorage. Solo las llamadas a la API llevan credenciales.
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.url.startsWith('/api/') ? req.clone({ withCredentials: true }) : req);
