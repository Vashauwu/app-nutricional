import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

declare global {
  interface Window {
    NUTRI_CONFIG?: { apiMode?: 'mock' | 'api' };
  }
}

/** ¿La app habla con la API real? Se decide en public/config.js, sin recompilar. */
export const isApiMode = (): boolean => typeof window !== 'undefined' && window.NUTRI_CONFIG?.apiMode === 'api';

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

  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Observable<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') p = p.set(k, String(v));
    return this.wrap(this.http.get<T>(API + path, { params: p }));
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
