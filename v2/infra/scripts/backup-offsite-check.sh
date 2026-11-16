#!/usr/bin/env bash
# Ručna provjera odredišta (jednom na stagingu): backup → upload → download → restore u
# privremenu bazu → kontrolni zbir (sha256) + brojevi redova.
# Ne pokreće se u CI-ju. Zahtijeva aws CLI, openssl, psql/pg_dump/pg_restore.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=backup-lib.sh
. "$script_dir/backup-lib.sh"

: "${DATABASE_BACKUP_URL:?DATABASE_BACKUP_URL (read-only export rola)}"
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL za restore grants}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL prazna probna baza}"
: "${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL admin na istoj probnoj bazi}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY (nije na istom mjestu kao kopije)}"
: "${BACKUP_DEST:?BACKUP_DEST=s3 ili local}"
BACKUP_DIR="${BACKUP_DIR:-./backups-offsite-check}"
export BACKUP_DIR BACKUP_DEST

require_cmd pg_dump pg_restore psql openssl sha256sum aws
warn_if_not_off_host

echo "=== 1) backup + upload ==="
"$script_dir/backup.sh"
ENC=$(ls -1t "$BACKUP_DIR"/gradix-*.dump.enc | head -n1)
MAN="${ENC%.dump.enc}.manifest.tsv"
SUM_BEFORE=$(awk '{print $1}' "${ENC}.sha256")

if [ "${BACKUP_DEST}" = "s3" ]; then
  echo "=== 2) download sa odredišta ==="
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
  echo "✓ sha256 podudaran: $SUM_BEFORE"
  ENC="$ENC_PULLED"
else
  echo "=== 2) local dest — sha256 ostaje lokalni ==="
  check_sha256 "$ENC"
  echo "✓ sha256 lokalni: $SUM_BEFORE"
fi

echo "=== 3) dokaz: bez ključa nije čitljivo ==="
if env BACKUP_ENCRYPTION_KEY=wrong-key-for-negative-test \
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$ENC" -out /dev/null 2>/dev/null; then
  echo "GREŠKA: dešifrovanje s pogrešnim ključem nije smjelo uspjeti." >&2
  exit 1
fi
echo "✓ pogrešan ključ odbijen"

echo "=== 4) restore + brojevi ==="
"$script_dir/restore.sh" "$ENC"
"$script_dir/backup-verify-counts.sh" "$MAN"

echo "✓ offsite-check PROŠAO (dest=$BACKUP_DEST)"
