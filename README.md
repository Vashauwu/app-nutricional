# Plataforma de gestión nutricional

Especificación: [MVP_SPEC_v1.1.md](MVP_SPEC_v1.1.md). Estado actual: **Fase 0** (base del proyecto).

## Estructura

| Carpeta | Contenido |
|---|---|
| `frontend/` | Angular 22 + Taiga UI 5 + Angular CDK + PWA (service worker) + decimal.js |
| `backend/` | API Go (Gin) + pgx + SQLC + shopspring/decimal, monolito modular |
| `docker-compose.yml` | PostgreSQL 17 y MinIO (S3-compatible) para desarrollo |
| `.claude/skills/impeccable/` | Habilidad de diseño Impeccable para Claude Code |

## Requisitos

Git, Node.js 26 LTS, Go 1.27 y Docker Desktop (este último solo para la base de datos y MinIO locales).

## Desarrollo

```powershell
# Servicios
docker compose up -d

# Backend (http://localhost:8080)
cd backend
copy .env.example .env      # y define JWT_SECRET
go run ./cmd/api

# Frontend (http://localhost:4200, con proxy de /api al backend)
cd frontend
npm start
```

## Modos del frontend: demostración o API real

`frontend/public/config.js` decide, **sin recompilar**, de dónde salen los datos:

| `apiMode` | Qué hace |
|---|---|
| `'mock'` (predeterminado) | Demostración con datos de ejemplo en el navegador. No necesita backend. |
| `'api'` | Usa la API real en `/api/v1`: **autenticación, sesiones, recuperación de contraseña, pacientes, expediente, mediciones y consentimientos**. Los datos clínicos nunca se guardan en el navegador. |

### Estado del backend (API real)

| Módulo | Estado |
|---|---|
| Autenticación, sesiones, recuperación, roles y permisos | Listo y probado |
| Pacientes, expediente clínico, mediciones, consentimientos | Listo y probado |
| Catálogo SMAE (muestra sintética), alimentos propios, platillos con versiones y recálculo | Listo y probado |
| Planes alimentarios (publicación, revisiones, sustituciones, plantillas, concurrencia) | Listo y probado |
| Configuración (marca, región, almacenamiento, alertas, documentos legales) | Listo y probado |
| Archivos: imágenes (≤1920×1080 + miniatura), PDF, cuotas, descarga autorizada | Listo y probado (también contra MinIO real) |
| Seguimiento: registro por comida, fotos, comentarios, bandeja, cumplimiento | Listo y probado |
| Alertas nutricionales (§14) y reportes: CSV, Excel, PDF con auditoría | Listo y probado |

**Pendiente de conectar en el frontend** (en modo `api` siguen siendo datos de ejemplo que no persisten): platillos, catálogo
SMAE, planes, seguimiento, reportes y configuración. Los documentos PDF del expediente aparecen como "próximamente".

Notas importantes:

- El catálogo SMAE incluido es **una muestra sintética (46 alimentos)**, marcada como no oficial. Para uso real hay que
  cargar una fuente con licencia: `go run ./cmd/admin seed-demo-catalog` solo sirve para desarrollo.
- Las fotografías se guardan como JPEG optimizado (WebP requiere cgo) y los HEIC aún no se convierten en el servidor.
- Los archivos requieren MinIO/S3: `docker compose up -d` lo levanta y las variables `S3_*` de `.env.example` ya apuntan a él.
  Sin `S3_ENDPOINT` la API arranca igual, pero sin subida de archivos ni fotos de seguimiento.
- Los textos legales (aviso de privacidad y consentimiento) son marcadores: deben ser revisados por la nutrióloga.
- Correo: define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` y `SMTP_FROM` en `backend/.env` (cualquier proveedor SMTP: Resend, Brevo, SES…) y las invitaciones y la recuperación de contraseña se envían por correo. Sin `SMTP_HOST`, los enlaces solo se escriben en el registro de la API. Para que lleguen a la bandeja de entrada configura SPF/DKIM del dominio en el proveedor y `APP_BASE_URL` con la URL pública.

```powershell
# 1) Base de datos y API (AUTO_MIGRATE=true aplica las migraciones al arrancar)
docker compose up -d postgres minio
cd backend; copy .env.example .env     # define JWT_SECRET
go run ./cmd/api                        # http://localhost:8080
$env:NEW_USER_PASSWORD='TuClave2026'; go run ./cmd/admin create-user -email tu@correo.mx -name "Lic. Tu Nombre" -role nutritionist

# 2) Frontend: cambia apiMode a 'api' en frontend/public/config.js
cd ../frontend; npm start
```

## Comandos útiles

```powershell
# backend/
go test ./...        # pruebas (incluye el motor nutricional)
sqlc generate        # regenera generated/db desde migrations/ y queries/

# frontend/
npm test             # pruebas (Vitest)
npm run build        # build de producción con service worker
```

## Despliegue y CI/CD

- [`deploy/README.md`](deploy/README.md): producción y staging en un VPS (Docker, Caddy, respaldos).
- [`docs/ci-cd.md`](docs/ci-cd.md): pipeline de GitHub Actions (CI en cada PR; staging automático; producción con aprobación).

## Paleta

Definida en [frontend/src/styles/_tokens.scss](frontend/src/styles/_tokens.scss) con los valores exactos de la sección 19.3
del spec y mapeada a los tokens de Taiga UI. Los pastel se usan en superficies; el texto y las acciones
usan el ciruela grisáceo `#514653`.

## Política decimal

Sumas y multiplicaciones exactas; divisiones a 16 decimales con Round Half Even. Implementada en
[backend/internal/nutrition_engine/calculator](backend/internal/nutrition_engine/calculator) y en
[frontend/src/app/shared/utils/decimal.ts](frontend/src/app/shared/utils/decimal.ts), con las mismas pruebas de frontera en ambos lados.
