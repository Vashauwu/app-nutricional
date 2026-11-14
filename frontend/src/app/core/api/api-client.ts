import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, finalize, share, throwError } from 'rxjs';

declare global {
  interface Window {
    NUTRI_CONFIG?: { apiMode?: 'mock' | 'api'; demoAccounts?: boolean };
  }
}

/** ¿La app habla con la API real? Se decide en public/config.js, sin recompilar. */
export const isApiMode = (): boolean => typeof window !== 'undefined' && window.NUTRI_CONFIG?.apiMode === 'api';

/**
 * ¿Se muestran las cuentas de demostración en el ingreso? Por omisión solo en modo simulado.
 * En staging se activa con `demoAccounts: true` en config.js (y existen porque `admin seed-demo-accounts` las crea).
 * En producción debe quedar apagado: no se anuncian cuentas ni contraseñas.
 */
export const showDemoAccounts = (): boolean => (typeof window === 'undefined' ? false : (window.NUTRI_CONFIG?.demoAccounts ?? !isApiMode()));

export const API = '/api/v1';

/** Error uniforme de la API (§21.6): código, mensaje y errores por campo. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function toApiError(e: unknown): ApiError {
  if (e instanceof HttpErrorResponse) {
    const d = (e.error as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    if (d?.message) return new ApiError(d.message, e.status, d.code ?? 'error', d.fields ?? {});
    if (e.status === 0) return new ApiError('No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.', 0, 'network');
    return new ApiError('Ocurrió un error inesperado. Inténtalo de nuevo.', e.status, 'error');
  }
  return e instanceof ApiError ? e : new ApiError('Ocurrió un error inesperado.', 500, 'error');
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  readonly enabled = isApiMode();

  private wrap<T>(o: Observable<T>): Observable<T> {
    return o.pipe(catchError((e) => throwError(() => toApiError(e))));
  }

  /** GET en curso, por ruta y parámetros: dos pantallas que piden lo mismo a la vez comparten una sola petición. */
  private readonly inflight = new Map<string, Observable<unknown>>();

  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Observable<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') p = p.set(k, String(v));
    const key = `${path}?${p.toString()}`;
    const pending = this.inflight.get(key);
    if (pending) return pending as Observable<T>;
    const shared = this.wrap(this.http.get<T>(API + path, { params: p })).pipe(
      // Al terminar (o fallar) se libera: la siguiente consulta siempre trae datos frescos.
      finalize(() => this.inflight.delete(key)),
      // Sin repetición: quien se suscriba cuando ya terminó vuelve a consultar en vez de recibir una copia vieja.
      share(),
    );
    this.inflight.set(key, shared);
    return shared;
  }
  /** Descarga un archivo (exportaciones y PDF): la sesión viaja en cookies, nunca en la URL. */
  blob(path: string, params?: Record<string, string | number | boolean | undefined>): Observable<Blob> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') p = p.set(k, String(v));
    return this.wrap(this.http.get(API + path, { params: p, responseType: 'blob' }));
  }
  post<T = void>(path: string, body?: unknown): Observable<T> {
    return this.wrap(this.http.post<T>(API + path, body ?? {}));
  }
  put<T>(path: string, body: unknown): Observable<T> {
    return this.wrap(this.http.put<T>(API + path, body));
  }
  patch<T>(path: string, body: unknown): Observable<T> {
    return this.wrap(this.http.patch<T>(API + path, body));
  }
  delete<T = void>(path: string): Observable<T> {
    return this.wrap(this.http.delete<T>(API + path));
  }
}
