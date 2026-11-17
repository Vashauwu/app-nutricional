# Registro abierto y planes (MVP)

Documento interno. Describe lo que hace la rama `feat/registro-y-facturacion`, cómo probarlo en staging y qué falta
para abrirlo en producción. Depende de las cuentas aisladas (`docs/interno/m1-cuentas-aisladas.md`).

## Qué hace

1. **Registro** (`/registro`): una nutrióloga crea su cuenta con nombre, correo y contraseña, aceptando términos y aviso
   de privacidad. Se abre **su propia consulta** (aislada) con el **plan Gratuito**.
2. **Confirmación de correo** (`/verificar/<token>`): la cuenta queda pendiente hasta abrir el enlace del correo (24 h,
   un solo uso). Sin confirmar no se puede ingresar; el ingreso lo explica.
3. **Facturación** (`/facturacion`, menú lateral y menú de la cuenta): plan actual, uso frente a los límites y los tres
   planes con precio mensual y anual. «Quiero este plan» solo **anota el interés** en la bitácora
   (`billing.plan_interest`): todavía no hay cobro.
4. **Límites del plan**, validados en el servidor:
   - pacientes activos (no cuentan los archivados),
   - espacio total de archivos de la consulta,
   - fotografías de seguimiento (no incluidas en el plan Gratuito).
   Al rebasarlos la API responde `402` con un código `plan_limit_*` y un mensaje que manda a Facturación.
5. **Catálogo SMAE global**: el permiso `smae:manage` ya no es del rol de nutrióloga. Pasa al rol nuevo
   `platform_admin`. Las cuentas que existían antes de la migración lo conservan; las cuentas nuevas no lo tienen.

## Planes

Definidos en `backend/internal/plans/catalog.go` (una sola fuente: la pantalla y la validación leen de ahí).

| Plan | Mensual | Anual | Pacientes activos | Archivos | Fotos de seguimiento |
|---|---|---|---|---|---|
| Gratuito | $0 | $0 | 15 | 300 MB | No |
| Estándar | $299 | $2,870 | 80 | 5 GB | Sí |
| Pro | $549 | $5,270 | Sin tope | 50 GB | Sí |

Los precios y límites son la **propuesta de lanzamiento, pendiente de aprobación**. La lista de funciones de cada plan
solo debe anunciar lo que el sistema ya cumple o limita.

Las consultas que existían antes de la migración `000014` quedan en **Pro**. Toda consulta nueva nace en **Gratuito**.

## Configuración por ambiente

| Variable | Omisión | Uso |
|---|---|---|
| `SIGNUP_ENABLED` | `false` | Abre el registro. Apagado, `/registro` muestra «Registro no disponible» y el ingreso no lo enlaza. |
| `SIGNUP_REQUIRE_EMAIL_VERIFICATION` | `true` | En `false` la cuenta nace activa y entra directo. Solo se acepta en desarrollo o con `ALLOW_DEMO_ACCOUNTS=true` (staging); en producción real la API no arranca. |

La pantalla pregunta al servidor (`GET /api/v1/auth/options`): no hay bandera aparte en el frontend.

## Probarlo en staging

No hay que tocar el servidor: al liberar en staging, `release.sh` escribe en `.env.staging` (solo si faltan)
`SIGNUP_ENABLED=true`, `SIGNUP_REQUIRE_EMAIL_VERIFICATION=false` y `ALLOW_DEMO_ACCOUNTS=true`. Producción no se toca: ahí el
registro sigue apagado hasta activarlo a mano.

**Por qué sin confirmación en staging.** Su remitente de pruebas de Resend **solo entrega al correo de la cuenta de
Resend**, así que un Gmail cualquiera no recibiría el enlace. Sin confirmación la cuenta entra directo. Para probar el
flujo con correo, pon `SIGNUP_REQUIRE_EMAIL_VERIFICATION=true` en `.env.staging` y regístrate con el correo de Resend.

Guion de la prueba:

1. Abre `/ingresar` → «Crea tu cuenta gratis» → llena el formulario.
2. Confirma el correo (o entra directo si apagaste la confirmación).
3. Debes ver el **inicio guiado** y después una consulta **vacía**: sin pacientes, platillos ni planes de nadie.
4. `/facturacion`: plan Gratuito, 0 de 15 pacientes, los tres planes.
5. En otra ventana entra con la cuenta principal: sus datos siguen ahí y no aparece nada de la cuenta nueva.
6. En la cuenta nueva crea un paciente y un platillo; confirma que la cuenta principal no los ve.
7. Opcional: crea 15 pacientes; el 16.º debe rechazarse con el mensaje del plan.

## Operación (CLI)

```bash
admin set-plan -email a@b.mx -plan pro -period annual   # cambia el plan de la consulta de esa cuenta
admin grant-platform-admin -email a@b.mx                # permite administrar el catálogo SMAE global
```

`seed-demo-accounts` deja la cuenta de ejemplo en Pro y con administración del catálogo.

## Decisiones

- **Mismo mensaje exista o no el correo** (con confirmación activa): el registro no revela quién tiene cuenta. Un correo
  ya registrado y pendiente recibe un enlace nuevo; uno ya activo no recibe nada.
- **El enlace de confirmación reutiliza los tokens de recuperación** (misma tabla, hash, un solo uso). Restablecer la
  contraseña también activa la cuenta: ambos prueban que el correo es de la persona.
- **Los límites viven en el servidor.** La pantalla solo los muestra.
- **Aceptación de términos**: queda en la bitácora (`auth.signup`, `terms_accepted`).
- Registro limitado a 10 intentos por hora por IP.

## Lo que falta antes de abrirlo en producción

- **Dominio de correo verificado** (`docs/correo-produccion.md`): sin él los enlaces no llegan a cualquier destinatario.
- **Textos legales validados**: términos y aviso de privacidad de la plataforma, y los textos marcadores de consentimiento
  con los que nace cada consulta.
- **Cobro** (Conekta), prueba de 14 días con tarjeta y **CFDI**: hoy un plan de pago solo se asigna con `admin set-plan`.
- **Protección contra abuso** más allá del límite por IP (captcha o similar) y limpieza de cuentas nunca confirmadas.
- **Bajar de plan**: no hay regla aún para una consulta que excede los límites del plan destino.
- **Página pública**: los botones aún llevan a «Ingresar»; falta el llamado a «Crear cuenta».
- Aprobar precios y límites.

## «Continuar con Google» (nutriólogas)

Botón oficial de Google Identity Services en `/ingresar` y `/registro`. Si la cuenta de Google ya tiene cuenta en la
plataforma, entra; si no, y el registro está abierto, abre una consulta gratuita. Google ya verificó el correo, así que no
hay confirmación aparte.

**Cómo funciona y qué valida el servidor** (`POST /api/v1/auth/google`): firma del ID token con las llaves públicas de
Google, emisor, audiencia (nuestro ID de cliente), vigencia y `email_verified`. Nada del navegador se toma por bueno.
- Solo cuentas de **nutrióloga**: una cuenta de paciente o deshabilitada no entra por Google.
- Cuenta nueva: exige aceptar términos y aviso. En `/registro` el aviso está junto al botón y pulsarlo es la aceptación;
  en `/ingresar` no (si no hay cuenta, se manda a `/registro`).
- Un registro por correo que seguía sin confirmar se activa al entrar con Google (prueba que el correo es suyo).
- La cuenta nueva tiene una contraseña aleatoria inutilizable; si después la quiere, usa «Olvidé mi contraseña».
- El botón solo existe si hay `GOOGLE_CLIENT_ID`; el frontend lo pregunta a `GET /api/v1/auth/options`.

### Configurarlo (una sola vez)
1. En Google Cloud Console → **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**, tipo
   **Aplicación web**. (Si pide pantalla de consentimiento: tipo Externo, nombre de la app, correo de soporte y los
   enlaces de privacidad y términos; con solo `email` y `profile` no requiere verificación de Google.)
2. En **Orígenes de JavaScript autorizados** agrega `https://staging.nutrintegral.mx` y `https://app.nutrintegral.mx`
   (y `http://localhost:4200` para desarrollo). No se necesitan URI de redireccionamiento.
3. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`; es público, no es un secreto).
4. En GitHub → **Settings → Environments → staging → Environment variables** crea `GOOGLE_CLIENT_ID` con ese valor.
   Haz lo mismo en `production` cuando quieras abrirlo ahí. El siguiente despliegue lo escribe en el `.env` del servidor.

### Abrir o cerrar el registro por ambiente
La misma pantalla de variables de GitHub: `SIGNUP_ENABLED` = `true` o `false` en cada ambiente (vacío no cambia nada).
En producción el registro sigue **apagado** hasta que pongas `true`; staging lo trae encendido por omisión.
