import { Injectable, effect, inject, signal } from '@angular/core';
import { DbService } from '../data/db.service';
import { ThemeService } from './theme.service';

// ---------- Toasts ----------
export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  show(message: string, kind: Toast['kind'] = 'ok', ms = 4500): void {
    const id = ++this.seq;
    this.toasts.update((t) => [...t, { id, kind, message }]);
    setTimeout(() => this.dismiss(id), ms);
  }

  ok = (m: string): void => this.show(m, 'ok');
  error = (m: string): void => this.show(m, 'error', 7000);
  info = (m: string): void => this.show(m, 'info');

  dismiss(id: number): void {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}

// ---------- Confirmación ----------
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  tone: 'default' | 'danger';
  resolve: (ok: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly request = signal<ConfirmRequest | null>(null);

  ask(opts: { title: string; message: string; confirmLabel?: string; tone?: 'default' | 'danger' }): Promise<boolean> {
    return new Promise((resolve) => {
      this.request.set({
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirmar',
        tone: opts.tone ?? 'default',
        resolve: (ok) => {
          this.request.set(null);
          resolve(ok);
        },
      });
    });
  }
}

// ---------- Marca dinámica (§19.2) ----------
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export const isHex = (v: string): boolean => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());

@Injectable({ providedIn: 'root' })
export class BrandService {
  private readonly data = inject(DbService);
  private readonly theme = inject(ThemeService);

  constructor() {
    effect(() => {
      const b = this.data.db().settings.brand;
      const root = document.documentElement.style;
      // En modo oscuro se usa la paleta propia: un color de marca pensado para fondo claro perdería contraste.
      if (this.theme.dark()) {
        ['--brand-primary', '--tui-background-accent-1', '--tui-text-action', '--tui-border-focus', '--brand-secondary'].forEach((v) => root.removeProperty(v));
        document.title = `${b.businessName} · Gestión nutricional`;
        return;
      }
      if (isHex(b.primary) && contrastRatio(b.primary, '#FAF7F2') >= 4.5) {
        root.setProperty('--brand-primary', b.primary);
        root.setProperty('--tui-background-accent-1', b.primary);
        root.setProperty('--tui-text-action', b.primary);
        root.setProperty('--tui-border-focus', b.primary);
      }
      if (isHex(b.secondary)) root.setProperty('--brand-secondary', b.secondary);
      document.title = `${b.businessName} · Gestión nutricional`;
    });
  }
}
