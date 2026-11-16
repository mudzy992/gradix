#!/usr/bin/env bash
# Jedna naredba: starost najnovije kopije. Exit 1 ako je starija od 26 h (ili BACKUP_MAX_AGE_HOURS).
# Lokalno: BACKUP_DIR. S3: BACKUP_DEST=s3 + endpoint/bucket/prefix.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=backup-lib.sh
. "$script_dir/backup-lib.sh"

MAX_H="${BACKUP_MAX_AGE_HOURS:-26}"
DEST="${BACKUP_DEST:-local}"
NOW=$(date -u +%s)

newest_epoch=""
newest_name=""

if [ "$DEST" = "s3" ]; then
  require_cmd aws
  : "${BACKUP_S3_ENDPOINT:?}"
  : "${BACKUP_S3_BUCKET:?}"
  prefix="${BACKUP_S3_PREFIX:-gradix/backups}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  # aws s3 ls ispisuje datum/vrijeme; uzmi zadnji .dump.enc
  line=$(AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 ls "s3://$BACKUP_S3_BUCKET/$prefix/" \
    | awk '/\.dump\.enc$/ {print}' | tail -n1)
  if [ -z "$line" ]; then
    echo "UPOZORENJE: nema nijedne .dump.enc kopije na s3://$BACKUP_S3_BUCKET/$prefix/" >&2
    exit 1
  fi
  # format: 2026-11-16 03:30:01   12345 gradix-....dump.enc
  newest_name=$(printf '%s' "$line" | awk '{print $4}')
  date_part=$(printf '%s' "$line" | awk '{print $1" "$2}')
  newest_epoch=$(date -u -d "$date_part" +%s)
else
  BACKUP_DIR="${BACKUP_DIR:-./backups}"
  newest=$(ls -1t "$BACKUP_DIR"/gradix-*.dump.enc 2>/dev/null | head -n1 || true)
  if [ -z "$newest" ]; then
    echo "UPOZORENJE: nema nijedne .dump.enc u $BACKUP_DIR" >&2
    exit 1
  fi
  newest_name=$(basename "$newest")
  newest_epoch=$(stat -c %Y "$newest" 2>/dev/null || stat -f %m "$newest")
fi

age_s=$((NOW - newest_epoch))
age_h=$((age_s / 3600))
age_m=$(((age_s % 3600) / 60))
echo "Zadnja kopija: $newest_name — starost ${age_h}h ${age_m}m (limit ${MAX_H}h)"

if [ "$age_h" -ge "$MAX_H" ]; then
  echo "UPOZORENJE: zadnja kopija je starija od ${MAX_H} sati — RPO tvrdnja nije održana." >&2
  exit 1
fi
exit 0
