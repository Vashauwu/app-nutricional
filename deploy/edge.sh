#!/usr/bin/env bash
# Regenera el Caddyfile del Caddy de entrada a partir de los .env de cada ambiente (SITE_ADDRESS) y lo recarga.
# Lo llaman deploy.sh y release.sh, así un cambio de dominio llega con el siguiente despliegue; también se puede
# ejecutar a mano:  /opt/nutri/prod/deploy/edge.sh
set -euo pipefail
ROOT="${NUTRI_ROOT:-/opt/nutri}"
mkdir -p "$ROOT/edge"

NEW="$(mktemp)"
trap 'rm -f "$NEW"' EXIT
for e in prod staging; do
  f="$ROOT/$e/deploy/.env.$e"
  [ -f "$f" ] || continue
  host="$(grep -E '^SITE_ADDRESS=' "$f" | tail -1 | cut -d= -f2-)"
  [ -n "$host" ] || { echo "SITE_ADDRESS vacío en $f"; exit 1; }
  # SITE_ALIASES (opcional, separados por comas): otros nombres que también se sirven, p. ej. el dominio anterior durante un cambio.
  aliases="$(grep -E '^SITE_ALIASES=' "$f" | tail -1 | cut -d= -f2- || true)"
  addr="$host"
  for a in ${aliases//,/ }; do addr="$addr, $a"; done
  {
    echo "$addr {"
    echo "	encode zstd gzip"
    [ "$e" = staging ] && echo '	header X-Robots-Tag "noindex, nofollow"'
    echo "	reverse_proxy web-$e:80"
    echo "}"
    echo
  } >> "$NEW"
done

# El archivo se reescribe en el sitio (no se reemplaza) para conservar el montaje del contenedor.
if ! cmp -s "$NEW" "$ROOT/edge/Caddyfile" 2>/dev/null; then
  cat "$NEW" > "$ROOT/edge/Caddyfile"
  echo "Caddyfile de entrada actualizado:"; grep -E '^[^ 	].*\{$' "$ROOT/edge/Caddyfile" | sed 's/ {$//'
  CHANGED=1
else
  CHANGED=0
fi

# Sin Docker (pruebas) no se recarga.
command -v docker >/dev/null 2>&1 || exit 0
docker network inspect nutri-edge >/dev/null 2>&1 || docker network create nutri-edge >/dev/null
cd "$ROOT/edge"
if [ -f docker-compose.yml ]; then
  docker compose up -d >/dev/null
  if [ "$CHANGED" = 1 ]; then docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || docker compose restart caddy >/dev/null; fi
fi
