#!/usr/bin/env bash
# Sube el proyecto al VPS y levanta UN ambiente (prod o staging). Desde la raíz del proyecto (Git Bash):
#   bash deploy/deploy.sh root@157.173.101.148 staging [dominio]
#   bash deploy/deploy.sh root@157.173.101.148 prod    [dominio]
# Cada ambiente tiene su propio código, base de datos, archivos y secretos en /opt/nutri/<ambiente>.
# Sin [dominio]: prod -> <ip>.sslip.io ; staging -> staging.<ip>.sslip.io. Un Caddy de entrada reparte el tráfico.
set -euo pipefail
HOST="${1:?Uso: bash deploy/deploy.sh usuario@ip prod|staging [dominio]}"
ENVN="${2:?Indica el ambiente: prod o staging}"
DOMAIN="${3:-}"
case "$ENVN" in prod|staging) ;; *) echo "Ambiente inválido: $ENVN (usa prod o staging)"; exit 1;; esac

echo "==> Empaquetando (sin node_modules, dist, .git ni .env)…"
tar --exclude=node_modules --exclude=dist --exclude=.angular --exclude=.git --exclude='.env*' --exclude='backend/tmp' \
  -czf /tmp/nutri.tgz frontend backend deploy

echo "==> Subiendo…"
scp /tmp/nutri.tgz "$HOST":/root/nutri.tgz

echo "==> Preparando servidor y levantando $ENVN…"
ssh "$HOST" "ENVN='$ENVN' DOMAIN='$DOMAIN' bash -s" <<'REMOTE'
set -euo pipefail
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80,443/tcp >/dev/null; ufw allow 443/udp >/dev/null; ufw --force enable >/dev/null; fi
mkdir -p /opt/nutri /opt/nutri/edge
docker network inspect nutri-edge >/dev/null 2>&1 || docker network create nutri-edge >/dev/null

# --- Migración de la instalación anterior (/opt/nutri/deploy) a /opt/nutri/prod, conservando datos ---
if [ "$ENVN" = prod ] && [ -f /opt/nutri/deploy/.env ] && [ ! -f /opt/nutri/prod/deploy/.env.prod ]; then
  echo "Migrando instalación anterior a /opt/nutri/prod (los datos se conservan)…"
  (cd /opt/nutri/deploy && docker compose -p nutri-prod -f docker-compose.prod.yml down) || true
  mkdir -p /opt/nutri/prod/deploy
  cp /opt/nutri/deploy/.env /opt/nutri/prod/deploy/.env.prod
  grep -q '^ENV_NAME=' /opt/nutri/prod/deploy/.env.prod || echo 'ENV_NAME=prod' >> /opt/nutri/prod/deploy/.env.prod
  mv /opt/nutri/deploy /opt/nutri/deploy.old
  rm -rf /opt/nutri/frontend /opt/nutri/backend
fi

DIR=/opt/nutri/$ENVN
mkdir -p "$DIR"; cd "$DIR"
ENVFILE="$DIR/deploy/.env.$ENVN"
keep=""; [ -f "$ENVFILE" ] && cp "$ENVFILE" /tmp/nutri.env && keep=1
tar xzf /root/nutri.tgz
[ -n "$keep" ] && mv /tmp/nutri.env "$ENVFILE"
chmod +x deploy/*.sh
cd deploy

if [ ! -f "$ENVFILE" ]; then
  IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  BASE="${IP//./-}.sslip.io"
  if [ "$ENVN" = staging ]; then DEFAULT="staging.$BASE"; else DEFAULT="$BASE"; fi
  DOM="${DOMAIN:-$DEFAULT}"
  echo "Sitio $ENVN: https://$DOM  (su registro A debe apuntar a $IP)"
  gen() { openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40; }
  {
    echo "ENV_NAME=$ENVN"
    echo "SITE_ADDRESS=$DOM"
    echo "PUBLIC_URL=https://$DOM"
    echo "POSTGRES_PASSWORD=$(gen)"
    echo "MINIO_PASSWORD=$(gen)"
    echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
    echo "COOKIE_SECURE=true"
    echo "# Staging NO debe enviar correos a pacientes reales: déjalo vacío allí."
    echo "SMTP_HOST="; echo "SMTP_PORT=587"; echo "SMTP_USERNAME="; echo "SMTP_PASSWORD="; echo "SMTP_FROM="; echo "SMTP_FROM_NAME=Nutrición"
  } > "$ENVFILE"
  chmod 600 "$ENVFILE"
  echo "Secretos generados en $ENVFILE (edítalo para añadir el correo SMTP)."
fi

# --- Caddy de entrada: un bloque por ambiente existente ---
cp -r edge/. /opt/nutri/edge/ 2>/dev/null || true
CF=/opt/nutri/edge/Caddyfile; : > "$CF"
for e in prod staging; do
  f=/opt/nutri/$e/deploy/.env.$e; [ -f "$f" ] || continue
  host=$(grep '^SITE_ADDRESS=' "$f" | cut -d= -f2-)
  { echo "$host {"; echo "	encode zstd gzip"
    [ "$e" = staging ] && echo '	header X-Robots-Tag "noindex, nofollow"'
    echo "	reverse_proxy web-$e:80"; echo "}"; echo; } >> "$CF"
done

# --- Levantar el ambiente y luego el de entrada ---
./dc.sh "$ENVN" up -d --build
(cd /opt/nutri/edge && docker compose up -d && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true)

if [ "$ENVN" = prod ]; then
  ( crontab -l 2>/dev/null | grep -v 'nutri/.*/backup.sh'; echo "15 3 * * * /opt/nutri/prod/deploy/backup.sh prod >> /var/log/nutri-backup.log 2>&1" ) | crontab -
fi
./dc.sh "$ENVN" ps
docker image prune -f >/dev/null
REMOTE
echo "==> Listo ($ENVN). Pasos únicos la primera vez de ese ambiente (en el servidor):"
cat <<NEXT
  cd /opt/nutri/$ENVN/deploy
  ./dc.sh $ENVN exec -e NEW_USER_PASSWORD='TuClave2026' api /app/admin create-user -email tu@correo.mx -name "Lic. Tu Nombre" -role nutritionist
  ./dc.sh $ENVN exec api /app/admin seed-demo-catalog     # catálogo SMAE de MUESTRA (no oficial)
NEXT
