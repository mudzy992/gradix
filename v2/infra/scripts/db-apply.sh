#!/bin/sh
# Primjenjuje sve migracije redom + bootstrap rola i prava. Idempotentno.
# Namjerno ne koristi `prisma migrate` (ADR 0002): migracije su SQL, naprijed-samo.
#
# Upotreba:
#   DATABASE_ADMIN_URL=postgresql://... ./infra/scripts/db-apply.sh
#   ./infra/scripts/db-apply.sh "postgresql://..."     # argument ima prednost
#
# Skripta je POSIX `sh` namjerno: u runtime slici (Alpine) nema bash-a, a ista skripta
# se koristi i u CI-ju i na hostu. Zato nema `pipefail` ni `BASH_SOURCE`.
set -eu

# Admin URL: argument (tako ga zove entrypoint) ili varijabla okoline.
DATABASE_ADMIN_URL="${1:-${DATABASE_ADMIN_URL:-}}"
if [ -z "$DATABASE_ADMIN_URL" ]; then
  echo "GREŠKA: potreban DATABASE_ADMIN_URL (vlasnik šeme) — kao argument ili varijabla." >&2
  exit 1
fi

# psql ne razumije Prisma-style `?schema=public`; odsijeci query string.
DATABASE_ADMIN_URL="${DATABASE_ADMIN_URL%%\?*}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# Dva rasporeda, ista skripta:
#   * u repou:           v2/infra/scripts/db-apply.sh  → ../packages/db/{prisma/migrations,bootstrap}
#   * u runtime slici:   /app/db/apply.sh              → ./migrations, ./bootstrap
if [ -d "$script_dir/../../packages/db/prisma/migrations" ]; then     # v2/infra/scripts/
  mig_dir=$(CDPATH= cd -- "$script_dir/../../packages/db/prisma/migrations" && pwd)
  boot_dir=$(CDPATH= cd -- "$script_dir/../../packages/db/bootstrap" && pwd)
elif [ -d "$script_dir/migrations" ]; then                          # /app/db/
  mig_dir=$(CDPATH= cd -- "$script_dir/migrations" && pwd)
  boot_dir=$(CDPATH= cd -- "$script_dir/bootstrap" && pwd)
else
  echo "GREŠKA: ne nalazim migracije ni bootstrap pored $script_dir." >&2
  exit 1
fi

echo "→ role bootstrap"
psql "$DATABASE_ADMIN_URL" -q -v ON_ERROR_STOP=1 -f "$boot_dir/roles.sql"

for dir in "$mig_dir"/*/; do
  name=$(basename -- "$dir")
  if psql "$DATABASE_ADMIN_URL" -Atc "SELECT 1 FROM schema_migrations WHERE name = '$name'" 2>/dev/null | grep -q 1; then
    echo "→ $name (već primijenjena)"
    continue
  fi
  echo "→ $name"
  psql "$DATABASE_ADMIN_URL" -q -v ON_ERROR_STOP=1 -f "$dir/migration.sql"
done

# Prava se primjenjuju UVIJEK, ne samo pri prvoj migraciji: nova funkcija ili tabela
# bez GRANT-a daje "permission denied" koji se lako previdi.
echo "→ prava"
psql "$DATABASE_ADMIN_URL" -q -v ON_ERROR_STOP=1 -f "$boot_dir/grants.sql"

echo "Gotovo."
