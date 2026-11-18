# CRM de cuentas y suscripciones (fase 1)

Documento interno. Operación de la plataforma sobre las cuentas (consultas) y sus suscripciones. Es la primera fase del CRM
descrito en la hoja de ruta (M6); el CRM de contenido de la landing (`crm-landing.md`) **no** está construido.

## Qué hay

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

## Permisos

Permiso nuevo `platform:accounts`, solo del rol `platform_admin` (el mismo que administra el catálogo SMAE). Las cuentas con
ese rol se dan por CLI: `admin grant-platform-admin -email a@b.mx`. Las solicitudes viven en `platform_actions`, con seguridad
por filas que solo deja pasar a la plataforma: la consulta afectada no ve que se pidió algo sobre ella.

## Qué NO está (pendiente antes de dar acceso a más gente)

La especificación (`crm-landing.md`) pide cosas que esta fase **no** cumple todavía:

1. **Usuarios propios del CRM**, distintos de los de la aplicación. Hoy se entra con una cuenta de la aplicación que tenga el rol
   `platform_admin`. Debe limitarse a quien sea dueño o desarrollador del producto.
2. **Verificación en dos pasos (MFA)** para esos usuarios.
3. **Vista de varios ambientes** (staging y producción en una pantalla, con token por ambiente): hoy cada ambiente tiene su consola.
4. **Cuatro ojos en publicaciones** y el resto del ciclo de contenido: el **CRM de contenido de la landing** no existe.
5. Roles finos (`owner`, soporte, solo lectura) y registro de actividad global filtrable.
6. Un plan de cortesía sobre una cuenta con suscripción de pago activa **no cancela** esa suscripción en la pasarela: un cobro
   posterior puede volver a cambiar el plan. Cancelar primero (o esperar) antes de conceder cortesías a cuentas que pagan.

## Probarlo

```bash
admin grant-platform-admin -email a@b.mx           # dos personas distintas, para ver los cuatro ojos
./dc.sh staging exec api /app/admin grant-platform-admin -email otra@b.mx
# luego, con la sesión abierta en la aplicación: https://staging.nutrintegral.mx/api/v1/platform/console
```
