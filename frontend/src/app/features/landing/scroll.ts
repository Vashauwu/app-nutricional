/** Desplaza a una sección de la misma página y mueve el foco allí (sin recargar ni cambiar la ruta). */
export function scrollToAnchor(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}
