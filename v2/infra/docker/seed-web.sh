#!/bin/sh
# Demo seed iz produkcijske slike, bez `tsx` i bez dev zavisnosti.
#
# Zašto ovako: `apps/web/scripts/seed.ts` je razvojna skripta (TypeScript, traži tsx),
# a runtime slika namjerno nema dev alate. Zato se seed kompajlira u build fazi u
# običan JavaScript (`seed.mjs`) i ovdje samo pokreće.
#
# Pokretanje (Coolify → resource → Terminal):
#   SEED_PASSWORD='jaka-lozinka' ./seed.sh
#
# Skripta je idempotentna: ponovni seed ne pravi duplikate.
set -eu

: "${SEED_PASSWORD:?Potreban SEED_PASSWORD (min 10 znakova)}"
: "${DATABASE_ADMIN_URL:=${DATABASE_URL:-}}"
if [ -z "$DATABASE_ADMIN_URL" ]; then
  echo "GREŠKA: potreban DATABASE_URL ili DATABASE_ADMIN_URL." >&2
  exit 1
fi

# `seed.mjs` stoji pored ove skripte (u slici: /app/seed.mjs). Putanja se računa,
# a ne hardkodira, da skripta radi i van slike.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# `withCompany` u seederu piše tenant tabele kroz RLS scope — radi i kad je
# aplikacijska rola vlasnik šeme (Coolify model B, ADR 0007).
DATABASE_ADMIN_URL=$(printf '%s' "$DATABASE_ADMIN_URL" | cut -d'?' -f1) \
  node "$script_dir/seed.mjs"
