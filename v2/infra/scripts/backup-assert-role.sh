#!/usr/bin/env bash
# Dokaz: DATABASE_BACKUP_URL = BYPASSRLS + SELECT-only (čita sve firme; bez DML/DDL).
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=backup-lib.sh
. "$script_dir/backup-lib.sh"

: "${DATABASE_BACKUP_URL:?DATABASE_BACKUP_URL obavezan}"
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL obavezan (referentni broj redova)}"
CONN="$(pg_conn "$DATABASE_BACKUP_URL")"
ADMIN="$(pg_conn "$DATABASE_ADMIN_URL")"

echo "→ (c) atributi role"
attrs=$(run_psql "$CONN" -v ON_ERROR_STOP=1 -tAc \
  "SELECT format('super=%s bypass=%s', rolsuper::text, rolbypassrls::text)
     FROM pg_roles WHERE rolname = current_user" | tr -d '[:space:]')
if [ "$attrs" != "super=falsebypass=true" ]; then
  echo "GREŠKA: očekivano super=false bypass=true, dobijeno: $attrs" >&2
  exit 1
fi
owner=$(run_psql "$CONN" -v ON_ERROR_STOP=1 -tAc \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND pg_get_userbyid(c.relowner)=current_user" | tr -d '[:space:]')
if [ "$owner" != "0" ]; then
  echo "GREŠKA: backup rola je vlasnik $owner tabela — nije dozvoljeno." >&2
  exit 1
fi
echo "✓ nije superuser, BYPASSRLS=true, nije vlasnik šeme"

echo "→ (a) čita sve firme"
src=$(run_psql "$ADMIN" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM public.companies" | tr -d '[:space:]')
got=$(run_psql "$CONN" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM public.companies" | tr -d '[:space:]')
if [ "$src" != "$got" ] || [ "$got" -lt 2 ]; then
  echo "GREŠKA: backup rola ne vidi sve firme (admin=$src backup=$got)." >&2
  exit 1
fi
while IFS= read -r table || [ -n "$table" ]; do
  case "$table" in ''|\#*) continue ;; esac
  a=$(run_psql "$ADMIN" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM public.\"$table\"" | tr -d '[:space:]')
  b=$(run_psql "$CONN" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM public.\"$table\"" | tr -d '[:space:]')
  if [ "$a" != "$b" ]; then
    echo "GREŠKA: $table admin=$a backup=$b" >&2
    exit 1
  fi
done < "$script_dir/backup-manifest.tsv"
echo "✓ SELECT poklapa admin za sve tabele manifesta"

echo "→ (b) DML/DDL zabranjeni"
fail_ok() {
  local label="$1" sql="$2"
  if run_psql "$CONN" -v ON_ERROR_STOP=1 -c "$sql" >/dev/null 2>&1; then
    echo "GREŠKA: $label nije smio uspjeti." >&2
    exit 1
  fi
  echo "✓ $label odbijen"
}
fail_ok "INSERT" "INSERT INTO public.companies (id, name, slug) VALUES ('cmp_x','x','x')"
fail_ok "UPDATE" "UPDATE public.companies SET name = name WHERE false"
fail_ok "DELETE" "DELETE FROM public.companies WHERE false"
fail_ok "DDL" "CREATE TABLE public.backup_role_should_not_create (id int)"

echo "PASS: backup rola je BYPASSRLS + SELECT-only."
