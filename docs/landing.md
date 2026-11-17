# Landing pública

Rutas: `/` para quien aún no inició sesión (con sesión, `/` sigue siendo el panel) y `/inicio` siempre.

## Cómo editarla
Todo el contenido salvo el menú superior está en [`landing.content.ts`](../frontend/src/app/features/landing/landing.content.ts):

- **Cambiar un texto:** editar el objeto de la sección.
- **Ocultar una sección:** `enabled: false`. **Reordenar:** cambiar el orden de `LANDING_SECTIONS`.
- **Menú superior:** se arma solo con las secciones que tienen `nav`.
- **Sección nueva:** un componente en `features/landing/sections/`, su tipo en `landing.content.ts` y un `@case` en `landing.ts`.
- Datos de la página (título, descripción): `LANDING_META`. Pie de página: `LANDING_FOOTER`.

## Reglas del contenido
Solo lo que el producto hace hoy. Sin testimonios, precios, cifras ni certificaciones inventados (hay una prueba que lo vigila).
Cuando existan, se agregan como sección nueva (p. ej. `pricing`, `testimonials`) con su propio componente.
Las ilustraciones (`mock-week`, `mock-day`) usan datos ficticios y son decorativas (`aria-hidden`).
