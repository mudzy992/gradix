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

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl nije u PATH." >&2
  exit 2
fi
resolve_python() {
  local c
  for c in \
    "${BACKUP_PYTHON:-}" \
    "${LOCALAPPDATA:+$LOCALAPPDATA/Programs/Python/Python312/python.exe}" \
    "${LOCALAPPDATA:+$LOCALAPPDATA/Programs/Python/Python311/python.exe}" \
    "$(command -v python 2>/dev/null || true)" \
    "$(command -v python3 2>/dev/null || true)"
  do
    [ -n "$c" ] || continue
    case "$c" in *WindowsApps*) continue ;; esac
    if "$c" -c "import sys" >/dev/null 2>&1; then
      printf '%s' "$c"
      return 0
    fi
  done
  return 1
}
PY="$(resolve_python)" || { echo "ERROR: python nije u PATH." >&2; exit 2; }

# Sigurno čitanje/upis .env (podržava & u URL-ovima). Ne printa vrijednosti.
ENV_FILE="$ENV_FILE" "$PY" - <<'PY'
import os, secrets, urllib.parse
from pathlib import Path

env_path = Path(os.environ["ENV_FILE"])
text = env_path.read_text(encoding="utf-8")

def parse_env(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        if s.startswith("export "):
            s = s[7:].strip()
        k, _, v = s.partition("=")
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k] = v
    return out

def upsert(raw: str, updates: dict[str, str]) -> str:
    keys = set(updates)
    lines = []
    seen: set[str] = set()
    for line in raw.splitlines():
        s = line.strip()
        key = None
        if s and not s.startswith("#") and "=" in s:
            body = s[7:].strip() if s.startswith("export ") else s
            key = body.partition("=")[0].strip()
        if key in keys:
            if key not in seen:
                lines.append(f"{key}={updates[key]}")
                seen.add(key)
            continue
        lines.append(line)
    for key, val in updates.items():
        if key not in seen:
            lines.append(f"{key}={val}")
    return "\n".join(lines).rstrip() + "\n"

data = parse_env(text)
admin = data.get("DATABASE_ADMIN_URL") or ""
if not admin:
    raise SystemExit("ERROR: DATABASE_ADMIN_URL mora postojati u .env")
root_user = data.get("MINIO_ROOT_USER") or ""
root_pass = data.get("MINIO_ROOT_PASSWORD") or ""
if not root_user or not root_pass:
    raise SystemExit("ERROR: MINIO_ROOT_USER/MINIO_ROOT_PASSWORD potrebni za provision")

def keep_or(key: str, factory):
    cur = data.get(key) or ""
    return cur if cur else factory()

enc = keep_or("BACKUP_ENCRYPTION_KEY", lambda: secrets.token_hex(32))
role_pw = keep_or("BACKUP_ROLE_PASSWORD", lambda: secrets.token_urlsafe(24))
ak = keep_or("BACKUP_S3_ACCESS_KEY", lambda: "gx2bak" + secrets.token_hex(10))
sk = keep_or("BACKUP_S3_SECRET_KEY", lambda: secrets.token_hex(32))
bucket = keep_or("BACKUP_S3_BUCKET", lambda: "gradix-stg-backups")
endpoint = data.get("BACKUP_S3_ENDPOINT") or data.get("MINIO_PUBLIC_ENDPOINT") or data.get("MINIO_ENDPOINT") or ""
if not endpoint:
    raise SystemExit("ERROR: BACKUP_S3_ENDPOINT ili MINIO_PUBLIC_ENDPOINT mora postojati")
prefix = keep_or("BACKUP_S3_PREFIX", lambda: "backups")
dest = keep_or("BACKUP_DEST", lambda: "s3")

u = urllib.parse.urlparse(admin)
host = u.hostname or ""
port = f":{u.port}" if u.port else ""
auth = urllib.parse.quote("gradix_backup", safe="") + ":" + urllib.parse.quote(role_pw, safe="")
backup_url = urllib.parse.urlunparse((u.scheme, f"{auth}@{host}{port}", u.path or "/gradix", "", u.query, ""))
restore_admin = urllib.parse.urlunparse((u.scheme, u.netloc, "/gradix_restore", "", u.query, ""))

updates = {
    "BACKUP_ENCRYPTION_KEY": enc,
    "BACKUP_ROLE_PASSWORD": role_pw,
    "BACKUP_DEST": dest,
    "BACKUP_S3_ENDPOINT": endpoint,
    "BACKUP_S3_BUCKET": bucket,
    "BACKUP_S3_PREFIX": prefix,
    "BACKUP_S3_ACCESS_KEY": ak,
    "BACKUP_S3_SECRET_KEY": sk,
    "DATABASE_BACKUP_URL": backup_url,
    "RESTORE_ADMIN_URL": restore_admin,
}
env_path.write_text(upsert(text, updates), encoding="utf-8")
print("PASS: backup varijable upisane u lokalni .env (vrijednosti sakrivene).")
print("KEYS: " + " ".join(updates.keys()))
PY
