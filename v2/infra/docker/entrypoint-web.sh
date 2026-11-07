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
'

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  # Migracije idu ADMIN konekcijom (vlasnik šeme). Ako DATABASE_ADMIN_URL nije zadan,
  # pretpostavlja se da je aplikacijska rola ujedno vlasnik šeme (Coolify setup sa
  # jednim korisnikom). U modelu A (dvije role) se admin URL MORA zadati.
  ADMIN_URL="${DATABASE_ADMIN_URL:-$DATABASE_URL}"
  echo "→ provjera baze i primjena migracija (rola: ${ADMIN_URL%%:*}...)"
  # Ukloni query parametre koje psql ne razumije (?schema=public iz Prisma URL-a).
  ADMIN_URL_CLEAN="${ADMIN_URL%%\?*}"
  psql "$ADMIN_URL_CLEAN" -Atc "SELECT 1" >/dev/null
  sh ./db/apply.sh "$ADMIN_URL_CLEAN"
fi

exec node apps/web/server.js
