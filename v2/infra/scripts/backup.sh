#!/bin/sh
# 2a — sigurnosna kopija baze: pg_dump (custom format) + manifest broja redova
# po tabeli + kopija VAN DISKA (MinIO, ADR 0006: bucket gradix-v2, prefiks
# gx2/backups/) s retencijom 30 dnevnih + 12 mjesečnih kopija.
#
# Upotreba:
#   DATABASE_ADMIN_URL=postgresql://... ./infra/scripts/backup.sh
#
# Okolina (detalji u v2/.env.example i docs/COOLIFY.md §12):
#   BACKUP_DIR               lokalni direktorij (default ./backups) — samo prečica,
#                            nije sigurnosna kopija dok ne stigne u MinIO
#   BACKUP_MINIO_ENDPOINT    npr. http://minio:9000; PRAZNO = samo lokalni dump + upozorenje
#   BACKUP_MINIO_BUCKET      default gradix-v2 (ADR 0006)
#   BACKUP_MINIO_PREFIX      default gx2/backups
#   BACKUP_MINIO_ACCESS_KEY  i BACKUP_MINIO_SECRET_KEY — obavezni uz endpoint
#   BACKUP_RETENTION_DAILY   default 30
#   BACKUP_RETENTION_MONTHLY default 12
#
# Rola: isključivo administratorska bazna rola (DATABASE_ADMIN_URL) — ista
# namjena kao za migracije i retenciju; aplikacijska rola ne pokreće backup.
#
# POSIX sh namjerno (kao db-apply.sh): radi u Alpine runtime slici i na hostu.
set -eu

fail() { echo "GREŠKA: $*" >&2; exit 1; }

[ -n "${DATABASE_ADMIN_URL:-}" ] || fail "potreban DATABASE_ADMIN_URL (administratorska rola — vlasnik šeme)."
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump nije na PATH-u (postgresql-client)."
command -v psql >/dev/null 2>&1 || fail "psql nije na PATH-u."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_MINIO_ENDPOINT="${BACKUP_MINIO_ENDPOINT:-}"
BACKUP_MINIO_BUCKET="${BACKUP_MINIO_BUCKET:-gradix-v2}"
BACKUP_MINIO_PREFIX="${BACKUP_MINIO_PREFIX:-gx2/backups}"
BACKUP_MINIO_ACCESS_KEY="${BACKUP_MINIO_ACCESS_KEY:-}"
BACKUP_MINIO_SECRET_KEY="${BACKUP_MINIO_SECRET_KEY:-}"
BACKUP_RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-30}"
BACKUP_RETENTION_MONTHLY="${BACKUP_RETENTION_MONTHLY:-12}"

# psql/pg_dump ne razumiju Prisma-style `?schema=public` (isto čišćenje kao db-apply.sh).
ADMIN_URL=$(printf '%s' "$DATABASE_ADMIN_URL" \
  | sed -E 's/[?&]schema=[^&]*//' \
  | sed -E '/\?/!s/&/?/')

mkdir -p "$BACKUP_DIR"
name="gradix-v2-$(date -u +%Y%m%d-%H%M%S)"
dump="$BACKUP_DIR/$name.dump"
manifest="$BACKUP_DIR/$name.manifest.tsv"
start=$(date +%s)

echo "→ dump baze (custom format, kompresovan): $dump"
pg_dump --format=custom --file="$dump" "$ADMIN_URL"
[ -s "$dump" ] || fail "dump datoteka je prazna."

# Dump se mora moći i pročitati — integritet prije nego što ga ikom pošaljemo.
pg_restore --list "$dump" >/dev/null || fail "pg_restore ne može pročitati dump (oštećen?)."

# Manifest: broj redova po tabeli U TREUTKU backupa — oslonac provjere restore-a.
tables=$(psql "$ADMIN_URL" -Atc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
[ -n "$tables" ] || fail "u bazi nema nijedne tabele u public šemi — backup prazne baze?"
for t in $tables; do
  c=$(psql "$ADMIN_URL" -Atc "SELECT count(*) FROM public.\"$t\"")
  printf '%s\t%s\n' "$t" "$c" >> "$manifest"
done

size=$(du -h "$dump" | cut -f1)
n_tables=$(wc -l < "$manifest" | tr -d ' ')
echo "  dump: $size, tabela u manifestu: $n_tables"

# Kopija VAN DISKA — bez ove kopije dump na istom disku NIJE sigurnosna kopija.
if [ -z "$BACKUP_MINIO_ENDPOINT" ]; then
  echo "UPOZORENJE: BACKUP_MINIO_ENDPOINT nije postavljen — dump je ostao SAMO na" >&2
  echo "lokalnom disku ($BACKUP_DIR). Namjerno nije greška (prvi put / lokalno)," >&2
  echo "ali produkcijski posao MORA slati kopiju u MinIO (docs/COOLIFY.md §12)." >&2
else
  command -v mc >/dev/null 2>&1 || fail "mc (MinIO klijent) nije na PATH-u — instaliraj mc ili ostavi BACKUP_MINIO_ENDPOINT praznim."
  [ -n "$BACKUP_MINIO_ACCESS_KEY" ] && [ -n "$BACKUP_MINIO_SECRET_KEY" ] \
    || fail "BACKUP_MINIO_ACCESS_KEY i BACKUP_MINIO_SECRET_KEY su obavezni uz BACKUP_MINIO_ENDPOINT."

  alias_name="gradix-backup"
  mc alias set "$alias_name" "$BACKUP_MINIO_ENDPOINT" "$BACKUP_MINIO_ACCESS_KEY" "$BACKUP_MINIO_SECRET_KEY" >/dev/null
  mc mb --ignore-existing "$alias_name/$BACKUP_MINIO_BUCKET" >/dev/null
  target="$alias_name/$BACKUP_MINIO_BUCKET/$BACKUP_MINIO_PREFIX"
  echo "→ kopija van diska: $BACKUP_MINIO_ENDPOINT/$BACKUP_MINIO_BUCKET/$BACKUP_MINIO_PREFIX"
  mc cp "$dump" "$target/$name.dump" >/dev/null
  mc cp "$manifest" "$target/$name.manifest.tsv" >/dev/null

  # Retencija po imenu objekta: datum u imenu je YYYYMMDD, pa je „mjesečna"
  # kopija ona čiji je DAN 01 (šesti-broj + 01 prije crtice vremena), a sve
  # ostalo „dnevna". Imena sortiraju hronološki, pa zadržavamo zadnjih N/M.
  # (case obrazac umjesto regexa: POSIX sh bez {n} intervala, provjerno i na
  # Alpine busyboxu.)
  kept_d=0
  kept_m=0
  for obj in $(mc ls "$target" | awk '{print $NF}' | grep '\.dump$' | sort -r); do
    is_monthly=0
    case "$obj" in
      *[0-9][0-9][0-9][0-9][0-9][0-9]01-[0-9][0-9][0-9][0-9][0-9][0-9].dump) is_monthly=1 ;;
    esac
    keep=0
    if [ "$is_monthly" -eq 1 ]; then
      kept_m=$((kept_m + 1))
      if [ "$kept_m" -le "$BACKUP_RETENTION_MONTHLY" ]; then keep=1; fi
    else
      kept_d=$((kept_d + 1))
      if [ "$kept_d" -le "$BACKUP_RETENTION_DAILY" ]; then keep=1; fi
    fi
    if [ "$keep" -eq 0 ]; then
      echo "  retencija briše: $obj"
      mc rm "$target/$obj" >/dev/null
      mc rm "$target/${obj%.dump}.manifest.tsv" >/dev/null 2>&1 || true
    fi
  done
  echo "  retencija: dnevnih zadržano $kept_d (max $BACKUP_RETENTION_DAILY), mjesečnih $kept_m (max $BACKUP_RETENTION_MONTHLY)."
fi

end=$(date +%s)
echo "Backup završen za $((end - start)) s — $dump ($size, $n_tables tabela)."
