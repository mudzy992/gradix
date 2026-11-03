#!/usr/bin/env bash
# INF-06 — restore Postgres baze iz dumpa napravljenog `backup.sh`-om.
#
#   RESTORE_DATABASE_URL=postgresql://<korisnik>:<lozinka>@<host>:5432/gradix_restore \
#   ./scripts/ops/restore.sh ./backups/gradix-20261103T030000Z.dump
#
# Zaštite (namjerne):
#   - traži **`RESTORE_DATABASE_URL`**, nikad ne koristi `DATABASE_URL`: restore pregazi bazu,
#     pa cilj mora biti eksplicitan (npr. `_restore` baza ili privremeni kontejner),
#   - odbija restore ako je cilj identičan `DATABASE_URL`,
#   - odbija restore ako ime baze sadrži `prod` (osim uz `ALLOW_PRODUCTION_RESTORE=yes`),
#   - provjerava `sha256` prije nego što dira bazu.
set -euo pipefail

DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  echo "Upotreba: RESTORE_DATABASE_URL=postgresql://... $0 <putanja-do-dumpa>" >&2
  exit 2
fi
if [ ! -f "$DUMP" ]; then
  echo "GREŠKA: dump ne postoji: $DUMP" >&2
  exit 2
fi
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL je obavezan (cilj restore-a, nikad DATABASE_URL)}"

if [ "${DATABASE_URL:-}" = "$RESTORE_DATABASE_URL" ]; then
  echo "GREŠKA: RESTORE_DATABASE_URL je jednak DATABASE_URL — restore bi pregazio izvornu bazu." >&2
  exit 3
fi
case "$RESTORE_DATABASE_URL" in
  *prod*)
    if [ "${ALLOW_PRODUCTION_RESTORE:-}" != "yes" ]; then
      echo "GREŠKA: cilj izgleda kao produkcija (sadrži 'prod'). Za svjesno pokretanje postavi ALLOW_PRODUCTION_RESTORE=yes." >&2
      exit 3
    fi
    ;;
esac

if [ -f "$DUMP.sha256" ] && command -v sha256sum >/dev/null 2>&1; then
  echo "→ provjera sha256"
  (cd "$(dirname "$DUMP")" && sha256sum --check "$(basename "$DUMP").sha256" > /dev/null)
fi

# Prisma dodaje `?schema=public` na URL; libpq (pg_dump/pg_restore/psql) ne poznaje taj parametar
# i pada sa "invalid URI query parameter: schema". Zato se samo taj parametar uklanja, a ostali
# (npr. `sslmode`) ostaju netaknuti.
pg_conn() {
  local url="$1"
  case "$url" in
    *\?*) ;;
    *) printf '%s' "$url"; return ;;
  esac
  local base="${url%%\?*}"
  local query="${url#*\?}"
  local kept=""
  local pair
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

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "GREŠKA: pg_restore nije u PATH-u (instaliraj postgresql-client)." >&2
  exit 2
fi

echo "→ pg_restore u cilj (bez owner/privilegija)"
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --dbname "$(pg_conn "$RESTORE_DATABASE_URL")" \
  "$DUMP"

echo "→ provjera restore-a"
TABLES="${RESTORE_VERIFY_TABLES:-users,projects,tasks,timer_sessions,audit_logs,cost_entries}"
FAILED=0
for table in ${TABLES//,/ }; do
  COUNT="$(psql "$(pg_conn "$RESTORE_DATABASE_URL")" -tAc "SELECT count(*) FROM \"$table\"" 2>/dev/null || echo "ERR")"
  if [ "$COUNT" = "ERR" ]; then
    echo "  ✗ $table: tabela ne postoji u restore-u"
    FAILED=1
  else
    echo "  ✓ $table: $COUNT redova"
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "GREŠKA: restore nije potpun (vidi tabele iznad)." >&2
  exit 4
fi
echo "✓ restore gotov: $DUMP"
