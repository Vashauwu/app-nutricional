#!/usr/bin/env bash
# Libera una versión (imágenes ya publicadas en el registro) en un ambiente del VPS.
#   ./release.sh <prod|staging> <etiqueta> <registro>      p. ej.  ./release.sh prod a1b2c3d4e5f6 ghcr.io/usuario
# 1) En producción hace un respaldo ANTES de tocar nada (si falla, no continúa).
# 2) Descarga las imágenes y reinicia el ambiente.
# 3) Espera a que responda /healthz por la URL pública; si no responde, regresa a la versión anterior.
# Las migraciones se aplican solas al arrancar la API y NO se revierten: escríbelas compatibles hacia atrás.
set -euo pipefail

ENV="${1:?Uso: ./release.sh prod|staging <etiqueta> <registro>}"
TAG="${2:?Falta la etiqueta}"
REPO="${3:?Falta el registro (p. ej. ghcr.io/usuario)}"
cd "$(dirname "$0")"
ENVFILE=".env.$ENV"
[ -f "$ENVFILE" ] || { echo "No existe $ENVFILE (haz primero el despliegue inicial con deploy.sh)"; exit 1; }

get() { grep -E "^$1=" "$ENVFILE" | tail -1 | cut -d= -f2- || true; }
setvar() { # setvar CLAVE VALOR
  grep -vE "^$1=" "$ENVFILE" > "$ENVFILE.tmp" || true
  echo "$1=$2" >> "$ENVFILE.tmp"
  cat "$ENVFILE.tmp" > "$ENVFILE" && rm -f "$ENVFILE.tmp"
}

# Contraseña del rol de la API (aislamiento entre consultas). Si el ambiente es anterior a esa función, se genera aquí una vez.
[ -n "$(get APP_DB_PASSWORD)" ] || setvar APP_DB_PASSWORD "$(openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40)"

# Configuración pública que llega desde las variables del ambiente en GitHub (vacío = no cambia lo que ya tenga el .env).
[ -z "${SIGNUP_ENABLED:-}" ] || setvar SIGNUP_ENABLED "$SIGNUP_ENABLED"
[ -z "${GOOGLE_CLIENT_ID:-}" ] || setvar GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"
[ -z "${SMAE_ENABLED:-}" ] || setvar SMAE_ENABLED "$SMAE_ENABLED"
[ -z "${TURNSTILE_SITE_KEY:-}" ] || setvar TURNSTILE_SITE_KEY "$TURNSTILE_SITE_KEY"
[ -z "${TURNSTILE_SECRET:-}" ] || setvar TURNSTILE_SECRET "$TURNSTILE_SECRET"

# Staging es el ambiente de pruebas: registro abierto y sin confirmar el correo (su remitente de pruebas no entrega a
# cualquier destinatario). Solo se escribe lo que falte: un valor puesto a mano en el .env se respeta. Nunca en producción.
if [ "$ENV" = staging ]; then
  [ -n "$(get ALLOW_DEMO_ACCOUNTS)" ] || setvar ALLOW_DEMO_ACCOUNTS true
  [ -n "$(get SIGNUP_ENABLED)" ] || setvar SIGNUP_ENABLED true
  [ -n "$(get SIGNUP_REQUIRE_EMAIL_VERIFICATION)" ] || setvar SIGNUP_REQUIRE_EMAIL_VERIFICATION false
fi

# Sin liberaciones previas por CD, el ambiente corre las imágenes compiladas en el servidor (local/…:dev).
PREV_TAG="$(get IMAGE_TAG)"; PREV_TAG="${PREV_TAG:-dev}"
PREV_REPO="$(get IMAGE_REPO)"; PREV_REPO="${PREV_REPO:-local}"
URL="$(get PUBLIC_URL)"

healthy() {
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 5 "$URL/healthz" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# Si cambió el dominio de algún ambiente (SITE_ADDRESS), el Caddy de entrada se actualiza antes de liberar.
[ -x ./edge.sh ] && ./edge.sh

if [ "$ENV" = prod ]; then
  echo "==> Respaldo previo a la liberación"
  ./backup.sh prod
fi

echo "==> $ENV: $PREV_REPO:$PREV_TAG → $REPO:$TAG"
setvar IMAGE_REPO "$REPO"
setvar IMAGE_TAG "$TAG"
if ./dc.sh "$ENV" pull api web && ./dc.sh "$ENV" up -d --no-build --remove-orphans && healthy; then
  echo "$(date -Is) $ENV $TAG ok (antes: ${PREV_TAG:-ninguna})" >> releases.log
  docker image prune -f >/dev/null || true
  echo "==> Liberación correcta: $URL"
  exit 0
fi

echo "!! La liberación de $TAG falló (no descargó, no arrancó o $URL/healthz no respondió). Registro de la API:"
./dc.sh "$ENV" logs --tail=40 api || true
if [ "$PREV_TAG" != "$TAG" ]; then
  echo "==> REVERSA a $PREV_REPO/…:$PREV_TAG"
  setvar IMAGE_REPO "$PREV_REPO"
  setvar IMAGE_TAG "$PREV_TAG"
  ./dc.sh "$ENV" up -d --no-build --remove-orphans || true
  if healthy; then echo "$(date -Is) $ENV reversa a $PREV_TAG (falló $TAG)" >> releases.log; fi
fi
exit 1
