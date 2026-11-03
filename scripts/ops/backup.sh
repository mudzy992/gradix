#!/usr/bin/env bash
# INF-06 — backup Postgres baze (custom format + sha256 + retencija).
#
#   DATABASE_URL=postgresql://<korisnik>:<lozinka>@<host>:5432/gradix \
#   BACKUP_DIR=/var/backups/gradix ./scripts/ops/backup.sh
#
# Namjerno radi sa `pg_dump`/`pg_restore` iz PATH-a (bez Docker poziva): tako isto radi na
# hostu, u CI-ju i u kontejneru u kojem su klijentski alati instalirani.
#
# Kriteriji (docs/INFRASTRUCTURE.md §7):
#   - dump je **custom format** (`-Fc`) → `pg_restore` može selektivno i paralelno,
#   - uz dump ide `sha256` fajl; restore ga provjerava prije nego što dira bazu,
#   - retencija je `BACKUP_RETENTION` (default 7) najnovijih dumpova.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL je obavezan (postgresql://...)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION:-7}"
STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
NAME="gradix-$STAMP.dump"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "GREŠKA: pg_dump nije u PATH-u (instaliraj postgresql-client)." >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/$NAME"

echo "→ pg_dump $FILE"
pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file "$FILE" \
  "$DATABASE_URL"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum "$NAME" > "$NAME.sha256")
fi

# Retencija: obriši sve osim zadnjih $RETENTION dumpova (i njihovih sha256 fajlova).
if [ "$RETENTION" -gt 0 ] 2>/dev/null; then
  # `ls -1t` je namjerno: GNU/BSD sortira po vremenu izmjene.
  ls -1t "$BACKUP_DIR"/gradix-*.dump 2>/dev/null | tail -n +"$((RETENTION + 1))" | while read -r old; do
    echo "→ retencija: brišem $(basename "$old")"
    rm -f "$old" "$old.sha256"
  done
fi

SIZE="$(wc -c < "$FILE" | tr -d ' ')"
echo "✓ backup gotov: $FILE ($SIZE B), retencija=$RETENTION"
