import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient } from '../api/api-client';

/**
 * Lo que el servidor decide por ambiente y la interfaz debe respetar. Hoy: si el catálogo SMAE oficial está encendido.
 * Sin API (demostración) está encendido; con API y mientras carga se asume apagado (nunca se muestra de más).
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly api = inject(ApiClient);
  private readonly loaded = signal<boolean | null>(null);
  private started = false;

  readonly smaeEnabled = computed(() => (this.api.enabled ? (this.loaded() ?? false) : true));

  load(): void {
    if (!this.api.enabled || this.started) return;
    this.started = true;
    this.api.get<{ smae_enabled?: boolean }>('/auth/options').subscribe({
      next: (o) => this.loaded.set(o.smae_enabled === true),
      error: () => { this.started = false; },
    });
  }
}
