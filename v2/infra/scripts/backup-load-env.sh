#!/usr/bin/env bash
# Učitaj root .env u trenutni shell bez lomljenja na '&' u URL-ovima.
# Upotreba: set -a; eval "$(./v2/infra/scripts/backup-load-env.sh)"; set +a
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
resolve_python() {
  local c
  for c in \
    "${BACKUP_PYTHON:-}" \
    "${LOCALAPPDATA:+$LOCALAPPDATA/Programs/Python/Python312/python.exe}" \
    "${LOCALAPPDATA:+$LOCALAPPDATA/Programs/Python/Python311/python.exe}" \
    "$(command -v python 2>/dev/null || true)"
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
ENV_FILE="$ENV_FILE" "$PY" - <<'PY'
import os, shlex
from pathlib import Path
raw = Path(os.environ["ENV_FILE"]).read_text(encoding="utf-8")
for line in raw.splitlines():
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s:
        continue
    if s.startswith("export "):
        s = s[7:].strip()
    k, _, v = s.partition("=")
    k, v = k.strip(), v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    if k:
        print(f"export {k}={shlex.quote(v)}")
PY
