# CI/CD: de tu PC a staging y, con tu aprobación, a producción

```
dev local ──PR──► CI ──merge a main──► imágenes en GHCR ──► STAGING (automático) ──► [tú apruebas] ──► PRODUCCIÓN
                                                                                          │
                                                          respaldo ► liberar ► prueba de humo ► (si falla) reversa
```

- **Dev:** tu máquina (`docker compose up -d postgres minio`, API con `go run`, frontend con `npm start`).
- **CI** (`.github/workflows/ci.yml`): en cada pull request y push a ramas distintas de `main`: formato y `go vet`, que el
  código de `sqlc` esté al día, pruebas de Go (con PostgreSQL y MinIO reales en contenedores), pruebas y build de Angular, y
  que las imágenes de Docker compilen.
- **CD** (`.github/workflows/deploy.yml`): al fusionar en `main` repite el CI, publica `nutri-api` y `nutri-web` en GHCR con
  la etiqueta del commit y libera **esas mismas imágenes** en staging y, tras tu aprobación, en producción.

Lo que probaste en staging es exactamente lo que llega a producción: no se vuelve a compilar.

## Configuración única (la haces tú; requiere acceso a GitHub y al VPS)

### 1. Llave SSH para el pipeline (sin contraseñas)
En tu PC:
```bash
ssh-keygen -t ed25519 -f nutri-deploy -N "" -C "github-actions-deploy"
```
En el VPS, crea un usuario solo para despliegues y autoriza la llave pública (`nutri-deploy.pub`):
```bash
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy                      # nota: pertenecer a «docker» equivale a tener root; protege esta llave
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "<contenido de nutri-deploy.pub>" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /opt/nutri               # el usuario deploy es dueño de las carpetas de los ambientes
```
El respaldo diario de producción corre desde el cron de `root`; muévelo al usuario `deploy` para que los archivos
no queden con otro dueño:
```bash
crontab -l | crontab -u deploy -   # copia el cron de root a deploy
crontab -r                         # y lo quita de root
crontab -u deploy -l               # debe mostrar la línea del respaldo; si sale vacío, instálala:
(crontab -u deploy -l 2>/dev/null; echo "15 3 * * * /opt/nutri/prod/deploy/backup.sh prod >> /opt/nutri/backups/backup.log 2>&1") | crontab -u deploy -
```
Prueba desde tu PC: `ssh -i nutri-deploy deploy@157.173.101.148 "docker ps"`.

**Después de comprobar que funciona**, cierra la puerta por contraseña (recomendado):
en `/etc/ssh/sshd_config` pon `PasswordAuthentication no` y `PermitRootLogin prohibit-password`, y `systemctl reload ssh`.
Antes, abre OTRA sesión y confirma que entras con llave; si no, te quedas fuera.

### 2. Secretos y variables en GitHub
En el repositorio: **Settings → Environments** crea **`staging`** y **`production`**.

| Dónde | Nombre | Valor |
|---|---|---|
| Ambos ambientes (secret) | `DEPLOY_HOST` | `157.173.101.148` |
| Ambos (secret) | `DEPLOY_USER` | `deploy` |
| Ambos (secret) | `DEPLOY_SSH_KEY` | contenido **privado** de `nutri-deploy` |
| Ambos (secret) | `DEPLOY_KNOWN_HOSTS` | salida de `ssh-keyscan -t ed25519 157.173.101.148` (fija la huella del servidor) |
| `staging` (variable) | `SITE_URL` | `https://staging.157-173-101-148.sslip.io` (o tu dominio) |
| `production` (variable) | `SITE_URL` | `https://157-173-101-148.sslip.io` (o tu dominio) |

En **`production`** activa **Required reviewers** y agrégate: el flujo se detiene ahí hasta que apruebes en GitHub
(botón *Review deployments*). También puedes restringir el ambiente a la rama `main`.

### 3. Protección de la rama `main`
**Settings → Branches → Add rule** para `main`: exigir pull request, exigir los checks **Backend (Go)**,
**Frontend (Angular)** y **Las imágenes de Docker compilan**, y no permitir push directo. Activa también la verificación
en dos pasos en tu cuenta de GitHub: quien controla el repositorio controla el servidor.

### 4. Paquetes (imágenes)
Las imágenes se publican en `ghcr.io/<tu-usuario>/nutri-api` y `nutri-web`, **privadas**. El pipeline le pasa al servidor un
token de corta duración (el del propio trabajo) solo para descargarlas; no guardas ninguna credencial en el VPS.
Si el repositorio es privado y los paquetes no heredan el acceso, en cada paquete: **Package settings → Manage Actions access**
→ agrega el repositorio con rol *Write*.

## Cómo se usa
1. Trabaja en una rama y abre un pull request: corre el CI. Fusiona cuando esté en verde.
2. Al fusionar en `main`: CI → publicar imágenes → **staging** se actualiza solo y se le hace la prueba de humo.
3. Prueba en staging. Cuando estés conforme, aprueba el despliegue de **producción** en la pestaña *Actions*.
4. El servidor hace el respaldo, libera, espera `/healthz` y corre la prueba de humo externa. Si algo falla, regresa
   a la versión anterior y el flujo termina en rojo.

Historial de liberaciones de cada ambiente: `/opt/nutri/<ambiente>/deploy/releases.log`.

## Reglas para que las reversas sean seguras
- Las **migraciones no se revierten solas**. Escríbelas **compatibles hacia atrás**: primero agrega columnas/tablas; en un
  despliegue posterior, cuando ya nada las use, elimina lo viejo. Así volver a la versión anterior sigue funcionando.
- Nunca copies datos de producción a staging: son datos de salud de personas reales.
- Staging no debe tener SMTP configurado (no enviar correos a pacientes reales).

## Liberar o revertir a mano
En el servidor, dentro de `/opt/nutri/<ambiente>/deploy`:
```bash
./release.sh staging <etiqueta> ghcr.io/<tu-usuario>   # liberar una etiqueta concreta (commit de 12 caracteres)
./release.sh prod <etiqueta-anterior> ghcr.io/<tu-usuario>   # volver a una versión anterior
```
`deploy.sh` (desde tu PC) sigue sirviendo para el primer despliegue de un ambiente nuevo: compila en el servidor.

## Cambiar de dominio
Edita `SITE_ADDRESS` y `PUBLIC_URL` en `/opt/nutri/<ambiente>/deploy/.env.<ambiente>`, ejecuta `edge.sh` (o espera al siguiente despliegue: `release.sh` lo ejecuta
solo) y actualiza la variable `SITE_URL` del ambiente en GitHub. Pasos completos, con el correo, en [`correo-produccion.md`](correo-produccion.md).

## Mejoras posibles más adelante
- Separar staging y producción en máquinas distintas (hoy una prueba de carga en staging puede afectar a producción).
- Mover el almacenamiento a un servicio gestionado y copiar los respaldos fuera del VPS automáticamente.
- Escaneo de vulnerabilidades de imágenes y dependencias (Trivy / Dependabot) en el CI.
- Ejecutar en CI las pruebas de extremo a extremo con navegador (hoy se corren a mano).
