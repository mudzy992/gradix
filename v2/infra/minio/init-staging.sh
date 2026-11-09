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

if [ "${#MINIO_ACCESS_KEY}" -lt 3 ]; then
  echo "ERROR: MINIO_ACCESS_KEY is too short; MinIO requires at least 3 characters." >&2
  exit 1
fi
if [ "${#MINIO_SECRET_KEY}" -lt 8 ]; then
  echo "ERROR: MINIO_SECRET_KEY is too short; MinIO requires at least 8 characters." >&2
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

cors_origin=${MINIO_CORS_ALLOWED_ORIGIN:-https://gradix.ba101.top}
case "$cors_origin" in
  http://*|https://*) ;;
  *) echo "ERROR: MINIO_CORS_ALLOWED_ORIGIN must be an http(s) origin." >&2; exit 1 ;;
esac
case "$cors_origin" in
  *'&'*|*'<'*|*'>'*|*'"'*) echo "ERROR: MINIO_CORS_ALLOWED_ORIGIN contains characters not allowed in the CORS XML origin." >&2; exit 1 ;;
esac

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

if ! mc admin user info gradix-stg "$MINIO_ACCESS_KEY" >/dev/null 2>&1; then
  if ! run_mc_or_explain "could not create the staging MinIO app user" \
    mc admin user add gradix-stg "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"; then
    exit 1
  fi
fi
if ! mc admin policy attach gradix-stg gradix-stg-app --user "$MINIO_ACCESS_KEY" >/dev/null 2>&1; then
  echo "ERROR: could not attach the bucket-scoped staging app policy." >&2
  exit 1
fi

cat >/tmp/gradix-stg-cors.xml <<EOF
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>${cors_origin}</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>Content-Type</ExposeHeader>
    <ExposeHeader>Content-Disposition</ExposeHeader>
    <ExposeHeader>Content-Length</ExposeHeader>
    <MaxAgeSeconds>600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
EOF
if ! run_mc_or_explain "could not apply staging bucket CORS for direct attachment uploads/displays" \
  mc cors set "gradix-stg/$bucket" /tmp/gradix-stg-cors.xml; then
  exit 1
fi

echo "PASS: isolated gradix-stg bucket, app policy, and direct-attachment CORS are configured (credentials hidden)."
