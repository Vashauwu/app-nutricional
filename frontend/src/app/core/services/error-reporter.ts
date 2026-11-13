import { ErrorHandler, Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, API, isApiMode } from '../api/api-client';

const MAX_PER_SESSION = 10;
const SAME_ERROR_MS = 30_000;

/**
 * Registro de errores inesperados del navegador (§15). Los manda al backend (`/client-errors`), que los deja en su
 * registro con el request_id; no hay servicio externo ni se envían datos clínicos: solo mensaje técnico, pila y ruta.
 * Los errores esperados (validaciones, 4xx de la API, sin conexión) NO se reportan: ya se muestran a la persona.
 */
@Injectable()
export class ReportingErrorHandler implements ErrorHandler {
  private sent = 0;
  private readonly last = new Map<string, number>();

  handleError(error: unknown): void {
    console.error(error);
    try {
      this.report(error);
    } catch {
      // Reportar nunca debe provocar otro error.
    }
  }

  private report(error: unknown): void {
    if (!isApiMode() || error instanceof ApiError || error instanceof HttpErrorResponse) return;
    const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Error desconocido');
    // «Failed to fetch dynamic imported module»: una versión nueva reemplazó los archivos; basta recargar.
    if (/dynamically imported module|Importing a module script failed/i.test(e.message)) return;
    const now = Date.now();
    const key = e.message.slice(0, 200);
    if (this.sent >= MAX_PER_SESSION || now - (this.last.get(key) ?? 0) < SAME_ERROR_MS) return;
    this.last.set(key, now);
    this.sent++;
    void fetch(`${API}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ message: e.message, stack: e.stack ?? '', url: location.pathname }),
    }).catch(() => undefined);
  }
}
