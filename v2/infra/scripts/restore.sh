#!/bin/sh
# 2a — restore dump-a u PRAZNU ciljnu bazu + provjera redova protiv manifesta
# iz backupa (backup.sh piše manifest uz svaki dump).
#
# Upotreba:
#   RESTORE_DATABASE_URL=postgresql://... ./infra/scripts/restore.sh <putanja do dump-a>
#
# Brane (namjerne, tvrde):
#   1. ciljna baza MORA biti PRAZNA (0 tabela u public šemi) — restore preko
#      žive baze se ne radi; pokriva se nova baza, provjeri, pa prebaci aplikaciju;
#   2. cilj MORA biti RAZLIČITA baza od izvorne (ime iz DATABASE_ADMIN_URL);
#   3. brojevi redova MORAJU se poklapati s manifestom, inače skripta pada.
#
# Preduslov na novom serveru: role iz v2/packages/db/bootstrap/roles.sql već
# postoje (dump nosi GRANT-ove za te role; same role su klaster-nivo).
# Postupak od početka do kraja: docs/COOLIFY.md §12.
#
# POSIX sh namjerno (kao db-apply.sh).
set -eu

fail() { echo "GREŠKA: $*" >&2; exit 1; }

[ "$#" -eq 1 ] || fail "upotreba: restore.sh <putanja do dump-a>"
dump=$1
[ -f "$dump" ] || fail "dump ne postoji: $dump"
[ -s "$dump" ] || fail "dump je prazan: $dump"
[ -n "${RESTORE_DATABASE_URL:-}" ] || fail "potreban RESTORE_DATABASE_URL (ciljna, PRAZNA baza)."
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore nije na PATH-u."
command -v psql >/dev/null 2>&1 || fail "psql nije na PATH-u."

# psql/pg_restore ne razumiju Prisma-style `?schema=public` (isto čišćenje kao db-apply.sh).
TARGET_URL=$(printf '%s' "$RESTORE_DATABASE_URL" \
  | sed -E 's/[?&]schema=[^&]*//' \
  | sed -E '/\?/!s/&/?/')

# Brana 2: cilj nije izvor (usporedba imena baze iz URL-a).
src_name=$(printf '%s' "${DATABASE_ADMIN_URL:-}" | sed -E 's#.*/([^/?]+)([?].*)?$#\1#')
dst_name=$(printf '%s' "$TARGET_URL" | sed -E 's#.*/([^/?]+)([?].*)?$#\1#')
if [ -n "$src_name" ] && [ "$src_name" = "$dst_name" ]; then
  fail "ciljna baza je ISTA kao izvorna ($dst_name) — restore ide u novu (praznu) bazu, nikad preko izvora."
fi

# Brana 1: cilj mora biti prazan — pg_restore preko postojećih tabela je nered.
existing=$(psql "$TARGET_URL" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
[ "$existing" = "0" ] || fail "ciljna baza nije prazna ($existing tabela) — restore se radi u praznu bazu (nova baza ili drop/create)."

manifest="${dump%.dump}.manifest.tsv"
start=$(date +%s)

echo "→ pg_restore u bazu: $dst_name"
pg_restore --no-owner --dbname="$TARGET_URL" "$dump"

# Brana 3: redovi se poklapaju s manifestom iz trenutka backupa.
if [ -f "$manifest" ]; then
  failed=0
  checked=0
  while IFS="$(printf '\t')" read -r t c; do
    [ -n "$t" ] || continue
    got=$(psql "$TARGET_URL" -Atc "SELECT count(*) FROM public.\"$t\"")
    checked=$((checked + 1))
    if [ "$got" != "$c" ]; then
      echo "  ✗ $t: manifest=$c restore=$got" >&2
      failed=1
    fi
  done < "$manifest"
  if [ "$failed" -ne 0 ]; then
    fail "restore se NE poklapa s manifestom backupa — baza $dst_name NIJE pouzdana za prebacivanje."
  fi
  echo "  ✓ $checked tabela poklapa se s manifestom backupa."
else
  echo "UPOZORENJE: manifest (${manifest##*/}) nije nađen pored dump-a —" >&2
  echo "brojevi redova nisu provjereni; pokreni provjeru ručno prije prebacivanja." >&2
fi

end=$(date +%s)
echo "Restore završen za $((end - start)) s (RTO dokaz) — baza $dst_name spremna za provjeru i prebacivanje."
