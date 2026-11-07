#!/bin/sh
# Redoslijed: provjeri konfiguraciju → (opciono) migracije → pokreni proces.
# Aplikacija NE smije startati sa nepotpunom konfiguracijom (A3.3.7).
set -eu

: "${DATABASE_URL:?DATABASE_URL nedostaje}"
: "${AUTH_SECRET:?AUTH_SECRET nedostaje}"

# Dužina tajne se provjerava u Node-u (sh nema pouzdanu usporedbu dužine stringa).
node -e '
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) {
    console.error("AUTH_SECRET je prekratak (min 32 znaka).");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL nedostaje.");
    process.exit(1);
  }
'

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  # Migracije idu ADMIN konekcijom (vlasnik šeme). Ako DATABASE_ADMIN_URL nije zadan,
  # pretpostavlja se da je aplikacijska rola ujedno vlasnik šeme (Coolify setup sa
  # jednim korisnikom). U modelu A (dvije role) se admin URL MORA zadati.
  ADMIN_URL="${DATABASE_ADMIN_URL:-$DATABASE_URL}"
  # psql ne razumije Prisma-style `?schema=public`.
  ADMIN_URL_CLEAN=$(printf '%s' "$ADMIN_URL" | cut -d'?' -f1)
  echo "→ provjera baze i primjena migracija"
  # Kratki retry: na svježem deployu baza ili DNS mogu zakasniti nekoliko sekundi.
  i=0
  until psql "$ADMIN_URL_CLEAN" -Atc "SELECT 1" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 10 ]; then
      echo "GREŠKA: baza nije dostupna nakon 10 pokušaja — provjeri DATABASE_URL i mrežu." >&2
      exit 1
    fi
    echo "  ... baza još ne odgovara (pokušaj $i/10), čekam 3 s"
    sleep 3
  done
  sh ./db/apply.sh "$ADMIN_URL_CLEAN"
fi

echo "→ start: node apps/web/server.js (port ${PORT:-3000})"
exec node apps/web/server.js
