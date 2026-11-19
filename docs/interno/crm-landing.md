# CRM de contenido de la landing (propuesta, no construido)

Documento interno. **Este documento no existía** aunque `crm-cuentas.md` y `analisis-flujo-consulta.md` lo citaban. Se redactó el
18/11/2026 **a partir de lo que ya hay en el código** (la landing, el patrón de cuatro ojos y la bitácora), no de una especificación
anterior: si existe una versión original, hay que reconciliarla con esta. Lo marcado como **decisión abierta** necesita respuesta
de producto antes de construir.

## Para qué sirve

Hoy el texto de la landing vive en `frontend/src/app/features/landing/landing.content.ts` ([guía](../landing.md)). Cambiar una
frase exige editar código, pasar CI y desplegar. El CRM de contenido permite que una persona autorizada **edite, revise y publique**
el contenido de la landing sin tocar el repositorio, con las mismas garantías que ya tiene el CRM de cuentas: nada se publica sin que
**otra persona** lo apruebe, y todo queda en la bitácora.

No es un gestor de contenido general. Edita **solo** lo que `landing.content.ts` ya modela.

## Qué se edita (el modelo ya existe)

`LANDING_SECTIONS` es una lista ordenada de secciones tipadas; cada una tiene `id`, `nav?` y `enabled?`:

| Tipo | Campos editables |
|---|---|
| `hero` | título, texto, acciones (etiqueta, destino, estilo), nota |
| `intro` | título, texto, puntos (título, texto) |
| `features` | título, texto, elementos (ícono, título, texto) |
| `steps` | título, elementos (título, texto) |
| `preview` | título, texto, viñetas, leyenda (las ilustraciones son del código, no se suben) |
| `principles` | título, elementos (ícono, título, texto) |
| `faq` | título, preguntas y respuestas |
| `cta` | título, texto, acción, nota |

Además `LANDING_META` (título y descripción de la página) y `LANDING_FOOTER` (aviso legal y enlaces). Se puede **reordenar**, **ocultar**
(`enabled: false`) y **agregar** una sección de un tipo existente. **Crear un tipo nuevo de sección sigue siendo trabajo de código.**

## Reglas del contenido (se validan en el servidor, no solo en la pantalla)

Son las que hoy vigila `landing.content.spec.ts`, más las de seguridad:

1. **Solo lo que el producto hace hoy** (`PRODUCT.md`): sin precios, cifras, testimonios ni certificaciones inventados. El servidor
   rechaza la publicación si el texto contiene las palabras vigiladas (la misma lista que la prueba) y muestra cuál.
2. Exactamente **un `hero`**, y es el primero. Ids de sección únicos y con formato de ancla (`[a-z0-9-]`).
3. **Destinos permitidos**: anclas de una sección **activa** (`#como-funciona`) o rutas internas conocidas (`/ingresar`, `/registro`,
   `/privacidad`, `/terminos`). **Nunca** URL externas ni `javascript:` (lista cerrada, no lista de rechazo).
4. **Todo es texto plano.** Sin HTML ni Markdown: la landing lo pinta con interpolación de Angular, así que un texto malicioso no
   puede ejecutar nada. Longitudes máximas por campo (título 120, texto 600, respuesta de FAQ 800).
5. Íconos solo de la lista de `IconName`.
6. Si algo no valida, **la landing sigue mostrando la versión publicada anterior**; nunca queda una página rota.

## Ciclo de vida: borrador → revisión → publicada (cuatro ojos)

```
borrador ──(pedir publicación, con motivo)──▶ pendiente ──(otra persona aprueba)──▶ publicada
                                                  └──(rechaza, con nota)──▶ borrador
```

- Hay **un borrador activo a la vez** (se parte siempre de lo publicado). Editarlo no afecta a nadie.
- Quien pide la publicación **no** puede aprobarla (misma regla y mismo error `self_approval` que las acciones de dinero).
  `PLATFORM_ALLOW_SELF_APPROVAL` aplica igual y deja marca de autoaprobación.
- Al aprobar se publica **al instante** y se guarda como una **versión inmutable**. Cada versión conserva quién la pidió, quién la
  aprobó, cuándo y la nota. **Volver a una versión anterior** crea una versión nueva con ese contenido (no reescribe la historia) y
  también requiere cuatro ojos.
- Una **vista previa** del borrador (`/plataforma/landing/vista-previa`) muestra la landing real con el contenido del borrador y un
  aviso visible; solo la ve quien tiene permiso.

## Datos (propuesta)

Una migración, compatible hacia atrás:

```
landing_versions
  id uuid pk, number int unique (consecutivo),
  status text  -- draft | pending | published | rejected | superseded
  content jsonb not null          -- { meta, sections, footer }
  reason text, requested_by uuid, requested_at,
  decided_by uuid, decided_at, decision_note text, published_at
```

No lleva `practice_id`: es contenido **de la plataforma**, no de una consulta. Por la guarda de M1 contra tablas sin aislamiento,
se declara explícitamente como tabla global (como `platform_actions`, con seguridad por filas que solo deja pasar a la plataforma
para escribir). La lectura pública es **solo de la versión publicada**.

## API (propuesta)

Con permiso nuevo `platform:landing` (solo `platform_admin` al inicio; ver «Roles»):

| Método y ruta | Qué hace |
|---|---|
| `GET /platform/landing` | Publicada, borrador activo y pendiente (si hay). |
| `PUT /platform/landing/draft` | Guarda el borrador (valida las reglas; `422` con la lista de errores por campo). |
| `POST /platform/landing/request` | Pide la publicación (motivo ≥ 10 caracteres). |
| `POST /platform/landing/:id/decision` | Aprueba o rechaza (nota opcional). |
| `GET /platform/landing/versions` | Historial. |
| `POST /platform/landing/versions/:n/restore` | Crea un borrador con esa versión. |
| `GET /api/v1/public/landing` | **Pública**, sin sesión: la versión publicada, con `ETag` y `Cache-Control` corto. |

Cada paso escribe en la bitácora global (`platform.landing_*`), que ya se ve en **Actividad**.

## Cómo la consume la landing

La landing sigue funcionando **sin la API**: `landing.content.ts` se conserva como **contenido de respaldo** empaquetado. Al cargar,
pide `GET /public/landing`; si responde, usa esa versión; si falla o tarda, usa la de respaldo (sin parpadeo ni pantalla vacía).
Así un fallo del CRM no puede dejar la página pública sin contenido, y SEO/primera pintura no dependen de la red (**decisión abierta:**
si el contenido publicado debe incrustarse en el HTML en el despliegue para que los buscadores lo lean sin ejecutar JavaScript).

## Pantallas (Angular + Taiga, dentro de `/plataforma`)

1. **Landing** (nueva entrada del menú): lista de secciones con arrastrar para reordenar, interruptor de visible, y estado
   (publicada / borrador con cambios / pendiente de aprobación).
2. **Editor de sección**: formulario por tipo, con contador de caracteres y errores de validación en el campo.
3. **Vista previa** a pantalla completa.
4. **Revisión**: diferencia entre publicada y borrador (campo por campo), motivo, aprobar o rechazar. Se integra con **Aprobaciones**
   para que quien aprueba vea todo lo pendiente en un solo lugar.
5. **Historial** de versiones con quién publicó cada una y botón de restaurar.

## Roles y accesos

Al inicio, el mismo `platform_admin`. Cuando existan **usuarios propios del CRM y roles finos** (pendientes en `crm-cuentas.md`), este
módulo pasa a un rol de **contenido** (puede editar y pedir) distinto del de **aprobación** (puede publicar). La separación pedir ≠
aprobar ya está resuelta por persona; el rol fino solo añade quién *puede* aprobar.

## Fases de construcción

| Fase | Entrega | Depende de |
|---|---|---|
| **L1** | Tabla, validación de reglas, `GET/PUT draft`, versión publicada pública y consumo con respaldo en la landing | — |
| **L2** | Pedir publicación, aprobar/rechazar con cuatro ojos, historial y bitácora | L1 |
| **L3** | Pantallas del CRM: lista, editor por tipo, vista previa y revisión | L1, L2 |
| **L4** | Restaurar versiones, rol de contenido separado del de aprobación | usuarios propios del CRM |

## Fuera de alcance (a propósito)

- Subir imágenes o logotipos desde el CRM (las ilustraciones son del código).
- HTML o Markdown libre, scripts de analítica o píxeles de terceros.
- Páginas nuevas (blog, precios, tarjeta pública del profesional). La **tarjeta pública** (`analisis-flujo-consulta.md`, fase B) es un
  producto aparte que puede reutilizar este flujo de aprobación, pero define su propio contenido por profesional.
- Pruebas A/B y programación de publicaciones por fecha.
- Multi-idioma.

## Decisiones abiertas

1. ¿Quién aprueba textos? ¿Basta otra persona con `platform_admin`, o debe ser el dueño del producto?
2. ¿Publicación **programada** (p. ej. coordinada con un lanzamiento) o solo inmediata?
3. ¿La landing debe servirse con el contenido incrustado en el HTML (SEO) o basta con cargarlo al abrir?
4. Precios en la landing: la regla actual los prohíbe hasta aprobar los planes (`registro-y-planes-mvp.md`). ¿Se habilita una sección
   `pricing` que lea de `plans/catalog.go` para que **nunca** discrepe de lo que se cobra?
5. ¿Se necesita revisión legal obligatoria (segunda aprobación) cuando cambian el pie legal o las FAQ sobre datos de salud?
