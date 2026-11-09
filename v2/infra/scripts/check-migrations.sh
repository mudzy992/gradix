#!/bin/sh
# End-to-end migration gate on an empty database and a populated pre-R4 prior cut.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required for migration checks}"
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is required for migration checks}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
v2_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)
cd "$v2_dir"

# CI uses simple postgres URLs without query parameters, as does db-apply.sh. Preserve all
# connection credentials while changing only the database path.
admin_base=${DATABASE_ADMIN_URL%/*}
app_base=${DATABASE_URL%/*}
admin_server_url="$admin_base/postgres"
empty_admin_url="$admin_base/gradix_ci_empty"
empty_app_url="$app_base/gradix_ci_empty"
cut_admin_url="$admin_base/gradix_ci_prior_cut"
cut_app_url="$app_base/gradix_ci_prior_cut"

recreate_database() {
  database=$1
  psql "$admin_server_url" -X -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS $database" \
    -c "CREATE DATABASE $database"
}

check_constraint_names() {
  database_url=$1
  label=$2
  duplicates=$(psql "$database_url" -X -A -t -v ON_ERROR_STOP=1 -c \
    "SELECT format('%s.%s (%s)', relation.relname, constraint_row.conname, count(*))
       FROM pg_catalog.pg_constraint AS constraint_row
       JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
      GROUP BY relation.relname, constraint_row.conname
     HAVING count(*) > 1
      ORDER BY relation.relname, constraint_row.conname")
  if [ -n "$duplicates" ]; then
    echo "ERROR: duplicate constraint names on a table after $label:" >&2
    printf '%s\n' "$duplicates" >&2
    return 1
  fi
  count=$(psql "$database_url" -X -A -t -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.work_entries'::regclass
        AND conname = 'work_entries_end_state_check'")
  if [ "$count" != "1" ]; then
    echo "ERROR: expected exactly one work_entries_end_state_check constraint after $label; found $count." >&2
    return 1
  fi
  echo "PASS: $label has unique per-table constraint names (including one work_entries_end_state_check)."
}

assert_migration_recorded() {
  database_url=$1
  migration=$2
  applied=$(psql "$database_url" -X -A -t -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM public.schema_migrations WHERE name = '$migration'")
  if [ "$applied" != "1" ]; then
    echo "ERROR: expected migration $migration to be recorded exactly once; found $applied." >&2
    return 1
  fi
}

echo "=== Empty database migration check ==="
recreate_database gradix_ci_empty
DATABASE_ADMIN_URL="$empty_admin_url" ./infra/scripts/db-apply.sh
DATABASE_URL="$empty_app_url" ./packages/db/preflight-checks/run.sh
check_constraint_names "$empty_admin_url" "empty database"

# Build a realistic pre-R4 cut: apply every migration before the R3 assignment-history guard,
# then seed legacy business data. The normal forward-only migrator must preserve that row while
# applying the assignment-history, cursor, and workday-core migrations.
echo "=== Populated prior-cut migration check ==="
recreate_database gradix_ci_prior_cut
psql "$cut_admin_url" -X -v ON_ERROR_STOP=1 -q -f packages/db/bootstrap/roles.sql
history_migration=20261110130000_r3_assignment_history_guard
found_history_migration=false
for migration_dir in packages/db/prisma/migrations/*/; do
  migration=$(basename "$migration_dir")
  if [ "$migration" = "$history_migration" ]; then
    found_history_migration=true
    break
  fi
  echo "→ prior cut: $migration"
  psql "$cut_admin_url" -X -v ON_ERROR_STOP=1 -q -f "$migration_dir/migration.sql"
done
if [ "$found_history_migration" != "true" ]; then
  echo "ERROR: prior-cut migration boundary $history_migration was not found." >&2
  exit 1
fi

psql "$cut_admin_url" -X -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;
INSERT INTO public.companies (id, name, slug)
VALUES ('ci_prior_company', 'CI prior-cut fixture', 'ci-prior-cut');
INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
VALUES ('ci_prior_worker', 'ci_prior_company', 'Legacy', 'Worker', '2025-01-01');
INSERT INTO public.projects (id, company_id, code, name, created_by)
VALUES ('ci_prior_project', 'ci_prior_company', 'CI-PRIOR', 'Legacy project', 'migration-check');
INSERT INTO public.project_assignments
  (id, company_id, project_id, worker_id, from_date, note, created_by)
VALUES
  ('ci_prior_assignment', 'ci_prior_company', 'ci_prior_project', 'ci_prior_worker',
   '2025-01-15', 'Existing pre-R4 assignment data', 'migration-check');
COMMIT;
SQL

DATABASE_ADMIN_URL="$cut_admin_url" ./infra/scripts/db-apply.sh
DATABASE_URL="$cut_app_url" ./packages/db/preflight-checks/run.sh

psql "$cut_admin_url" -X -v ON_ERROR_STOP=1 -q <<'SQL'
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.project_assignments
     WHERE id = 'ci_prior_assignment'
       AND company_id = 'ci_prior_company'
       AND project_id = 'ci_prior_project'
       AND worker_id = 'ci_prior_worker'
       AND from_date = DATE '2025-01-15'
       AND note = 'Existing pre-R4 assignment data'
       AND created_by = 'migration-check'
       AND voided_at IS NULL
       AND voided_by IS NULL
       AND void_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'PRE_R4_ASSIGNMENT_DATA_NOT_PRESERVED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.companies
     WHERE id = 'ci_prior_company' AND sync_conflict_retention_days = 90
  ) THEN
    RAISE EXCEPTION 'R4_COMPANY_DEFAULT_NOT_APPLIED';
  END IF;
  IF to_regclass('public.sync_cursor_allocators') IS NULL
     OR to_regclass('public.sync_cursor_slots') IS NULL
     OR to_regclass('public.sync_change_log') IS NULL
     OR to_regclass('public.workdays') IS NULL
     OR to_regclass('public.work_entries') IS NULL
     OR to_regclass('public.sync_receipts') IS NULL
     OR to_regclass('public.sync_conflicts') IS NULL THEN
    RAISE EXCEPTION 'R4_TABLES_MISSING_AFTER_POPULATED_MIGRATION';
  END IF;
END
$verify$;
SQL

for migration in \
  20261110130000_r3_assignment_history_guard \
  20261110140000_r4_sync_cursor \
  20261110150000_r4_workday_core
do
  assert_migration_recorded "$cut_admin_url" "$migration"
done
check_constraint_names "$cut_admin_url" "populated prior-cut database"

echo "PASS: migrations applied to both an empty database and a populated pre-R4 prior cut; legacy assignment row preserved."
