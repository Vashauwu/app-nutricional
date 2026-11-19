# CRM de contenido de la landing

Documento interno. **Estado: construido (fases L1 a L3 y restaurar versiones de L4).** Falta el rol de aprobación separado del de dueño. **Este documento no existía** aunque `crm-cuentas.md` y `analisis-flujo-consulta.md` lo citaban. Se redactó el
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

## Qué se construyó

| Fase | Entrega | Estado |
|---|---|---|
| **L1** | Tabla `landing_versions` (migración 000022), validación en el servidor, `GET/PUT draft`, `GET /api/v1/public/landing` (ETag) y consumo con respaldo en la landing | Hecho |
| **L2** | Pedir publicación con motivo, aprobar o rechazar con cuatro ojos, retirar, historial y bitácora (`platform.landing_*`) | Hecho |
| **L3** | Pantalla **Landing** del CRM: estado, editor por tipo de sección (reordenar, ocultar, agregar y quitar), errores por campo, revisión con las diferencias, historial y vista previa (`/vista-previa-landing`) | Hecho |
| **L4** | Restaurar una versión anterior como borrador | Hecho |
| **L4** | Rol de contenido (`platform_content`: edita y pide) separado del de aprobación (`platform:landing:publish`) | Hecho en permisos; falta un rol «aprobador» que no sea dueño |

Cómo se comporta:
- La landing sigue funcionando **sin la API**: `landing.content.ts` es el contenido de respaldo. Al cargar pide `GET /public/landing`; con un 404 (aún no hay nada publicado) o un error, no cambia nada.
- El servidor valida las reglas de arriba **al guardar, al pedir y otra vez al publicar**, y responde `422` con `error.fields` (campo → mensaje) para que la pantalla marque cada campo.
- Guardar el borrador borra el último rechazo (ya es otro texto). Rechazar devuelve el texto a borrador con la nota de quien rechazó. Solo quien pidió puede retirar su solicitud.
- Un borrador viejo restaurado puede no cumplir las reglas actuales: se detecta al pedir su publicación.

## Decisiones tomadas (revisables)

1. **Quién aprueba**: otra persona con `platform:landing:publish` (dueño y administrador heredado). Quien pidió nunca aprueba (`PLATFORM_ALLOW_SELF_APPROVAL` aplica igual que en dinero y deja marca).
2. **Publicación programada**: no. Se publica al aprobar.
3. **SEO**: la página carga primero el texto de respaldo y reemplaza por lo publicado; el contenido **no** se incrusta en el HTML en el despliegue. Si el SEO lo exige, es una fase aparte.
4. **Sección de precios**: no. La regla actual prohíbe precios (el servidor rechaza `$`, «mxn», «gratis»…) hasta aprobar los planes. Cuando se aprueben, lo recomendable es una sección `pricing` que lea de `plans/catalog.go`, para que la página nunca discrepe de lo que se cobra.
5. **Revisión legal**: no hay segunda aprobación especial para el pie legal ni las preguntas sobre datos de salud. Si se necesita, se agrega como un permiso más.

## Fuera de alcance (a propósito)

- Subir imágenes o logotipos desde el CRM (las ilustraciones son del código).
- HTML o Markdown libre, scripts de analítica o píxeles de terceros.
- Páginas nuevas (blog, precios, tarjeta pública del profesional).
- Pruebas A/B y programación de publicaciones por fecha.
- Multi-idioma.
- Tipos de sección nuevos (siguen siendo trabajo de código: componente, tipo y validación en el servidor).
