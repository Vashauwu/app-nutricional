#!/usr/bin/env bash
# Copia de seguridad de un ambiente (por omisión prod): base de datos (pg_dump) y archivos (MinIO). Conserva 14 días.
# deploy.sh instala el cron diario (03:15) para prod. Restaurar: ver deploy/README.md.
set -euo pipefail
ENV="${1:-prod}"
cd "/opt/nutri/$ENV/deploy"
DEST="/opt/nutri/backups/$ENV"; mkdir -p "$DEST"; chmod 700 /opt/nutri/backups "$DEST"
STAMP=$(date +%Y%m%d-%H%M)
./dc.sh "$ENV" exec -T postgres pg_dump -U nutri -Fc nutri > "$DEST/db-$STAMP.dump"
docker run --rm -v "nutri-${ENV}_miniodata":/data -v "$DEST":/out alpine tar czf "/out/files-$STAMP.tgz" -C /data .
find "$DEST" -type f -mtime +14 -delete
echo "Respaldo listo: $DEST ($STAMP)"
