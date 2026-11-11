#!/usr/bin/env bash
# Atajo para operar un ambiente:  ./dc.sh prod ps   |   ./dc.sh staging logs -f api
set -euo pipefail
ENV="${1:?Uso: ./dc.sh prod|staging <comando docker compose…>}"; shift
cd "$(dirname "$0")"
exec docker compose -p "nutri-$ENV" --env-file ".env.$ENV" -f docker-compose.prod.yml "$@"
