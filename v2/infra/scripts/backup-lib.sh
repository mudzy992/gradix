#!/usr/bin/env bash
# Zajedničke pomoćne funkcije za backup/restore. Izvor: v1/scripts/ops/backup.sh (pg_conn ideja).
# shellcheck shell=bash
set -euo pipefail

pg_conn() {
  local url="$1"
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
      schema=*) continue ;;
    esac
    kept="${kept:+$kept&}$pair"
  done
  if [ -n "$kept" ]; then
    printf '%s?%s' "$base" "$kept"
  else
    printf '%s' "$base"
  fi
}

pg_host_from_url() {
  local url
  url="$(pg_conn "$1")"
  printf '%s' "$url" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://([^@/]*@)?([^/:?]+).*#\2#'
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

encrypt_file() {
  local src="$1" dst="$2"
  : "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY je obavezan (šifrovanje prije slanja/čuvanja)}"
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

check_sha256() {
  local file="$1"
  if [ -f "${file}.sha256" ]; then
    require_cmd sha256sum
    (cd "$(dirname "$file")" && sha256sum --check "$(basename "$file").sha256" >/dev/null)
  fi
}

# Odredište na istom hostu kao baza / lokalni disk = nije van hosta.
warn_if_not_off_host() {
  local dest_mode="${BACKUP_DEST:-local}"
  local db_url="${DATABASE_BACKUP_URL:-${DATABASE_ADMIN_URL:-${DATABASE_URL:-}}}"
  local db_host="" s3_host=""
  if [ -n "$db_url" ]; then
    db_host="$(pg_host_from_url "$db_url")"
  fi
  case "$dest_mode" in
    local)
      echo "UPOZORENJE: NIJE VAN HOSTA — odredište je lokalni direktorij na istom hostu." >&2
      return 0
      ;;
    s3)
      s3_host="${BACKUP_S3_ENDPOINT:-}"
      s3_host="${s3_host#https://}"
      s3_host="${s3_host#http://}"
      s3_host="${s3_host%%/*}"
      s3_host="${s3_host%%:*}"
      if [ "${BACKUP_OFFHOST:-}" = "true" ]; then
        echo "→ odredište označeno kao van hosta (BACKUP_OFFHOST=true)."
        return 0
      fi
      if [ -n "$db_host" ] && [ -n "$s3_host" ] && [ "$db_host" = "$s3_host" ]; then
        echo "UPOZORENJE: NIJE VAN HOSTA — S3 endpoint je isti host kao baza ($s3_host)." >&2
        return 0
      fi
      # Isti Coolify server: interni MinIO DNS ili loopback.
      case "$s3_host" in
        minio|localhost|127.0.0.1|"" )
          echo "UPOZORENJE: NIJE VAN HOSTA — S3 endpoint ($s3_host) je na istom serveru kao aplikacija/baza." >&2
          ;;
      esac
      ;;
    *)
      echo "GREŠKA: BACKUP_DEST mora biti 'local' ili 's3' (dobijeno: $dest_mode)." >&2
      exit 2
      ;;
  esac
}

upload_encrypted() {
  local file="$1"
  local dest_mode="${BACKUP_DEST:-local}"
  if [ "$dest_mode" = "local" ]; then
    return 0
  fi
  require_cmd aws
  : "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT obavezan za BACKUP_DEST=s3}"
  : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET obavezan za BACKUP_DEST=s3}"
  local prefix="${BACKUP_S3_PREFIX:-gradix/backups}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  local key="$prefix/$(basename "$file")"
  echo "→ upload s3://$BACKUP_S3_BUCKET/$key"
  AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "$file" "s3://$BACKUP_S3_BUCKET/$key" --only-show-errors
  if [ -f "${file}.sha256" ]; then
    AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "${file}.sha256" "s3://$BACKUP_S3_BUCKET/${key}.sha256" --only-show-errors
  fi
  local man="${file%.dump.enc}.manifest.tsv"
  if [ -f "$man" ]; then
    AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "$man" "s3://$BACKUP_S3_BUCKET/$prefix/$(basename "$man")" --only-show-errors
  fi
}

download_encrypted() {
  local name="$1"
  local dest_dir="$2"
  require_cmd aws
  : "${BACKUP_S3_ENDPOINT:?}"
  : "${BACKUP_S3_BUCKET:?}"
  local prefix="${BACKUP_S3_PREFIX:-gradix/backups}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  mkdir -p "$dest_dir"
  AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "s3://$BACKUP_S3_BUCKET/$prefix/$name" "$dest_dir/$name" --only-show-errors
  AWS_ENDPOINT_URL="$BACKUP_S3_ENDPOINT" aws s3 cp "s3://$BACKUP_S3_BUCKET/$prefix/${name}.sha256" "$dest_dir/${name}.sha256" --only-show-errors || true
}
