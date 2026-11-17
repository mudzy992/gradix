#!/usr/bin/env bash
# Sigurnosna kopija Postgres baze: dump → šifrovanje → lokalno ili S3.
# Dump: DATABASE_BACKUP_URL mora biti BYPASSRLS (ili superuser) da uhvati sve firme.
# Manifest brojevi: vlasnik šeme (DATABASE_ADMIN_URL) — nezavisna istina od dump role.
# DATABASE_URL (web / gradix_app) se namjerno ne koristi.
# Izvor ideje: v1/scripts/ops/backup.sh
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=backup-lib.sh
. "$script_dir/backup-lib.sh"

BACKUP_URL="${DATABASE_BACKUP_URL:-${DATABASE_ADMIN_URL:-}}"
: "${BACKUP_URL:?Postavi DATABASE_BACKUP_URL (preferirano) ili DATABASE_ADMIN_URL}"
ADMIN_URL="${DATABASE_ADMIN_URL:-$BACKUP_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION:-30}"
STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
BASE="gradix-$STAMP"
MANIFEST_LIST="${BACKUP_MANIFEST_LIST:-$script_dir/backup-manifest.tsv}"

ensure_pg_ssl_env
require_cmd pg_dump psql openssl sha256sum
validate_dest
mkdir -p "$BACKUP_DIR"

CONN="$(pg_conn "$BACKUP_URL")"
ADMIN_CONN="$(pg_conn "$ADMIN_URL")"
assert_backup_role_sees_all "$CONN"

PLAIN="$BACKUP_DIR/$BASE.dump"
ENC="$BACKUP_DIR/$BASE.dump.enc"
MAN="$BACKUP_DIR/$BASE.manifest.tsv"

echo "→ manifest redova (kao vlasnik šeme)"
: > "$MAN"
while IFS= read -r table || [ -n "$table" ]; do
  case "$table" in
    ''|\#*) continue ;;
  esac
  count=$(psql "$ADMIN_CONN" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM public.\"$table\"" | tr -d '[:space:]')
  if [[ ! "$count" =~ ^[0-9]+$ ]]; then
    echo "GREŠKA: nevažeći broj redova za $table" >&2
    exit 1
  fi
  printf '%s\t%s\n' "$table" "$count" >> "$MAN"
  echo "  $table=$count"
done < "$MANIFEST_LIST"

companies=$(psql "$ADMIN_CONN" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM public.companies" | tr -d '[:space:]')
if [[ ! "$companies" =~ ^[0-9]+$ ]] || [ "$companies" -lt 2 ]; then
  echo "GREŠKA: za RLS dokaz trebaju ≥2 firme u izvoru (sada: ${companies:-?})." >&2
  exit 1
fi

echo "→ pg_dump (custom) $PLAIN"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file "$PLAIN" "$CONN"

echo "→ šifrovanje prije čuvanja/slanja"
encrypt_file "$PLAIN" "$ENC"
rm -f "$PLAIN"
write_sha256 "$ENC"

upload_encrypted "$ENC"

if [ "$RETENTION" -gt 0 ] 2>/dev/null; then
  ls -1t "$BACKUP_DIR"/gradix-*.dump.enc 2>/dev/null | tail -n +"$((RETENTION + 1))" | while read -r old; do
    echo "→ retencija: brišem $(basename "$old")"
    base_old="${old%.dump.enc}"
    rm -f "$old" "${old}.sha256" "${base_old}.manifest.tsv"
  done
fi

SIZE="$(wc -c < "$ENC" | tr -d ' ')"
echo "✓ backup gotov: $ENC ($SIZE B), retencija=$RETENTION, dest=${BACKUP_DEST:-local}"
