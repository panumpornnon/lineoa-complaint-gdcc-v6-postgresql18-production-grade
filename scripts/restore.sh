#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${DB_BACKUP_FILE:?DB_BACKUP_FILE is required}"
UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"
IMAGE_BACKUP_FILE="${IMAGE_BACKUP_FILE:-}"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${DATABASE_URL}" "${DB_BACKUP_FILE}"
if [ -n "${IMAGE_BACKUP_FILE}" ]; then
  mkdir -p "${UPLOAD_DIR}"
  tar -C "${UPLOAD_DIR}" -xzf "${IMAGE_BACKUP_FILE}"
fi
echo "Restore completed. Run application smoke tests before reopening traffic."
