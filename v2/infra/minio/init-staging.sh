#!/bin/bash
# Idempotent, staging-only bucket/user/CORS bootstrap. Never prints credential values.
set -euo pipefail

bucket=${MINIO_BUCKET:-gradix-stg}
if [ "$bucket" != "gradix-stg" ]; then
  echo "ERROR: staging MinIO bucket must remain gradix-stg; v1 bucket names are not accepted." >&2
  exit 1
fi

if [ -z "${MINIO_ROOT_USER:-}" ] || [ -z "${MINIO_ROOT_PASSWORD:-}" ]; then
  echo "SKIP: MinIO root credentials are not configured; web startup is independent of this init service."
  exit 0
fi
if [ -z "${MINIO_ACCESS_KEY:-}" ] || [ -z "${MINIO_SECRET_KEY:-}" ]; then
  echo "SKIP: MinIO app credentials are not configured; set MINIO_ACCESS_KEY and MINIO_SECRET_KEY in Coolify secrets."
  exit 0
fi

if [ "${#MINIO_ACCESS_KEY}" -lt 20 ]; then
  echo "ERROR: MINIO_ACCESS_KEY is too short; staging policy requires at least 20 characters." >&2
  exit 1
fi
if [ "${#MINIO_SECRET_KEY}" -lt 32 ]; then
  echo "ERROR: MINIO_SECRET_KEY is too short; staging policy requires at least 32 characters." >&2
  exit 1
fi
if [ "$MINIO_ACCESS_KEY" = "$MINIO_ROOT_USER" ]; then
  echo "ERROR: MINIO_ACCESS_KEY must differ from MINIO_ROOT_USER; MinIO cannot create another user with the root access key." >&2
  exit 1
fi
case "$MINIO_ACCESS_KEY" in
  " "*|*" ")
    echo "ERROR: MINIO_ACCESS_KEY must not have leading or trailing spaces." >&2
    exit 1
    ;;
esac

redact_credentials() {
  local text="$1" value
  local -a secrets=("$MINIO_ROOT_PASSWORD" "$MINIO_SECRET_KEY" "$MINIO_ROOT_USER" "$MINIO_ACCESS_KEY")
  for value in "${secrets[@]}"; do
    if [ -n "$value" ]; then
      text=${text//"$value"/'[REDACTED]'}
    fi
  done
  printf '%s' "$text"
}

run_mc_or_explain() {
  local description="$1" output status
  shift
  if output=$("$@" 2>&1); then
    return 0
  else
    status=$?
  fi
  output=$(redact_credentials "$output")
  printf 'ERROR: %s (mc exit %s)' "$description" "$status" >&2
  if [ -n "$output" ]; then
    printf ': %s' "$output" >&2
  else
    printf ': mc returned no error detail' >&2
  fi
  printf '\n' >&2
  return 1
}

attempt=0
until mc alias set gradix-stg http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 10 ]; then
    echo "ERROR: staging MinIO did not become reachable for bucket initialization." >&2
    exit 1
  fi
  sleep 1
done

if ! mc mb --ignore-existing "gradix-stg/$bucket" >/dev/null 2>&1; then
  echo "ERROR: could not create/verify the isolated staging bucket." >&2
  exit 1
fi

if ! mc admin policy info gradix-stg gradix-stg-app >/dev/null 2>&1; then
  if ! mc admin policy create gradix-stg gradix-stg-app /policy.json >/dev/null 2>&1; then
    echo "ERROR: could not install the staging bucket-scoped app policy." >&2
    exit 1
  fi
fi

# Idempotentno: `mc admin user add` kreira korisnika ILI ažurira lozinku postojećeg.
# Zato promjena MINIO_SECRET_KEY u Coolifyju vrijedi nakon sljedećeg init pokretanja,
# bez ručnog brisanja korisnika; policy attach ispod je takođe idempotentan.
if ! run_mc_or_explain "could not create/update the staging MinIO app user" \
  mc admin user add gradix-stg "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"; then
  exit 1
fi
if ! mc admin policy attach gradix-stg gradix-stg-app --user "$MINIO_ACCESS_KEY" >/dev/null 2>&1; then
  echo "ERROR: could not attach the bucket-scoped staging app policy." >&2
  exit 1
fi

echo "PASS: isolated gradix-stg bucket and app policy are configured (credentials hidden); MinIO API CORS is configured globally by Compose."
