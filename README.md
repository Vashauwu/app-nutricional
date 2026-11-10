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

## Comandos útiles

```powershell
# backend/
go test ./...        # pruebas (incluye el motor nutricional)
sqlc generate        # regenera generated/db desde migrations/ y queries/

# frontend/
npm test             # pruebas (Vitest)
npm run build        # build de producción con service worker
```

## Paleta

Definida en [frontend/src/styles/_tokens.scss](frontend/src/styles/_tokens.scss) con los valores exactos de la sección 19.3
del spec y mapeada a los tokens de Taiga UI. Los pastel se usan en superficies; el texto y las acciones
usan el ciruela grisáceo `#514653`.

## Política decimal

Sumas y multiplicaciones exactas; divisiones a 16 decimales con Round Half Even. Implementada en
[backend/internal/nutrition_engine/calculator](backend/internal/nutrition_engine/calculator) y en
[frontend/src/app/shared/utils/decimal.ts](frontend/src/app/shared/utils/decimal.ts), con las mismas pruebas de frontera en ambos lados.
