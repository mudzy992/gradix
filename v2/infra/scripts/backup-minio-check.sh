#!/usr/bin/env bash
# Ručna provjera MinIO odredišta (jednom na stagingu): dostupnost → backup/upload →
# download → sha256 → dešifrovanje → restore + brojevi redova.
# Odredište: zaseban backup bucket + BACKUP_S3_* ključevi (ne app MINIO_*).
# Ne pokreće se u CI-ju.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=backup-lib.sh
. "$script_dir/backup-lib.sh"

: "${DATABASE_BACKUP_URL:?DATABASE_BACKUP_URL (read-only export rola)}"
: "${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL admin na praznoj probnoj bazi}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY (nije u MinIO-u)}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT (u web kontejneru: http://minio:9000)}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET (zaseban backup bucket)}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY (nije MINIO_ACCESS_KEY app-a)}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY (nije MINIO_SECRET_KEY app-a)}"
BACKUP_DEST=s3
BACKUP_DIR="${BACKUP_DIR:-/tmp/backups-minio-check}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backups}"
export BACKUP_DIR BACKUP_DEST BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_PREFIX
export BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY

ensure_pg_ssl_env
require_cmd pg_dump pg_restore psql openssl sha256sum aws
validate_dest
apply_backup_s3_creds

echo "=== 0) dostupnost MinIO odredišta ==="
AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 ls "s3://$BACKUP_S3_BUCKET/" >/dev/null
echo "✓ bucket dostupan"

echo "=== 1) backup + upload ==="
"$script_dir/backup.sh"
ENC=$(ls -1t "$BACKUP_DIR"/gradix-*.dump.enc | head -n1)
MAN="${ENC%.dump.enc}.manifest.tsv"
SUM_BEFORE=$(awk '{print $1}' "${ENC}.sha256")

echo "=== 2) download + sha256 ==="
PULL_DIR="$BACKUP_DIR/pulled"
rm -rf "$PULL_DIR"
download_encrypted "$(basename "$ENC")" "$PULL_DIR"
ENC_PULLED="$PULL_DIR/$(basename "$ENC")"
check_sha256 "$ENC_PULLED"
SUM_AFTER=$(awk '{print $1}' "${ENC_PULLED}.sha256")
if [ "$SUM_BEFORE" != "$SUM_AFTER" ]; then
  echo "GREŠKA: kontrolni zbir se ne poklapa nakon downloada." >&2
  exit 1
fi
echo "✓ sha256 podudaran"

echo "=== 3) dokaz: pogrešan ključ pada ==="
if env BACKUP_ENCRYPTION_KEY=wrong-key-for-negative-test \
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$ENC_PULLED" -out /dev/null 2>/dev/null; then
  echo "GREŠKA: dešifrovanje s pogrešnim ključem nije smjelo uspjeti." >&2
  exit 1
fi
echo "✓ pogrešan ključ odbijen"

echo "=== 4) restore baza + brojevi ==="
# Prazna ciljna baza (admin na istom clusteru kao RESTORE_ADMIN_URL).
RESTORE_DB=$(printf '%s' "$(pg_conn "$RESTORE_ADMIN_URL")" | sed -E 's#^.*/([^/?]+).*#\1#')
ADMIN_MAINT="${DATABASE_ADMIN_URL:-$RESTORE_ADMIN_URL}"
ADMIN_MAINT_CONN="$(pg_conn "$ADMIN_MAINT")"
ADMIN_BASE="${ADMIN_MAINT_CONN%/*}"
ADMIN_Q=""
case "$ADMIN_MAINT_CONN" in *\?*) ADMIN_Q="?${ADMIN_MAINT_CONN#*\?}" ;; esac
psql "${ADMIN_BASE}/postgres${ADMIN_Q}" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${RESTORE_DB}\"" >/dev/null
psql "${ADMIN_BASE}/postgres${ADMIN_Q}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${RESTORE_DB}\" OWNER CURRENT_USER" >/dev/null
"$script_dir/restore.sh" "$ENC_PULLED"
"$script_dir/backup-verify-counts.sh" "$MAN"

echo "=== 5) obriši probnu kopiju s MinIO ==="
apply_backup_s3_creds
prefix="${BACKUP_S3_PREFIX:-backups}"
prefix="${prefix#/}"
prefix="${prefix%/}"
base="$(basename "$ENC")"
AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 rm "s3://$BACKUP_S3_BUCKET/$prefix/$base" --only-show-errors || true
AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 rm "s3://$BACKUP_S3_BUCKET/$prefix/${base}.sha256" --only-show-errors || true
man_name="$(basename "$MAN")"
AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 rm "s3://$BACKUP_S3_BUCKET/$prefix/$man_name" --only-show-errors || true
rm -rf "$BACKUP_DIR"
echo "✓ probna kopija obrisana"

echo "✓ minio-check PROŠAO (bucket ime sakriveno u logu nije potrebno; status OK)"
