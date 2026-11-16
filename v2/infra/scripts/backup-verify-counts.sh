#!/usr/bin/env bash
# Uporedi manifest sa brojevima redova u RESTORE_DATABASE_URL.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=backup-lib.sh
. "$script_dir/backup-lib.sh"

MANIFEST="${1:-}"
: "${MANIFEST:?Upotreba: RESTORE_DATABASE_URL=... $0 <manifest.tsv>}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL je obavezan}"
require_cmd psql

CONN="$(pg_conn "$RESTORE_DATABASE_URL")"
failed=0
while IFS=$'\t' read -r table expected || [ -n "$table" ]; do
  case "$table" in
    ''|\#*) continue ;;
  esac
  actual=$(psql "$CONN" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM public.\"$table\"" | tr -d '[:space:]')
  if [[ ! "$actual" =~ ^[0-9]+$ ]] || [[ ! "$expected" =~ ^[0-9]+$ ]]; then
    echo "::error title=row-count::Nevažeći broj za $table (očekivano=$expected stvarno=$actual)"
    failed=1
    continue
  fi
  if [ "$actual" != "$expected" ]; then
    echo "::error title=row-count::$table očekivano=$expected restore=$actual"
    failed=1
  else
    echo "✓ $table: $actual"
  fi
done < "$MANIFEST"

echo "rezultat: failed=$failed"
exit "$failed"
