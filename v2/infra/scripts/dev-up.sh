#!/usr/bin/env bash
# "Jednom komandom" iz G1 demo skripte:
#   ./infra/scripts/dev-up.sh
#
# Šta radi:
#   1. podigne Postgres (+ MinIO) kroz docker compose
#   2. sačeka da baza primi vezu
#   3. primijeni migracije i bootstrap rola (idempotentno)
#   4. napuni demo podatke
#   5. ispiše šta je spremno i koje su prijavne kombinacije
#
# Ne pokreće `pnpm dev` — to je svjesno, da bi korisnik vidio izlaz i sam otvorio app.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
v2_root="$(cd "$script_dir/../.." && pwd)"
cd "$v2_root"

: "${SEED_PASSWORD:=demo-lozinka-123}"
export DATABASE_URL="${DATABASE_URL:-postgresql://gradix_app@127.0.0.1:5432/gradix?schema=public}"
export DATABASE_ADMIN_URL="${DATABASE_ADMIN_URL:-postgresql://postgres:postgres@127.0.0.1:5432/gradix}"
export AUTH_SECRET="${AUTH_SECRET:-lokalni-razvoj-secret-min-32-znaka-123456}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker nije instaliran. Alternativa bez Dockera: pokreni vlastiti PostgreSQL 16 i postavi DATABASE_URL/DATABASE_ADMIN_URL." >&2
  exit 1
fi

echo "→ podizanje zavisnosti"
docker compose -f infra/compose/docker-compose.local.yml up -d

echo "→ čekanje na bazu"
for _ in $(seq 1 30); do
  if docker compose -f infra/compose/docker-compose.local.yml exec -T postgres pg_isready -U postgres -d gradix >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "→ migracije"
DATABASE_ADMIN_URL="$DATABASE_ADMIN_URL" ./infra/scripts/db-apply.sh

echo "→ demo podaci"
pnpm --filter @gradix/web exec tsx scripts/seed.ts

cat <<INFO

Spremno.
  Web:    pnpm --filter @gradix/web dev   → http://localhost:3000
  Teren:  pnpm --filter @gradix/mobile start (Expo) ili export -p web

Prijave (seed):
  ured@demo.ba     / $SEED_PASSWORD   (ADMIN, Niskogradnja Demo)
  vlasnik@demo.ba  / $SEED_PASSWORD   (OWNER, Niskogradnja Demo)
  vlasnik@druga.ba / $SEED_PASSWORD   (OWNER, Druga Firma — za provjeru izolacije)
INFO
