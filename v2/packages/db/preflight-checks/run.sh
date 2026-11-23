#!/bin/sh
# Runtime + CI database security preflight. Optional service diagnostics run separately after this gate.
# Kritične provjere SQL-a moraju koristiti DATABASE_URL (aplikacijska rola).
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
database_url="${1:-${DATABASE_URL:-}}"
if [ -z "$database_url" ]; then
  echo "GREŠKA: preflight traži DATABASE_URL (aplikacijska rola), ne DATABASE_ADMIN_URL." >&2
  exit 1
fi

# psql ne razumije Prisma `?schema=public`; sačuvaj TLS parametre, ukloni samo schema.
database_url=$(printf '%s' "$database_url" | sed -E 's/[?&]schema=[^&]*//' | sed -E '/\?/!s/&/?/')

echo "→ preflight: kritične provjere baze i privilege-matrix.tsv (konekcija iz DATABASE_URL)"
if ! (
  cd "$script_dir" &&
  PGCONNECT_TIMEOUT=10 psql "$database_url" -X -v ON_ERROR_STOP=1 -q -f 001_security.sql &&
  PGCONNECT_TIMEOUT=10 psql "$database_url" -X -v ON_ERROR_STOP=1 -q -f 002_privileges.sql
); then
  echo "GREŠKA: kritični preflight nije prošao; aplikacija se neće pokrenuti." >&2
  exit 1
fi

# Redis and S3/MinIO are explicitly not startup gates. The entrypoint launches the bounded,
# secret-safe Node diagnostic at /app/diagnostics/run.mjs after this database-only preflight.
exit 0
