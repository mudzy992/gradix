#!/usr/bin/env bash
# Idempotentno: gradix_backup = BYPASSRLS + SELECT-only (nije superuser, nije vlasnik).
# Ulaz: DATABASE_ADMIN_URL, BACKUP_ROLE_PASSWORD. Ne ispisuje lozinke ni URL-ove.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=backup-lib.sh
. "$script_dir/backup-lib.sh"

: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL obavezan}"
: "${BACKUP_ROLE_PASSWORD:?BACKUP_ROLE_PASSWORD obavezan}"
ROLE_NAME="${BACKUP_ROLE_NAME:-gradix_backup}"
ADMIN="$(pg_conn "$DATABASE_ADMIN_URL")"

require_cmd psql

# SQL-escape jednim navodnikom (lozinka se ne logira).
sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}
PASS_ESC="$(sql_escape "$BACKUP_ROLE_PASSWORD")"

psql "$ADMIN" -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE_NAME}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',
      '${ROLE_NAME}', '${PASS_ESC}');
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',
      '${ROLE_NAME}', '${PASS_ESC}');
  END IF;
END
\$\$;
GRANT USAGE ON SCHEMA public TO ${ROLE_NAME};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE_NAME};
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE_NAME};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLE_NAME};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${ROLE_NAME};
-- Skini sva pisana prava ako su ikad dodana.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ${ROLE_NAME};
REVOKE CREATE ON SCHEMA public FROM ${ROLE_NAME};
SQL

# current_database() u GRANT CONNECT ne radi kao identifikator u nekim verzijama —
# ponovi CONNECT na ime baze iz URL-a.
DB_NAME=$(printf '%s' "$ADMIN" | sed -E 's#^.*/([^/?]+).*#\1#')
psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "GRANT CONNECT ON DATABASE \"${DB_NAME}\" TO ${ROLE_NAME}"

echo "PASS: role ${ROLE_NAME} je BYPASSRLS + SELECT-only (vrijednosti sakrivene)."
