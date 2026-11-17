#!/usr/bin/env bash
# Idempotentno: zaseban backup bucket + MinIO korisnik (policy samo taj bucket).
# MINIO_ROOT_* samo za kreiranje; BACKUP_S3_* = odredište. Bez ispisa tajni.
set -euo pipefail

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER obavezan (samo za provision)}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD obavezan (samo za provision)}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT obavezan}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET obavezan}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY obavezan}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY obavezan}"

if [ -n "${MINIO_BUCKET:-}" ] && [ "$BACKUP_S3_BUCKET" = "$MINIO_BUCKET" ]; then
  echo "ERROR: BACKUP_S3_BUCKET mora biti različit od app MINIO_BUCKET." >&2
  exit 1
fi
if [ -n "${MINIO_ACCESS_KEY:-}" ] && [ "$BACKUP_S3_ACCESS_KEY" = "$MINIO_ACCESS_KEY" ]; then
  echo "ERROR: BACKUP_S3_ACCESS_KEY mora biti različit od MINIO_ACCESS_KEY." >&2
  exit 1
fi
if [ "$BACKUP_S3_ACCESS_KEY" = "$MINIO_ROOT_USER" ]; then
  echo "ERROR: BACKUP_S3_ACCESS_KEY mora biti različit od MINIO_ROOT_USER." >&2
  exit 1
fi
if [ "${#BACKUP_S3_ACCESS_KEY}" -lt 16 ] || [ "${#BACKUP_S3_SECRET_KEY}" -lt 32 ]; then
  echo "ERROR: BACKUP_S3 ključevi prekratki (access>=16, secret>=32)." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker je potreban za mc." >&2
  exit 2
fi

POLICY_JSON=$(mktemp)
trap 'rm -f "$POLICY_JSON"' EXIT
cat >"$POLICY_JSON" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::${BACKUP_S3_BUCKET}"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::${BACKUP_S3_BUCKET}/*"]
    }
  ]
}
EOF

MC_IMAGE="${BACKUP_MC_IMAGE:-quay.io/minio/mc:RELEASE.2025-12-19T20-11-44Z}"
export MINIO_ROOT_USER MINIO_ROOT_PASSWORD BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET
export BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY

docker run --rm \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD \
  -e BACKUP_S3_ENDPOINT -e BACKUP_S3_BUCKET \
  -e BACKUP_S3_ACCESS_KEY -e BACKUP_S3_SECRET_KEY \
  -v "${POLICY_JSON}:/policy.json:ro" \
  --entrypoint /bin/sh \
  "$MC_IMAGE" \
  -ec '
    mc alias set prov "$BACKUP_S3_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mb --ignore-existing "prov/$BACKUP_S3_BUCKET" >/dev/null
    mc admin policy create prov gradix-backup-only /policy.json >/dev/null 2>&1 \
      || mc admin policy create prov gradix-backup-only /policy.json
    mc admin user add prov "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" >/dev/null 2>&1 \
      || true
    mc admin user add prov "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" >/dev/null 2>&1 || true
    mc admin policy attach prov gradix-backup-only --user "$BACKUP_S3_ACCESS_KEY" >/dev/null
  '

echo "PASS: backup bucket i korisnik konfigurirani (vrijednosti sakrivene)."
