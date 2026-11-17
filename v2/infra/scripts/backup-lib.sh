#!/usr/bin/env bash
# Zajedničke pomoćne funkcije za backup/restore. Izvor: v1/scripts/ops/backup.sh (pg_conn ideja).
# shellcheck shell=bash
set -euo pipefail

# Kontejner (Coolify web): CA je na /etc/ssl/certs/coolify-ca.crt.
# CI (lokalni Postgres bez TLS) ne traži CA.
ensure_pg_ssl_env() {
  local default_ca="/etc/ssl/certs/coolify-ca.crt"
  if [ -z "${PGSSLROOTCERT:-}" ] || [ ! -f "${PGSSLROOTCERT}" ]; then
    if [ -f "$default_ca" ]; then
      export PGSSLROOTCERT="$default_ca"
    fi
  fi
  case "${DATABASE_ADMIN_URL:-}${DATABASE_BACKUP_URL:-}${RESTORE_ADMIN_URL:-}${DATABASE_URL:-}" in
    *sslmode=verify*|*sslrootcert=*)
      if [ -z "${PGSSLROOTCERT:-}" ] || [ ! -f "${PGSSLROOTCERT}" ]; then
        echo "GREŠKA: PGSSLROOTCERT nije postavljen ili CA fajl ne postoji (očekivano $default_ca)." >&2
        exit 2
      fi
      ;;
  esac
}

# Ime baze iz patha URL-a (prije ?). Ne smije hvatati putanju iz sslrootcert=...
pg_database_name() {
  local base="${1%%\?*}"
  base="${base%/}"
  printf '%s' "${base##*/}"
}

pg_conn() {
  local url="$1"
  # sslrootcert iz URL-a se skida; CA ide isključivo preko PGSSLROOTCERT (env).
  case "$url" in
    *\?*) ;;
    *) printf '%s' "$url"; return ;;
  esac
  local base="${url%%\?*}"
  local query="${url#*\?}"
  local kept="" pair
  local IFS='&'
  for pair in $query; do
    [ -z "$pair" ] && continue
    case "$pair" in
      schema=*|sslrootcert=*) continue ;;
    esac
    kept="${kept:+$kept&}$pair"
  done
  if [ -n "$kept" ]; then
    printf '%s?%s' "$base" "$kept"
  else
    printf '%s' "$base"
  fi
}

require_cmd() {
  local c
  for c in "$@"; do
    if ! command -v "$c" >/dev/null 2>&1; then
      echo "GREŠKA: naredba '$c' nije u PATH-u." >&2
      exit 2
    fi
  done
}

# psql: lokalni ili docker postgres:16-alpine (za Windows host bez klijenta).
run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$@"
    return $?
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "GREŠKA: nema psql ni docker." >&2
    return 2
  fi
  local args=("$@") url="" i
  for ((i=0; i<${#args[@]}; i++)); do
    case "${args[$i]}" in
      postgresql://*|postgres://*) url="${args[$i]}" ;;
    esac
  done
  local docker_args=(run --rm)
  if [ -n "${PGSSLROOTCERT:-}" ] && [ -f "${PGSSLROOTCERT}" ]; then
    docker_args+=(-e "PGSSLROOTCERT=/certs/ca.crt" -v "${PGSSLROOTCERT}:/certs/ca.crt:ro")
  elif [ -n "${POSTGRES_CA_FILE:-}" ] && [ -f "${POSTGRES_CA_FILE}" ]; then
    docker_args+=(-e "PGSSLROOTCERT=/certs/ca.crt" -v "${POSTGRES_CA_FILE}:/certs/ca.crt:ro")
  fi
  # Host.docker.internal za localhost URL-ove s Windowsa.
  if [ -n "$url" ]; then
    url="${url//127.0.0.1/host.docker.internal}"
    url="${url//localhost/host.docker.internal}"
    for ((i=0; i<${#args[@]}; i++)); do
      case "${args[$i]}" in
        postgresql://*|postgres://*) args[$i]="$url" ;;
      esac
    done
  fi
  docker "${docker_args[@]}" postgres:16-alpine psql "${args[@]}"
}

encrypt_file() {
  local src="$1" dst="$2"
  : "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY je obavezan (šifrovanje prije čuvanja/slanja)}"
  require_cmd openssl
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -pass env:BACKUP_ENCRYPTION_KEY \
    -in "$src" -out "$dst"
}

decrypt_file() {
  local src="$1" dst="$2"
  : "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY je obavezan za dešifrovanje}"
  require_cmd openssl
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -pass env:BACKUP_ENCRYPTION_KEY \
    -in "$src" -out "$dst"
}

write_sha256() {
  local file="$1"
  require_cmd sha256sum
  (cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
}

# Obavezna SHA-256 provjera šifrata prije restora (okrjnjen/izmijenjen fajl pada ovdje).
check_sha256() {
  local file="$1"
  require_cmd sha256sum
  if [ ! -f "${file}.sha256" ]; then
    echo "GREŠKA: nedostaje ${file}.sha256 — odbijam restore." >&2
    exit 4
  fi
  (cd "$(dirname "$file")" && sha256sum --check "$(basename "$file").sha256" >/dev/null)
}

apply_backup_s3_creds() {
  if [ -n "${BACKUP_S3_ACCESS_KEY:-}" ]; then
    export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
  fi
  if [ -n "${BACKUP_S3_SECRET_KEY:-}" ]; then
    export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
  fi
}

validate_dest() {
  local dest_mode="${BACKUP_DEST:-local}"
  case "$dest_mode" in
    local|s3) ;;
    *)
      echo "GREŠKA: BACKUP_DEST mora biti 'local' ili 's3' (dobijeno: $dest_mode)." >&2
      exit 2
      ;;
  esac
}

# Dump mora vidjeti SVE firme: rola bez BYPASSRLS/superuser gubi redove zbog RLS.
assert_backup_role_sees_all() {
  local conn="$1"
  local flags
  flags=$(psql "$conn" -v ON_ERROR_STOP=1 -tAc \
    "SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'ok' ELSE 'rls' END
       FROM pg_roles WHERE rolname = current_user" | tr -d '[:space:]')
  if [ "$flags" != "ok" ]; then
    echo "GREŠKA: DATABASE_BACKUP_URL rola nema BYPASSRLS (niti je superuser) — dump bi izgubio redove drugih firmi zbog RLS." >&2
    exit 5
  fi
}

upload_encrypted() {
  local file="$1"
  local dest_mode="${BACKUP_DEST:-local}"
  if [ "$dest_mode" = "local" ]; then
    return 0
  fi
  require_cmd aws
  apply_backup_s3_creds
  : "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT obavezan za BACKUP_DEST=s3}"
  : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET obavezan (zaseban backup bucket, ne app bucket)}"
  local prefix="${BACKUP_S3_PREFIX:-backups}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  local key="$prefix/$(basename "$file")"
  echo "→ upload s3://$BACKUP_S3_BUCKET/$key"
  AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "$file" "s3://$BACKUP_S3_BUCKET/$key" --only-show-errors
  AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "${file}.sha256" "s3://$BACKUP_S3_BUCKET/${key}.sha256" --only-show-errors
  local man="${file%.dump.enc}.manifest.tsv"
  if [ -f "$man" ]; then
    AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "$man" "s3://$BACKUP_S3_BUCKET/$prefix/$(basename "$man")" --only-show-errors
  fi
}

download_encrypted() {
  local name="$1"
  local dest_dir="$2"
  require_cmd aws
  apply_backup_s3_creds
  : "${BACKUP_S3_ENDPOINT:?}"
  : "${BACKUP_S3_BUCKET:?}"
  local prefix="${BACKUP_S3_PREFIX:-backups}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  mkdir -p "$dest_dir"
  AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "s3://$BACKUP_S3_BUCKET/$prefix/$name" "$dest_dir/$name" --only-show-errors
  AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "s3://$BACKUP_S3_BUCKET/$prefix/${name}.sha256" "$dest_dir/${name}.sha256" --only-show-errors
}
