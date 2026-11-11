# Despliegue en un VPS (Contabo): producción + staging

Una máquina con Docker y **dos ambientes aislados**, cada uno con su código, base de datos, archivos y secretos:

| Ambiente | Para qué | Carpeta en el VPS | Dominio por omisión |
|---|---|---|---|
| `prod` | Lo que usan las pacientes | `/opt/nutri/prod` | `157-173-101-148.sslip.io` |
| `staging` | Probar cambios antes de pasarlos a prod | `/opt/nutri/staging` | `staging.157-173-101-148.sslip.io` |

Un **Caddy de entrada** (`/opt/nutri/edge`) es el único que abre los puertos 80/443, emite los certificados HTTPS y reparte
el tráfico por nombre de dominio. Cada ambiente se compone de: frontend + proxy `/api`, API Go, PostgreSQL y MinIO, sin
puertos publicados.

## Antes de empezar
1. **Dominios.** Con dominio propio crea **dos registros A** hacia la IP del VPS (p. ej. `nutri.tudominio.mx` y
   `staging.tudominio.mx`). Sin dominio, acepta los de sslip.io (el subdominio `staging.` también resuelve a tu IP).
2. **Correo SMTP** solo para prod (`SMTP_*` en `/opt/nutri/prod/deploy/.env.prod`). **Deja vacío el de staging**: así
   nunca se envían correos a pacientes reales desde pruebas (los enlaces solo aparecen en el log de la API).

> **Entrega continua:** una vez configurado (ver [`docs/ci-cd.md`](../docs/ci-cd.md)), las actualizaciones las hace el
> pipeline de GitHub: al fusionar en `main` se libera staging y, con tu aprobación, producción, con respaldo previo,
> prueba de humo y reversa automática. `deploy.sh` queda para el **primer despliegue** de un ambiente (compila en el servidor).

## Desplegar / actualizar a mano (desde tu PC, Git Bash, en la raíz del proyecto)
```bash
bash deploy/deploy.sh root@157.173.101.148 staging                # o con dominio: ... staging staging.tudominio.mx
bash deploy/deploy.sh root@157.173.101.148 prod                   # o con dominio: ... prod nutri.tudominio.mx
```
- La primera vez de cada ambiente genera sus contraseñas y `JWT_SECRET`. Después conserva `.env.<ambiente>` y los datos.
- Las migraciones se aplican solas al arrancar la API.
- **Flujo recomendado:** despliega a `staging`, prueba, y solo entonces despliega a `prod`.
- La primera vez que ejecutes `prod` con el diseño nuevo, el script **migra la instalación anterior** (`/opt/nutri/deploy`)
  a `/opt/nutri/prod` conservando la base de datos y los archivos. Habrá una caída breve mientras el Caddy de entrada
  toma los puertos y pide el certificado de nuevo. La carpeta anterior queda en `/opt/nutri/deploy.old`.

## Primera vez de cada ambiente (en el servidor)
```bash
cd /opt/nutri/staging/deploy        # o /opt/nutri/prod/deploy
./dc.sh staging exec -e NEW_USER_PASSWORD='TuClave2026' api /app/admin create-user -email tu@correo.mx -name "Lic. Tu Nombre" -role nutritionist
./dc.sh staging exec api /app/admin seed-demo-catalog     # catálogo SMAE de MUESTRA (no oficial)
```
Las cuentas **no se comparten** entre ambientes: hay que crearlas en cada uno.

## Operación diaria
`./dc.sh <prod|staging> <comando docker compose>` dentro de `/opt/nutri/<ambiente>/deploy`:
```bash
./dc.sh prod ps
./dc.sh prod logs -f api
./dc.sh staging restart api
docker stats                       # consumo de todos los contenedores
df -h /                            # disco
```
Salud: `https://<dominio>/healthz`.

## Respaldos
`backup.sh` corre a diario (03:15) **solo para prod**: `db-*.dump` y `files-*.tgz` en `/opt/nutri/backups/prod` (14 días).
Para respaldar staging a mano: `/opt/nutri/staging/deploy/backup.sh staging`.
**Copia los respaldos fuera del VPS** — uno en la misma máquina no cubre su pérdida.

Restaurar la base de prod:
```bash
cd /opt/nutri/prod/deploy
./dc.sh prod exec -T postgres pg_restore -U nutri -d nutri --clean --if-exists < /opt/nutri/backups/prod/db-AAAAMMDD-HHMM.dump
```

## Cambiar de dominio
Edita `SITE_ADDRESS` y `PUBLIC_URL` en `.env.<ambiente>` y vuelve a ejecutar `deploy.sh` de ese ambiente (regenera el
Caddy de entrada). Las sesiones abiertas y las invitaciones pendientes con el enlace viejo dejan de servir.

## Antes de usar datos reales de pacientes
Textos legales revisados por la nutrióloga, catálogo SMAE con licencia (la muestra es sintética), política de retención
definida, y respaldos probados al restaurar.
