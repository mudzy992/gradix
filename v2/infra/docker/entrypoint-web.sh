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
  # Migracije idu ADMIN konekcijom (vlasnik šeme). Aplikacijska rola nije vlasnik
  # tabela — inače RLS ne štiti (ADR 0003).
  : "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL je potreban kad je RUN_MIGRATIONS=true}"
  echo "→ provjera baze i primjena migracija"
  psql "$DATABASE_ADMIN_URL" -Atc "SELECT 1" >/dev/null
  sh ./db/apply.sh "$DATABASE_ADMIN_URL"
fi

exec node apps/web/server.js
