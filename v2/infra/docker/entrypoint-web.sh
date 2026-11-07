#!/bin/sh
# Redoslijed: provjeri konfiguraciju → (opciono) migracije → pokreni proces.
# Aplikacija NE smije startati sa nepotpunom konfiguracijom (A3.3.7).
set -eu

: "${DATABASE_URL:?DATABASE_URL nedostaje}"
: "${AUTH_SECRET:?AUTH_SECRET nedostaje}"

#
# psql ne razumije Prisma-stil `?schema=public`, ali RAZUMIJE `sslmode` i `sslrootcert`.
# Prva verzija je odsijecala cijeli query string (`cut -d'?' -f1`) i time je tiho brisala
# TLS parametre — baza koja traži TLS onda padne sa nejasnom porukom. Sada se uklanja
# SAMO `schema=`, sve ostalo ostaje netaknuto.
#
sanitize_pg_url() {
  printf '%s' "$1" | sed -E 's/[?&]schema=[^&]*//; s/\?&/?/; s/\?$//'
}

node -e '
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) {
    console.error("GREŠKA: AUTH_SECRET je prekratak (min 32 znaka).");
    process.exit(1);
  }
  if ((process.env.DATABASE_URL ?? "").includes("&amp;")) {
    console.error("GREŠKA: DATABASE_URL sadrži HTML entity `&amp;` umjesto `&` — copy/paste iz HTML-a.");
    process.exit(1);
  }
'

#
# `sslrootcert` u URL-u je putanja do fajla. Ako fajl ne postoji, `psql`/`pg` padnu pri
# PARSIRANJU URL-a — poruka onda izgleda kao „baza ne odgovara“, a problem je mount.
# Zato: ako CA nema, parametar se ukloni (UZ GLASNO UPOZORENJE) i pokušaj ide dalje.
# Ne izmišljamo „ne provjeravaj certifikat“ — `sslmode` ostaje kakav jeste, pa
# `verify-full` i dalje pada, ali sa pravom TLS greškom umjesto ENOENT.
#
strip_missing_ca() {
  url="$1"
  label="$2"
  ca=$(printf '%s' "$url" | sed -nE 's/.*[?&]sslrootcert=([^&]*).*/\1/p')
  if [ -n "$ca" ] && [ ! -f "$ca" ]; then
    echo "UPOZORENJE: $label traži CA na '$ca', ali tog fajla nema u kontejneru." >&2
    echo "  Mount u compose-u: /data/coolify/ssl/coolify-ca.crt -> /etc/ssl/certs/coolify-ca.crt" >&2
    echo "  Nastavljam bez sslrootcert — ako baza traži TLS, greška će sada biti TLS greška." >&2
    printf '%s' "$url" | sed -E 's/[?&]sslrootcert=[^&]*//' | sed -E '/\?/!s/&/?/'
    return 0
  fi
  [ -n "$ca" ] && echo "→ CA: $ca ($(wc -c <"$ca" | tr -d ' ') bajtova)"
  printf '%s' "$url"
}

DATABASE_URL_CLEAN=$(sanitize_pg_url "$DATABASE_URL")
DATABASE_URL_CLEAN=$(strip_missing_ca "$DATABASE_URL_CLEAN" "DATABASE_URL")

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  # Migracije idu ADMIN konekcijom (vlasnik šeme). Ako DATABASE_ADMIN_URL nije zadan,
  # pretpostavlja se da je aplikacijska rola ujedno vlasnik šeme (model B).
  # U modelu C (administrator `gradix` posjeduje šemu, `gradix_app` je samo aplikacija)
  # DATABASE_ADMIN_URL je OBAVEZAN — inače `gradix_app` nema CREATE na public šemi.
  ADMIN_URL="${DATABASE_ADMIN_URL:-$DATABASE_URL}"
  ADMIN_URL_CLEAN=$(sanitize_pg_url "$ADMIN_URL")
  ADMIN_URL_CLEAN=$(strip_missing_ca "$ADMIN_URL_CLEAN" "DATABASE_ADMIN_URL")

  echo "→ provjera baze i primjena migracija"

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
    echo "  ... baza još ne odgovara (pokušaj $i/10, za 3 s): $last_error"
    sleep 3
  done

  # Tko radi migracije? U modelu C `gradix_app` nema CREATE na public šemi — bolje
  # reći to odmah nego pustiti migraciju da padne na trećem koraku.
  can_create=$(psql "$ADMIN_URL_CLEAN" -Atc "SELECT has_schema_privilege(current_user, 'public', 'CREATE')" || echo "f")
  if [ "$can_create" != "t" ]; then
    echo "GREŠKA: rola koja radi migracije nema CREATE na šemi public." >&2
    echo "  Postavi DATABASE_ADMIN_URL na vlasnika šeme (u Coolifyju: konekcija role 'gradix')," >&2
    echo "  ili daj pravo: GRANT CREATE ON SCHEMA public TO <rola>;  (vidi docs/COOLIFY.md §4)" >&2
    exit 1
  fi

  sh ./db/apply.sh "$ADMIN_URL_CLEAN"
fi

echo "→ start: node apps/web/server.js (port ${PORT:-3000})"
exec node apps/web/server.js
