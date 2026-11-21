#!/usr/bin/env bash
# Poslije MinIO drill-a: obriši probnu bazu i lokalne tmp kopije. Bez ispisa tajni.
# Ulaz: DATABASE_ADMIN_URL (i PGSSLROOTCERT / CA u kontejneru). Opciono RESTORE_DB_NAME.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=backup-lib.sh
. "$script_dir/backup-lib.sh"

: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL obavezan}"
RESTORE_DB="${RESTORE_DB_NAME:-gradix_restore}"
ensure_pg_ssl_env
ADMIN="$(pg_conn "$DATABASE_ADMIN_URL")"
MAINT="$(pg_url_with_database "$ADMIN" "postgres")"

db_exists() {
  psql "$MAINT" -v ON_ERROR_STOP=1 -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${RESTORE_DB}'" | tr -d '[:space:]'
}

echo "=== 1) provjera: postoji li baza ${RESTORE_DB} ==="
if [ "$(db_exists)" = "1" ]; then
  echo "postoji — prekidam sesije i brišem"
  psql "$MAINT" -v ON_ERROR_STOP=1 -q -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RESTORE_DB}' AND pid <> pg_backend_pid()" \
    >/dev/null || true
  psql "$MAINT" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE \"${RESTORE_DB}\"" >/dev/null
else
  echo "ne postoji (već čisto)"
fi

echo "=== 2) potvrda: baza ne postoji ==="
if [ "$(db_exists)" = "1" ]; then
  echo "GREŠKA: baza ${RESTORE_DB} i dalje postoji." >&2
  exit 1
fi
echo "PASS: baza ${RESTORE_DB} ne postoji"

echo "=== 3) lokalni tmp direktoriji ==="
rm -rf /tmp/backups-minio-check /tmp/backups
for d in /tmp/backups-minio-check /tmp/backups; do
  if [ -e "$d" ]; then
    echo "GREŠKA: ostalo $d" >&2
    exit 1
  fi
done
echo "PASS: /tmp/backups-minio-check i /tmp/backups ne postoje"
echo "✓ cleanup PROŠAO"
