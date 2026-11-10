#!/bin/sh
# Redoslijed: provjeri konfiguraciju → (opciono) migracije → pokreni proces.
# Aplikacija NE smije startati sa nepotpunom konfiguracijom (A3.3.7).
set -eu

: "${DATABASE_URL:?DATABASE_URL nedostaje}"
: "${AUTH_SECRET:?AUTH_SECRET nedostaje}"

#
# DVIJE FUNKCIJE, JEDNO PRAVILO: na STDOUT ide ISKLJUČIVO očišćeni URL, jer se rezultat
# hvata u `$(...)`. Sve poruke (i upozorenja i informacije) idu na STDERR.
#
# Zašto je ovo napisano ovako: prva verzija je imala `echo "→ CA: ..."` bez `>&2`.
# Taj tekst je ušao u varijablu, pa je psql dobio
#   "→ CA: /etc/ssl/certs/coolify-ca.crt (891 bajtova)\npostgresql://..."
# i javio `missing "=" after "→" in connection info string`. Greška je bila moja, ne baze.
#
# psql ne razumije Prisma-stil `?schema=public`, ali RAZUMIJE `sslmode` i `sslrootcert`.
# Uklanja se SAMO `schema=`.
#
sanitize_pg_url() {
  printf '%s\n' "$1" | sed -E 's/[?&]schema=[^&]*//' | sed -E '/\?/!s/&/?/'
}

# Ako `sslrootcert` pokazuje na fajl kojeg nema, ukloni parametar (UZ upozorenje) —
# inače psql/pg padnu pri parsiranju URL-a i poruka govori o bazi, a problem je mount.
# Ne izmišljamo „ne provjeravaj certifikat“: `sslmode` ostaje kakav jeste, pa
# `verify-full` i dalje pada — samo sa pravom TLS greškom umjesto ENOENT.
strip_missing_ca() {
  url="$1"
  label="$2"
  ca=$(printf '%s\n' "$url" | sed -nE 's/.*[?&]sslrootcert=([^&]*).*/\1/p')
  if [ -z "$ca" ]; then
    printf '%s\n' "$url"
    return 0
  fi
  if [ -f "$ca" ]; then
    echo "→ CA ($label): $ca ($(wc -c <"$ca" | tr -d ' ') bajtova)" >&2
    printf '%s\n' "$url"
    return 0
  fi
  echo "UPOZORENJE: $label traži CA na '$ca', ali tog fajla nema u kontejneru." >&2
  echo "  Compose montira CA na /etc/ssl/certs/coolify-ca.crt (docs/COOLIFY.md §2)." >&2
  echo "  Ako je fajl na hostu drugdje, postavi POSTGRES_CA_FILE na tu putanju." >&2
  echo "  Nastavljam bez sslrootcert — ako baza traži TLS, greška će sada biti TLS greška." >&2
  printf '%s\n' "$url" | sed -E 's/[?&]sslrootcert=[^&]*//' | sed -E '/\?/!s/&/?/'
}

DATABASE_URL_CLEAN=$(sanitize_pg_url "$DATABASE_URL")
DATABASE_URL_CLEAN=$(strip_missing_ca "$DATABASE_URL_CLEAN" "DATABASE_URL")

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  # Migracije moraju ići odvojenom administratorskom/vlasničkom rolom. Nikad ne koristimo
  # DATABASE_URL za DDL: aplikacijska rola ne smije biti vlasnik tabela jer bi zaobilazila RLS.
  : "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL nedostaje; RUN_MIGRATIONS=true traži odvojenu rolu vlasnika šeme}"
  ADMIN_URL_CLEAN=$(sanitize_pg_url "$DATABASE_ADMIN_URL")
  ADMIN_URL_CLEAN=$(strip_missing_ca "$ADMIN_URL_CLEAN" "DATABASE_ADMIN_URL")

  echo "→ provjera baze i primjena migracija" >&2

  # Kratki retry: na svježem deployu baza ili DNS mogu zakasniti nekoliko sekundi.
  # Greška se ispisuje ODMAH i u cjelini — bez toga „ne odgovara“ ne kaže ništa korisno.
  i=0
  last_error=""
  while :; do
    if last_error=$(PGCONNECT_TIMEOUT=10 psql "$ADMIN_URL_CLEAN" -Atc "SELECT 1" 2>&1); then
      break
    fi
    i=$((i + 1))
    if [ "$i" -ge 10 ]; then
      echo "GREŠKA: baza nije dostupna nakon 10 pokušaja." >&2
      echo "  host: $(printf '%s' "$ADMIN_URL_CLEAN" | sed -E 's#^[a-z]+://([^@]*@)?([^/:?]+).*#\2#')" >&2
      echo "  zadnja greška: $last_error" >&2
      echo "  provjeri: (1) je li host ime Postgres resource-a iz Coolifyja," >&2
      echo "           (2) je li kontejner na istoj mreži (ne 'localhost')," >&2
      echo "           (3) postoji li CA na putanji iz sslrootcert," >&2
      echo "           (4) je li u URL-u '&amp;' umjesto '&'." >&2
      exit 1
    fi
    echo "  ... baza još ne odgovara (pokušaj $i/10, za 3 s): $last_error" >&2
    sleep 3
  done

  # Migrator mora imati CREATE na public šemi — provjeri odmah, prije djelimične migracije.
  can_create=$(psql "$ADMIN_URL_CLEAN" -Atc "SELECT has_schema_privilege(current_user, 'public', 'CREATE')" || echo "f")
  if [ "$can_create" != "t" ]; then
    echo "GREŠKA: rola koja radi migracije nema CREATE na šemi public." >&2
    echo "  Postavi DATABASE_ADMIN_URL na vlasnika šeme (u Coolifyju: konekcija role 'gradix')," >&2
    echo "  ili daj pravo: GRANT CREATE ON SCHEMA public TO <rola>;  (vidi docs/COOLIFY.md §4)" >&2
    exit 1
  fi

  sh ./db/apply.sh "$ADMIN_URL_CLEAN"
fi

# Poslije migracija administratorske varijable više ne smiju postojati u okruženju
# nijednog procesa (ni dijagnostike u pozadini ni Node servera). Ne "export" — brišu se.
unset DATABASE_ADMIN_URL SEED_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD ADMIN_URL_CLEAN DATABASE_ADMIN_URL_CLEAN || true

# Kritične provjere nakon migracija, ali prije starta. Skripta se spaja kao DATABASE_URL,
# nikad kao admin; ako RLS/rola/mehanizam nisu ispravni, proces se ne podiže.
echo "→ preflight okruženja" >&2
./db/preflight-checks/run.sh "$DATABASE_URL_CLEAN"

# Redis/S3 checks are informational and bounded; run after the blocking DB preflight without
# delaying startup. The Node diagnostic always exits successfully and never prints credentials.
if [ -f ./diagnostics/run.mjs ]; then
  (node ./diagnostics/run.mjs || echo "UPOZORENJE: opcionalna Redis/S3 dijagnostika nije mogla završiti." >&2) &
fi

echo "→ start: node apps/web/server.js (port ${PORT:-3000})" >&2
exec env -u DATABASE_ADMIN_URL -u SEED_PASSWORD -u MINIO_ROOT_USER -u MINIO_ROOT_PASSWORD node apps/web/server.js
