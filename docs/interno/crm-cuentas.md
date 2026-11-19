# CRM de la plataforma: cuentas, equipo y landing

Documento interno. Operación de la plataforma sobre las cuentas (consultas) y sus suscripciones. Es la primera fase del CRM
descrito en la hoja de ruta (M6). El **equipo propio** del CRM (roles finos) y la **landing gestionada con cuatro ojos** también están construidos; ver [`crm-landing.md`](crm-landing.md).

## Panel (Angular + Taiga UI)

Entrada: `/plataforma` en la propia aplicación. Las personas del equipo entran directo ahí al iniciar sesión; una nutrióloga con rol de plataforma lo ve en el menú de la cuenta → «Panel de plataforma» (permiso `platform:read`). El menú de la zona solo ofrece lo que cada rol puede abrir.
Es una zona lazy con el mismo sistema visual (marfil, ciruela, Inter/Playfair, modo oscuro) y componentes de Taiga UI.

- **Resumen**: cuentas, ingreso mensual **estimado** (precio de lista; anual ÷ 12; sin cortesías ni pruebas), altas por día (30 días),
  cuentas por plan y por estado, pruebas por vencer, cobros fallidos, cobros recientes, uso y solicitudes por aprobar.
  Viene de `GET /api/v1/platform/overview`.
- **Cuentas**: búsqueda, filtros por plan y acceso, paginación; en móvil pasa a tarjetas.
- **Ficha**: plan, uso frente a límites, cobros, solicitudes y bitácora; acciones (cortesía, prórroga, reembolso, suspender/reactivar).
- **Aprobaciones**: pendientes e historial; aprobar/rechazar con nota, y filtro por tipo de solicitud. El error de autoaprobación se muestra tal cual.
- **Actividad** (`/plataforma/actividad`, `GET /api/v1/platform/activity`): bitácora **global** de todas las cuentas, filtrable por texto (evento, consulta o correo), tipo (accesos, cobros, plataforma), rango de fechas y cuenta (`?cuenta=<id>`, enlazada desde la ficha). Solo muestra eventos **operativos** (`auth`, `billing`, `platform`): el servidor nunca entrega eventos clínicos, aunque se pidan. Ventana máxima de un año.
- **Equipo** (`/plataforma/equipo`, `GET/POST /platform/staff`): invitar a una persona (correo, nombre y rol), cambiar su rol, reenviar la invitación, deshabilitarla o habilitarla. Solo con `platform:staff`. Ver «Equipo y roles».
- **Landing** (`/plataforma/landing`): editor del texto de la página pública, revisión con cuatro ojos, historial y vista previa. Ver [`crm-landing.md`](crm-landing.md).
- **Cuentas ordenables** por consulta, plan, pacientes y alta (clic en el encabezado; `aria-sort` y orden fijado en el servidor con lista cerrada de columnas).

La consola ligera de abajo (`/api/v1/platform/console`) sigue existiendo como respaldo; el panel la sustituye en el uso diario.

## Qué hay (consola ligera)

**Consola**: `/api/v1/platform/console` (se abre con la sesión de una persona con rol `platform_admin`; `/api` ya pasa al API
por el proxy, no hay que tocar nada). Se sirve desde el binario de la API, **no** desde el paquete de la aplicación pública, y con
una política de contenido estricta (sin scripts ni estilos en línea; los datos de las cuentas se insertan como texto).
Sin sesión de plataforma ni siquiera se entrega el HTML (401/403).

- **Cuentas**: búsqueda por nombre de consulta o correo, filtros por plan y estado, plan contratado vs. plan vigente, estado
  (en prueba, activo, cobro fallido, cancelado, vencido), cortesía y pacientes activos.
- **Ficha**: titular, plan, estado y fecha, tarjeta, pasarela, uso (pacientes, archivos), cobros y actividad reciente de la cuenta.
- **Suspender / reactivar** (inmediato, con motivo): la consulta suspendida no puede abrir sesión ni usar la API (también por
  Google), y se cierran sus sesiones. **No se borra nada.**
- **Acciones que cuestan dinero**, con **cuatro ojos**: *plan de cortesía* (hasta 366 días), *prórroga de prueba* (hasta 30 días)
  y *reembolso*. Las pide una persona con un motivo (mínimo 10 caracteres) y las aprueba **otra**; al aprobar se ejecutan en el
  acto. Si falla la ejecución queda como «falló» con su causa. Quien pidió no puede aprobar (403); una solicitud ya resuelta no
  se resuelve dos veces aunque dos personas hagan clic a la vez.
- **Bitácora**: cada paso (pedir, aprobar, rechazar, ejecutar, suspender) queda en la bitácora de la consulta con quién lo hizo.
  Una autoaprobación (solo posible con `PLATFORM_ALLOW_SELF_APPROVAL=true`) queda marcada.

## Equipo y roles

Las personas del CRM **no son nutriólogas**: viven en una «consulta de plataforma» propia (una sola, `practices.is_platform`), sin pacientes ni plan, y **no** aparece como cliente en Cuentas, el resumen ni las métricas ni se puede suspender. No tienen el rol de nutrióloga, así que no ven ningún dato clínico. Se invitan con un enlace de un solo uso (7 días); sin correo configurado el enlace se muestra a quien invita para que lo comparta.

| Rol | Puede |
|---|---|
| **Dueño** (`platform_owner`) | Todo: cuentas, aprobar, equipo, landing. |
| **Soporte** (`platform_support`) | Ver cuentas y operar (suspender, pedir cortesías/prórrogas/reembolsos). **No aprueba.** |
| **Solo lectura** (`platform_viewer`) | Ver el panel; no cambia nada. |
| **Contenido** (`platform_content`) | Editar la landing y pedir su publicación; no ve cuentas. |
| **Administrador heredado** (`platform_admin`) | Equivale a dueño. Es el rol que ya existía (`admin grant-platform-admin`); nadie lo pierde. Se puede reasignar. |

Permisos (migración 000021): `platform:read` (ver), `platform:accounts` (operar), `platform:approve` (aprobar solicitudes de dinero), `platform:staff` (administrar el equipo), `platform:landing:edit` y `platform:landing:publish`. El servidor valida cada uno; la interfaz solo oculta lo que no se puede usar. Quien pidió una acción puede **retirarla** sin tener permiso de aprobar.

Reglas del equipo: nadie cambia ni deshabilita **su propio** acceso; nunca queda la plataforma sin **al menos una persona activa con control total**; deshabilitar cierra sus sesiones (no borra nada); todo queda en **Actividad** (`platform.staff_*`). El primer dueño se crea con la CLI: `admin create-platform-staff -email a@b.mx -name "Nombre" -role platform_owner` (contraseña en `NEW_USER_PASSWORD`; ver `deploy/README.md` para producción) y desde ahí se invita al resto desde **Equipo**. `admin grant-platform-admin` sigue existiendo para dar el rol heredado a una cuenta de nutrióloga que ya existe.

## Qué NO está

1. **Verificación en dos pasos (MFA)**: descartada por ahora (decisión de producto). Se retoma antes de dar acceso a terceros fuera del equipo.
2. **Vista de varios ambientes** (staging y producción en una pantalla, con token por ambiente): cada ambiente tiene su panel.
3. Un rol de **aprobación de contenido** distinto del de dueño (hoy aprueba quien tenga `platform:landing:publish`, o sea dueño y administrador heredado).
4. ~~Cortesía sobre una cuenta que paga~~ **Resuelto**: al ejecutar una cortesía, si la cuenta tiene una suscripción viva en la pasarela se **cancela primero** allá (queda en la bitácora como `platform.provider_subscription_canceled`). Si la cancelación falla, la cortesía **no se concede** y la solicitud queda como «falló» con la causa.

## Probarlo

```bash
admin grant-platform-admin -email a@b.mx           # dos personas distintas, para ver los cuatro ojos
./dc.sh staging exec api /app/admin grant-platform-admin -email otra@b.mx
# luego, con la sesión abierta en la aplicación: https://staging.nutrintegral.mx/plataforma
# desde «Equipo» el dueño invita a soporte, lectura o contenido (cada uno entra por su enlace)
```
