#!/usr/bin/env bash
# Primjenjuje sve migracije redom na praznu bazu + bootstrap rola.
# Namjerno ne koristi `prisma migrate` (ADR 0002): migracije su SQL, naprijed-samo.
#
# Upotreba:
#   ./infra/scripts/db-apply.sh                  # koristi DATABASE_ADMIN_URL
#   DATABASE_ADMIN_URL=postgresql://... ./infra/scripts/db-apply.sh
#
# Admin konekcija (vlasnik šeme) je odvojena od aplikacijske (gradix_app) namjerno:
# aplikacija nikad nije vlasnik tabela, inače RLS ne štiti (ADR 0003).
set -euo pipefail

: "${DATABASE_ADMIN_URL:?Potreban DATABASE_ADMIN_URL (vlasnik šeme, npr. postgres)}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
v2_root="$(cd "$script_dir/../.." && pwd)"

echo "→ role bootstrap"
psql "$DATABASE_ADMIN_URL" -q -v ON_ERROR_STOP=1 -f "$v2_root/packages/db/bootstrap/roles.sql"

for dir in "$v2_root"/packages/db/prisma/migrations/*/; do
  name="$(basename "$dir")"
  if psql "$DATABASE_ADMIN_URL" -Atc "SELECT 1 FROM schema_migrations WHERE name = '$name'" 2>/dev/null | grep -q 1; then
    echo "→ $name (već primijenjena)"
    continue
  fi
  echo "→ $name"
  psql "$DATABASE_ADMIN_URL" -q -v ON_ERROR_STOP=1 -f "$dir/migration.sql"
done

echo "Gotovo."
