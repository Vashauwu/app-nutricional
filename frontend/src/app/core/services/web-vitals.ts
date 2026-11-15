import { API, isApiMode } from '../api/api-client';

type Name = 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
type Rating = 'good' | 'needs-improvement' | 'poor';

// Umbrales oficiales de Core Web Vitals (web.dev): [bueno, deficiente].
const THRESHOLDS: Record<Name, [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

const rate = (name: Name, value: number): Rating => (value <= THRESHOLDS[name][0] ? 'good' : value <= THRESHOLDS[name][1] ? 'needs-improvement' : 'poor');

/**
 * Velocidad real en el navegador de cada persona (LCP, CLS, INP, FCP y TTFB) sin dependencias externas.
 * Se envía una sola vez por visita, cuando la pestaña se oculta o se cierra, a `/client-metrics`; el backend
 * la deja en su registro junto con la ruta (sin datos personales). Solo en modo API y navegadores compatibles.
 */
export function startWebVitals(): void {
  if (!isApiMode() || typeof PerformanceObserver === 'undefined' || typeof document === 'undefined') return;

  const values: Partial<Record<Name, number>> = {};
  const observe = (type: string, cb: (entries: PerformanceEntryList) => void, extra: Record<string, unknown> = {}): void => {
    try {
      new PerformanceObserver((list) => cb(list.getEntries())).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch {
      // Tipo de entrada no disponible en este navegador: esa métrica simplemente no se mide.
    }
  };

  observe('largest-contentful-paint', (es) => { const last = es[es.length - 1]; if (last) values.LCP = last.startTime; });
  observe('paint', (es) => { const fcp = es.find((e) => e.name === 'first-contentful-paint'); if (fcp) values.FCP = fcp.startTime; });
  observe('layout-shift', (es) => {
    for (const e of es as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) values.CLS = (values.CLS ?? 0) + e.value;
  });
  // Aproximación de INP: la interacción más lenta de la visita.
  observe('event', (es) => {
    for (const e of es as (PerformanceEntry & { interactionId?: number })[]) if (e.interactionId) values.INP = Math.max(values.INP ?? 0, e.duration);
  }, { durationThreshold: 40 });
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav && nav.responseStart > 0) values.TTFB = nav.responseStart;

  let sent = false;
  const flush = (force = false): void => {
    if (sent || (!force && document.visibilityState !== 'hidden')) return;
    sent = true;
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? '';
    for (const [name, value] of Object.entries(values) as [Name, number][]) {
      void fetch(`${API}/client-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ name, value: Math.round(value * 1000) / 1000, rating: rate(name, value), url: location.pathname, connection }),
      }).catch(() => undefined);
    }
  };
  document.addEventListener('visibilitychange', () => flush());
  addEventListener('pagehide', () => flush(true));
}
