#!/usr/bin/env bash
# Vraća šifrovanu kopiju u praznu bazu (RESTORE_ADMIN_URL), pa ponovo primjenjuje grants.
# Izvor ideje: v1/scripts/ops/restore.sh
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=backup-lib.sh
. "$script_dir/backup-lib.sh"

ENC="${1:-}"
if [ -z "$ENC" ] || [ ! -f "$ENC" ]; then
  echo "Upotreba: RESTORE_ADMIN_URL=... BACKUP_ENCRYPTION_KEY=... $0 <putanja.dump.enc>" >&2
  exit 2
fi
: "${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL je obavezan (admin na praznoj ciljnoj bazi)}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY je obavezan}"
# Opciono: RESTORE_DATABASE_URL = app URL na istoj bazi (za verify); ne smije biti produkcijski DATABASE_URL.
if [ -n "${RESTORE_DATABASE_URL:-}" ] && [ "${DATABASE_URL:-}" = "$RESTORE_DATABASE_URL" ]; then
  echo "GREŠKA: RESTORE_DATABASE_URL je jednak DATABASE_URL — restore bi pregazio izvornu bazu." >&2
  exit 3
fi
case "${RESTORE_ADMIN_URL}${RESTORE_DATABASE_URL:-}" in
  *prod*)
    if [ "${ALLOW_PRODUCTION_RESTORE:-}" != "yes" ]; then
      echo "GREŠKA: cilj izgleda kao produkcija. Za svjesno pokretanje: ALLOW_PRODUCTION_RESTORE=yes" >&2
      exit 3
    fi
    ;;
esac

ensure_pg_ssl_env
require_cmd pg_restore psql openssl
check_sha256 "$ENC"

TMP_DIR="${TMPDIR:-/tmp}/gradix-restore-$$"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT
PLAIN="$TMP_DIR/restore.dump"

echo "→ dešifrovanje"
decrypt_file "$ENC" "$PLAIN"

CONN="$(pg_conn "$RESTORE_ADMIN_URL")"
echo "→ pg_restore u cilj (admin)"
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$CONN" "$PLAIN"

boot_dir=""
if [ -d "$script_dir/../../packages/db/bootstrap" ]; then
  boot_dir=$(CDPATH= cd -- "$script_dir/../../packages/db/bootstrap" && pwd)
elif [ -d /app/db/bootstrap ]; then
  boot_dir=/app/db/bootstrap
elif [ -d "$script_dir/../db/bootstrap" ]; then
  boot_dir=$(CDPATH= cd -- "$script_dir/../db/bootstrap" && pwd)
fi
if [ -n "$boot_dir" ] && [ -f "$boot_dir/grants.sql" ]; then
  echo "→ roles.sql + grants.sql na vraćenoj bazi"
  psql "$CONN" -q -v ON_ERROR_STOP=1 -f "$boot_dir/roles.sql"
  psql "$CONN" -q -v ON_ERROR_STOP=1 -f "$boot_dir/grants.sql"
fi

echo "✓ restore gotov: $ENC"
