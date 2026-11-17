#!/usr/bin/env bash
# Generiše/upiše lokalne BACKUP_* u root .env (ne ispisuje vrijednosti). Idempotentno.
# Pokreni iz korijena repoa: ./v2/infra/scripts/backup-env-prepare.sh
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: nema $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL mora postojati u .env}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER potreban za provision bucketa}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD potreban za provision bucketa}"

require_openssl() {
  command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl nije u PATH." >&2; exit 2; }
}
require_openssl

gen_hex() { openssl rand -hex "$1"; }
gen_b64() { openssl rand -base64 "$1" | tr -d '\n' | tr '+/' 'Aa'; }

# Generiši samo ako fali.
if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  BACKUP_ENCRYPTION_KEY="$(gen_hex 32)"
fi
if [ -z "${BACKUP_ROLE_PASSWORD:-}" ]; then
  BACKUP_ROLE_PASSWORD="$(gen_b64 24)"
fi
if [ -z "${BACKUP_S3_ACCESS_KEY:-}" ]; then
  BACKUP_S3_ACCESS_KEY="gx2bak$(gen_hex 10)"
fi
if [ -z "${BACKUP_S3_SECRET_KEY:-}" ]; then
  BACKUP_S3_SECRET_KEY="$(gen_hex 32)"
fi
if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
  BACKUP_S3_BUCKET="gradix-stg-backups"
fi
if [ -z "${BACKUP_S3_ENDPOINT:-}" ]; then
  BACKUP_S3_ENDPOINT="${MINIO_PUBLIC_ENDPOINT:-${MINIO_ENDPOINT:?postavi BACKUP_S3_ENDPOINT ili MINIO_PUBLIC_ENDPOINT}}"
fi
if [ -z "${BACKUP_S3_PREFIX:-}" ]; then
  BACKUP_S3_PREFIX="backups"
fi
BACKUP_DEST="${BACKUP_DEST:-s3}"

# DATABASE_BACKUP_URL iz admin URL-a: zamijeni userinfo sa gradix_backup:lozinka.
# Ne echo-aj rezultat.
python_build_urls() {
  BACKUP_ROLE_PASSWORD="$BACKUP_ROLE_PASSWORD" DATABASE_ADMIN_URL="$DATABASE_ADMIN_URL" \
  python - <<'PY'
import os, urllib.parse
admin = os.environ["DATABASE_ADMIN_URL"]
pwd = os.environ["BACKUP_ROLE_PASSWORD"]
u = urllib.parse.urlparse(admin)
# netloc: user:pass@host:port
host = u.hostname or ""
port = f":{u.port}" if u.port else ""
auth = urllib.parse.quote("gradix_backup", safe="") + ":" + urllib.parse.quote(pwd, safe="")
netloc = f"{auth}@{host}{port}"
path = u.path or "/gradix"
query = ("?" + u.query) if u.query else ""
backup = urllib.parse.urlunparse((u.scheme, netloc, path, "", u.query, ""))
# restore admin: ista admin konekcija, baza gradix_restore
restore_path = "/gradix_restore"
restore = urllib.parse.urlunparse((u.scheme, u.netloc, restore_path, "", u.query, ""))
# restore app URL optional
print("DATABASE_BACKUP_URL=" + backup)
print("RESTORE_ADMIN_URL=" + restore)
PY
}

URL_LINES="$(python_build_urls)"
DATABASE_BACKUP_URL="$(printf '%s\n' "$URL_LINES" | sed -n 's/^DATABASE_BACKUP_URL=//p')"
RESTORE_ADMIN_URL="$(printf '%s\n' "$URL_LINES" | sed -n 's/^RESTORE_ADMIN_URL=//p')"

upsert_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  # Ukloni postojeći key=... (cijeli red), dodaj novi na kraj.
  grep -v -E "^${key}=" "$ENV_FILE" >"$tmp" || true
  printf '%s=%s\n' "$key" "$val" >>"$tmp"
  mv "$tmp" "$ENV_FILE"
}

upsert_env BACKUP_ENCRYPTION_KEY "$BACKUP_ENCRYPTION_KEY"
upsert_env BACKUP_ROLE_PASSWORD "$BACKUP_ROLE_PASSWORD"
upsert_env BACKUP_DEST "$BACKUP_DEST"
upsert_env BACKUP_S3_ENDPOINT "$BACKUP_S3_ENDPOINT"
upsert_env BACKUP_S3_BUCKET "$BACKUP_S3_BUCKET"
upsert_env BACKUP_S3_PREFIX "$BACKUP_S3_PREFIX"
upsert_env BACKUP_S3_ACCESS_KEY "$BACKUP_S3_ACCESS_KEY"
upsert_env BACKUP_S3_SECRET_KEY "$BACKUP_S3_SECRET_KEY"
upsert_env DATABASE_BACKUP_URL "$DATABASE_BACKUP_URL"
upsert_env RESTORE_ADMIN_URL "$RESTORE_ADMIN_URL"

echo "PASS: backup varijable upisane u lokalni .env (vrijednosti sakrivene)."
# Samo imena:
echo "KEYS: BACKUP_ENCRYPTION_KEY BACKUP_ROLE_PASSWORD BACKUP_DEST BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_PREFIX BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY DATABASE_BACKUP_URL RESTORE_ADMIN_URL"
