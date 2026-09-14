#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/complaint-system}"
UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DB_FILE="${BACKUP_DIR}/complaint_db_${TIMESTAMP}.dump"
IMAGE_FILE="${BACKUP_DIR}/complaint_images_${TIMESTAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"
umask 077

pg_dump "${DATABASE_URL}" --format=custom --file="${DB_FILE}"

if [ -d "${UPLOAD_DIR}" ]; then
  tar -C "${UPLOAD_DIR}" -czf "${IMAGE_FILE}" .
  echo "Image backup created: ${IMAGE_FILE}"
else
  echo "Upload directory not found; image backup skipped: ${UPLOAD_DIR}" >&2
fi

find "${BACKUP_DIR}" -type f \
  \( -name 'complaint_db_*.dump' -o -name 'complaint_images_*.tar.gz' \) \
  -mtime "+${RETENTION_DAYS}" -delete

echo "Database backup created: ${DB_FILE}"
