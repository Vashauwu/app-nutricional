#!/usr/bin/env bash
# Prueba de humo desde fuera del servidor: la app responde por HTTPS, sirve el frontend y la API contesta.
#   bash deploy/smoke.sh https://staging.157-173-101-148.sslip.io
set -euo pipefail
URL="${1:?Uso: smoke.sh <url>}"
URL="${URL%/}"
fail() { echo "FALLA: $1"; exit 1; }

retry() { # retry <intentos> <comando…>
  local n="$1"; shift
  for _ in $(seq 1 "$n"); do "$@" && return 0; sleep 3; done
  return 1
}

check_health() { [ "$(curl -fsS --max-time 8 "$URL/healthz")" = '{"status":"ok"}' ]; }
check_index() { curl -fsS --max-time 8 "$URL/" | grep -q "<app-root"; }
check_config() { curl -fsS --max-time 8 "$URL/config.js" | grep -q "apiMode: 'api'"; }
check_api() { curl -fsS --max-time 8 "$URL/api/v1/meta" | grep -q '"api_version":"v1"'; }
check_brand() { curl -fsS --max-time 8 "$URL/api/v1/public/brand" | grep -q '"business_name"'; }
check_auth() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$URL/api/v1/auth/me")" = 401 ]; }

retry 20 check_health || fail "/healthz no responde"
retry 5 check_index  || fail "el frontend no se sirve"
retry 5 check_config || fail "config.js no activa el modo API"
retry 5 check_api    || fail "/api/v1/meta no responde"
retry 5 check_brand  || fail "/api/v1/public/brand no responde (¿base de datos?)"
retry 5 check_auth   || fail "una ruta protegida debe responder 401 sin sesión"
echo "Prueba de humo correcta: $URL"
