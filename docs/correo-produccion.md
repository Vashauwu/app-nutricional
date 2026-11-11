# Correo en producción (Resend)

Staging ya envía con el remitente de pruebas de Resend (`onboarding@resend.dev`), que solo entrega al correo de tu propia
cuenta de Resend. Para escribirles a pacientes reales hace falta **un dominio tuyo verificado**.

## Resumen del orden

1. Comprar el dominio.
2. Apuntar el dominio de la app al VPS (registro A) y ponerlo en los ambientes y en GitHub.
3. Verificar el dominio en Resend (registros DNS).
4. Crear una llave de API **solo para producción** y configurarla en el servidor.
5. Probar, y poner la política DMARC.

## 1. Dominio
Compra un `.mx` (o `.com.mx`) con un registrador acreditado. Conviene que el panel DNS sea editable (cualquier registrador
lo es; Cloudflare también sirve como DNS). Ejemplo: `nutrintegral.mx`.

Nombres sugeridos:
- App de producción: `app.tudominio.mx` (o el dominio raíz).
- Staging: `staging.tudominio.mx`.
- Correos: se envía desde `no-responder@tudominio.mx`.

## 2. Que la app responda en el dominio nuevo
En el DNS del dominio, crea registros **A** hacia `157.173.101.148` para `app` y `staging` (los que uses).

En el VPS, edita los `.env` de cada ambiente (`SITE_ADDRESS` es el nombre sin `https://`; `PUBLIC_URL` es con `https://`).
**Transición sin corte:** deja el nombre anterior en `SITE_ALIASES` (se sigue sirviendo mientras compruebas el nuevo) y quítalo al terminar.
```bash
nano /opt/nutri/prod/deploy/.env.prod
#   SITE_ADDRESS=app.tudominio.mx
#   PUBLIC_URL=https://app.tudominio.mx
#   SITE_ALIASES=157-173-101-148.sslip.io
nano /opt/nutri/staging/deploy/.env.staging
#   SITE_ADDRESS=staging.tudominio.mx
#   PUBLIC_URL=https://staging.tudominio.mx
#   SITE_ALIASES=staging.157-173-101-148.sslip.io
/opt/nutri/staging/deploy/edge.sh           # actualiza el Caddy de entrada y pide los certificados (sirve para ambos ambientes)
cd /opt/nutri/prod/deploy && ./dc.sh prod up -d && cd ../../staging/deploy && ./dc.sh staging up -d
```
En GitHub, actualiza la variable `SITE_URL` de cada ambiente (**Settings → Environments**) con las URLs nuevas; el pipeline
la usa para la prueba de humo.

`PUBLIC_URL` es la base de los enlaces de los correos (invitación y recuperación): debe ser el dominio real.
Las sesiones abiertas dejan de servir al cambiar de dominio; se vuelve a iniciar sesión.

## 3. Verificar el dominio en Resend
1. resend.com → **Domains → Add Domain** → escribe `tudominio.mx` (o un subdominio como `mail.tudominio.mx`).
2. Resend muestra registros DNS (SPF, DKIM y uno para rebotes). Agrégalos **tal cual** en el DNS del dominio.
   Si usas Cloudflare, esos registros deben quedar en **DNS only** (nube gris), no proxied.
3. Pulsa **Verify**. Puede tardar de minutos a unas horas. Debe quedar en *Verified*.

## 4. Llave de API de producción y configuración
En Resend crea una llave **nueva** (Sending access) llamada, por ejemplo, `produccion`. Usa llaves distintas para staging y
producción: así puedes revocar una sin afectar a la otra.

```bash
nano /opt/nutri/prod/deploy/.env.prod
```
```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USERNAME=resend
SMTP_PASSWORD=re_llave_de_produccion
SMTP_FROM=no-responder@tudominio.mx
SMTP_FROM_NAME=Nombre de tu consulta
```
```bash
cd /opt/nutri/prod/deploy && ./dc.sh prod up -d
./dc.sh prod logs --tail=20 api | grep mail      # debe decir mail_enabled
```
Con el correo activo, la app **deja de mostrarle el enlace de invitación** a la nutrióloga: llega solo por correo.

Staging puede seguir con el remitente de pruebas (así no puede escribirle a nadie por error) o usar un subdominio verificado.

## 5. Pruebas y buenas prácticas
- Invita a un paciente de prueba con **tu** correo y revisa que llegue a la bandeja (no a spam) y que el enlace abra la
  app en tu dominio.
- Prueba **¿Olvidaste tu contraseña?** con un usuario real.
- **DMARC:** agrega un registro TXT `_dmarc` con `v=DMARC1; p=none; rua=mailto:tu-correo@tudominio.mx` para empezar a recibir
  reportes; cuando todo llegue bien, endurécelo a `p=quarantine`.
- Revisa de vez en cuando **Emails / Logs** en Resend: ahí ves rebotes y quejas.
- Los correos no llevan datos de salud: solo el enlace y un mensaje genérico. Mantenlo así.
- Los límites del plan gratuito de Resend cambian: confirma en su sitio que alcanzan para tu volumen.

## Si algo falla
```bash
cd /opt/nutri/prod/deploy
./dc.sh prod logs --since 30m api | grep -E "mail_sent|mail_send_failed"
```
`mail_send_failed` trae el motivo (dominio no verificado, llave incorrecta, remitente no autorizado…).
