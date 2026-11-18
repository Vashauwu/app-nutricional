import { Injectable, computed, inject, signal } from '@angular/core';
import { BillingApi, Perks } from '../api/billing-api';
import { ApiClient } from '../api/api-client';

const FREE: Perks = { platformMark: true, allHandoutStyles: false, customAccent: false };
const FULL: Perks = { platformMark: false, allHandoutStyles: true, customAccent: true };

/**
 * Funciones según el plan de la consulta: una sola puerta para la interfaz. La regla vive en el servidor (catálogo de planes);
 * aquí solo se lee. Sin API (demostración) todo está disponible. Mientras carga, o si falla, se asume el plan Gratuito.
 */
@Injectable({ providedIn: 'root' })
export class Entitlements {
  private readonly billing = inject(BillingApi);
  private readonly api = inject(ApiClient);
  private readonly loaded = signal<Perks | null>(null);
  private started = false;

  readonly perks = computed<Perks>(() => (this.api.enabled ? (this.loaded() ?? FREE) : FULL));

  /** Pide el plan una sola vez por sesión de la pantalla; `force` vuelve a leerlo (p. ej. tras cambiar de plan). */
  load(force = false): void {
    if (!this.api.enabled || (this.started && !force)) return;
    this.started = true;
    this.billing.summary().subscribe({ next: (s) => this.loaded.set(s.plan.perks), error: () => { this.started = false; } });
  }
}
