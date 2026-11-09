\set ON_ERROR_STOP on

-- Kritične provjere baze koje se izvršavaju u deployu i u CI-ju.
-- OVAJ SQL SE MORA pustiti kroz DATABASE_URL (aplikacijska rola), nikad DATABASE_ADMIN_URL.
-- Greška ovdje zaustavlja pokretanje aplikacije; poruke nisu dostupne kroz javnu rutu.

DO $preflight$
DECLARE
  v_role RECORD;
  v_owned_tables TEXT;
  v_rls_missing TEXT;
  v_policy_missing TEXT;
  v_company_table_count INTEGER;
  v_exclusion_count INTEGER;
  v_exclusion_names TEXT;
  v_trigger_count INTEGER;
  v_trigger_enabled BOOLEAN;
  v_trigger_function TEXT;
  v_trigger_definition TEXT;
  v_mechanism TEXT;
  v_gist_version TEXT;
  v_scope_default TEXT;
  v_invite_scope_default TEXT;
  v_assignment_table OID;
  v_history_trigger_count INTEGER;
  v_history_trigger_enabled BOOLEAN;
  v_history_function TEXT;
  v_history_definition TEXT;
  v_truncate_trigger_count INTEGER;
  v_truncate_trigger_enabled BOOLEAN;
  v_truncate_function TEXT;
  v_truncate_definition TEXT;
  v_history_constraint_count INTEGER;
  v_history_constraint_definition TEXT;
  v_history_fk_count INTEGER;
  v_r4_rls_missing TEXT;
  v_workday_trigger_count INTEGER;
  v_workday_trigger_enabled BOOLEAN;
  v_workday_trigger_function TEXT;
  v_workday_trigger_definition TEXT;
  v_work_entry_trigger_count INTEGER;
  v_work_entry_trigger_enabled BOOLEAN;
  v_work_entry_trigger_function TEXT;
  v_work_entry_trigger_definition TEXT;
  v_sync_guard_missing TEXT;
  v_conflict_retention_default TEXT;
  v_conflict_retention_check TEXT;
BEGIN
  SELECT rolname, rolsuper, rolbypassrls
    INTO v_role
    FROM pg_roles
   WHERE rolname = current_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREFLIGHT: ne mogu pročitati atribute aplikacijske role iz DATABASE_URL.';
  END IF;
  IF v_role.rolsuper THEN
    RAISE EXCEPTION 'PREFLIGHT: DATABASE_URL je spojen kao superuser "%"; RLS ne štiti superusera.', v_role.rolname;
  END IF;
  IF v_role.rolbypassrls THEN
    RAISE EXCEPTION 'PREFLIGHT: aplikacijska rola "%" ima BYPASSRLS; RLS ne štiti njene upite.', v_role.rolname;
  END IF;

  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
    INTO v_owned_tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname <> 'information_schema'
     AND n.nspname !~ '^pg_'
     AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user);
  IF v_owned_tables IS NOT NULL THEN
    RAISE EXCEPTION
      'PREFLIGHT: DATABASE_URL rola "%" vlasnik je tabela (%); aplikacijska rola mora biti odvojena od vlasnika.',
      v_role.rolname, v_owned_tables;
  END IF;

  -- Ako aplikacija može SET ROLE u neku rolu koja posjeduje tabelu, samo poređenje current_user
  -- ne bi bilo dovoljno. Zato se provjerava i članstvo u vlasničkim rolama.
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname <> 'information_schema'
       AND n.nspname !~ '^pg_'
       AND pg_has_role(current_user, c.relowner, 'MEMBER')
  ) THEN
    RAISE EXCEPTION
      'PREFLIGHT: DATABASE_URL rola "%" može preuzeti rolu vlasnika tabele; ukloni članstvo u vlasničkoj roli.',
      v_role.rolname;
  END IF;

  SELECT count(*)::integer
    INTO v_company_table_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname <> 'information_schema'
     AND n.nspname !~ '^pg_'
     AND a.attname = 'company_id'
     AND a.attnum > 0
     AND NOT a.attisdropped;

  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
    INTO v_rls_missing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname <> 'information_schema'
     AND n.nspname !~ '^pg_'
     AND a.attname = 'company_id'
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND NOT c.relrowsecurity;
  IF v_rls_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: RLS nije uključen na tabelama sa company_id: %.', v_rls_missing;
  END IF;

  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
    INTO v_policy_missing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname <> 'information_schema'
     AND n.nspname !~ '^pg_'
     AND a.attname = 'company_id'
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
  IF v_policy_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: nema nijedne RLS politike na tabelama sa company_id: %.', v_policy_missing;
  END IF;
  IF v_company_table_count = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: nema pronađenih tabela sa company_id; provjeri da li je prava baza povezana.';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_scope_default
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'memberships'
     AND a.attname = 'scope'
     AND a.attnum > 0
     AND NOT a.attisdropped;
  IF v_scope_default IS NULL OR regexp_replace(v_scope_default, '::.*$', '') <> quote_literal('SELF') THEN
    RAISE EXCEPTION
      'PREFLIGHT: memberships.scope DEFAULT mora biti SELF; zatečen izraz je %.',
      COALESCE(v_scope_default, '(nedostaje kolona ili DEFAULT)');
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_invite_scope_default
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'invitations'
     AND a.attname = 'scope'
     AND a.attnum > 0
     AND NOT a.attisdropped;
  IF v_invite_scope_default IS NOT NULL THEN
    RAISE EXCEPTION
      'PREFLIGHT: invitations.scope mora tražiti izričit izbor, ali ima DEFAULT %.',
      v_invite_scope_default;
  END IF;

  v_assignment_table := to_regclass('public.project_assignments');
  IF v_assignment_table IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: nedostaje public.project_assignments; migracije R3 nisu kompletne.';
  END IF;

  SELECT count(*)::integer,
         string_agg(conname, ', ' ORDER BY conname)
    INTO v_exclusion_count, v_exclusion_names
    FROM pg_constraint
   WHERE conrelid = v_assignment_table
     AND contype = 'x';

  SELECT count(*)::integer,
         bool_and(t.tgenabled IN ('O', 'A')),
         max(p.proname),
         max(pg_get_functiondef(p.oid))
    INTO v_trigger_count, v_trigger_enabled, v_trigger_function,
         v_trigger_definition
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = v_assignment_table
     AND NOT t.tgisinternal
     AND (t.tgname = 'project_assignments_no_overlap'
          OR p.proname = 'project_assignment_no_overlap');

  SELECT extversion INTO v_gist_version
    FROM pg_extension
   WHERE extname = 'btree_gist';

  IF v_exclusion_count = 2
     AND v_exclusion_names = 'project_assignments_machine_no_overlap, project_assignments_worker_no_overlap'
     AND v_trigger_count = 0 THEN
    IF v_gist_version IS NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: EXCLUDE constrainti postoje, ali btree_gist nije instaliran.';
    END IF;
    v_mechanism := 'EXCLUDE USING gist';
  ELSIF v_exclusion_count = 0 AND v_trigger_count = 1 THEN
    IF v_trigger_enabled IS DISTINCT FROM true OR v_trigger_function <> 'project_assignment_no_overlap' THEN
      RAISE EXCEPTION 'PREFLIGHT: fallback triger za preklapanje nedostaje, ugašen je ili koristi neočekivanu funkciju.';
    END IF;
    IF position('pg_advisory_xact_lock' IN COALESCE(v_trigger_definition, '')) = 0 THEN
      RAISE EXCEPTION 'PREFLIGHT: fallback triger nema pg_advisory_xact_lock; paralelni upisi mogu zaobići blokadu.';
    END IF;
    v_mechanism := 'triger + pg_advisory_xact_lock';
  ELSE
    RAISE EXCEPTION
      'PREFLIGHT: neispravna zaštita preklapanja (EXCLUDE=%; trigeri=%); mora biti tačno jedan potpun mehanizam.',
      v_exclusion_count, v_trigger_count;
  END IF;

  SELECT count(*)::integer,
         bool_and(t.tgenabled IN ('O', 'A')),
         max(p.proname),
         max(pg_get_functiondef(p.oid))
    INTO v_history_trigger_count, v_history_trigger_enabled,
         v_history_function, v_history_definition
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = v_assignment_table
     AND NOT t.tgisinternal
     AND t.tgname = 'project_assignments_history_guard';

  IF v_history_trigger_count <> 1
     OR v_history_trigger_enabled IS DISTINCT FROM true
     OR v_history_function <> 'guard_project_assignment_history'
     OR position('PROJECT_ASSIGNMENT_DELETE_FORBIDDEN' IN COALESCE(v_history_definition, '')) = 0
     OR position('PROJECT_ASSIGNMENT_END_MUST_BE_TODAY_OR_FUTURE' IN COALESCE(v_history_definition, '')) = 0
     OR position('PROJECT_ASSIGNMENT_END_CANNOT_MOVE_BACKWARDS' IN COALESCE(v_history_definition, '')) = 0
     OR position('PROJECT_ASSIGNMENT_IDENTITY_IMMUTABLE' IN COALESCE(v_history_definition, '')) = 0
     OR position('PROJECT_ASSIGNMENT_VOID_ONLY_AFTER_CREATE' IN COALESCE(v_history_definition, '')) = 0
     OR position('PROJECT_ASSIGNMENT_VOID_REASON_REQUIRED' IN COALESCE(v_history_definition, '')) = 0
     OR position('PROJECT_ASSIGNMENT_VOID_IS_IMMUTABLE' IN COALESCE(v_history_definition, '')) = 0
     OR position('PROJECT_ASSIGNMENT_HAS_WORKDAYS' IN COALESCE(v_history_definition, '')) = 0
     OR position('pg_advisory_xact_lock' IN COALESCE(v_history_definition, '')) = 0
     OR position(':assignment-worker:' IN COALESCE(v_history_definition, '')) = 0
     OR position(':assignment-machine:' IN COALESCE(v_history_definition, '')) = 0 THEN
    RAISE EXCEPTION
      'PREFLIGHT: R3 project_assignments history trigger nedostaje, ugašen je ili ne sadrži sve zabrane.';
  END IF;

  SELECT count(*)::integer, bool_and(t.tgenabled IN ('O', 'A')), max(p.proname),
         max(pg_get_functiondef(p.oid))
    INTO v_truncate_trigger_count, v_truncate_trigger_enabled, v_truncate_function,
         v_truncate_definition
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = v_assignment_table
     AND NOT t.tgisinternal
     AND t.tgname = 'project_assignments_truncate_guard';
  IF v_truncate_trigger_count <> 1
     OR v_truncate_trigger_enabled IS DISTINCT FROM true
     OR v_truncate_function <> 'reject_project_assignments_truncate'
     OR position('PROJECT_ASSIGNMENT_TRUNCATE_FORBIDDEN' IN COALESCE(v_truncate_definition, '')) = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: TRUNCATE zaštita za project_assignments nedostaje, ugašena je ili ne sadrži zabranu.';
  END IF;

  SELECT count(*)::integer, max(pg_get_constraintdef(oid))
    INTO v_history_constraint_count, v_history_constraint_definition
    FROM pg_constraint
   WHERE conrelid = v_assignment_table
     AND conname = 'project_assignments_void_fields_check'
     AND contype = 'c'
     AND convalidated;
  IF v_history_constraint_count <> 1
     OR position('voided_at' IN COALESCE(v_history_constraint_definition, '')) = 0
     OR position('voided_by' IN COALESCE(v_history_constraint_definition, '')) = 0
     OR position('void_reason' IN COALESCE(v_history_constraint_definition, '')) = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: validirani CHECK za void autora/razlog/vrijeme nedostaje ili je nepotpun.';
  END IF;

  SELECT count(*)::integer
    INTO v_history_fk_count
    FROM pg_constraint
   WHERE conrelid = v_assignment_table
     AND contype = 'f'
     AND conname IN (
       'project_assignments_company_fk', 'project_assignments_project_fk',
       'project_assignments_worker_fk', 'project_assignments_machine_fk'
     )
     AND confdeltype = 'r';
  IF v_history_fk_count <> 4 THEN
    RAISE EXCEPTION 'PREFLIGHT: project_assignments nema sva četiri FK-a sa ON DELETE RESTRICT.';
  END IF;

  IF has_table_privilege(current_user, v_assignment_table, 'DELETE')
     OR has_table_privilege(current_user, v_assignment_table, 'TRUNCATE') THEN
    RAISE EXCEPTION 'PREFLIGHT: DATABASE_URL rola ima DELETE ili TRUNCATE na project_assignments.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = v_assignment_table
       AND contype = 'f'
       AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: project_assignments i dalje ima FK sa ON DELETE CASCADE.';
  END IF;

  RAISE NOTICE 'PREFLIGHT OK: DATABASE_URL rola "%" nije vlasnik tabela, nije superuser i nema BYPASSRLS.', v_role.rolname;
  RAISE NOTICE 'PREFLIGHT OK: RLS uključen i politika postoji na svih % tabela sa company_id.', v_company_table_count;
  RAISE NOTICE 'PREFLIGHT OK: memberships.scope DEFAULT je SELF; invitations.scope nema DEFAULT.';
  RAISE NOTICE 'PREFLIGHT OK: preklapanje = %; btree_gist %.',
    v_mechanism, COALESCE(v_gist_version, 'nije instaliran');
  RAISE NOTICE 'PREFLIGHT OK: dodjele su immutable, DELETE/TRUNCATE su blokirani, to_date se ne skraćuje i FK nema kaskadno brisanje.';

  -- R4 tables must FORCE tenant RLS and the policy must actually read the SET LOCAL tenant.
  SELECT string_agg(required.table_name, ', ' ORDER BY required.table_name)
    INTO v_r4_rls_missing
    FROM (VALUES
      ('sync_cursor_allocators', 'sync_cursor_allocators_tenant_isolation'),
      ('sync_cursor_slots', 'sync_cursor_slots_tenant_isolation'),
      ('sync_change_log', 'sync_change_log_tenant_isolation'),
      ('workdays', 'workdays_tenant_isolation'),
      ('work_entries', 'work_entries_tenant_isolation'),
      ('sync_receipts', 'sync_receipts_tenant_isolation'),
      ('sync_conflicts', 'sync_conflicts_tenant_isolation')
    ) AS required(table_name, policy_name)
    LEFT JOIN pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_class c ON c.relname = required.table_name AND c.relnamespace = n.oid
   WHERE c.oid IS NULL OR n.oid IS NULL
      OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
      OR NOT EXISTS (
        SELECT 1
          FROM pg_policy p
         WHERE p.polrelid = c.oid
           AND p.polname = required.policy_name
           AND p.polcmd = '*'
           AND position('app.company_id' IN
                 COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
                 COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) > 0
      );
  IF v_r4_rls_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: R4 tabele nemaju FORCE RLS/tenant-check policy: %.', v_r4_rls_missing;
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_conflict_retention_default
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'companies'
     AND a.attname = 'sync_conflict_retention_days'
     AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT pg_get_constraintdef(oid)
    INTO v_conflict_retention_check
    FROM pg_constraint
   WHERE conrelid = 'public.companies'::regclass
     AND conname = 'companies_sync_conflict_retention_check'
     AND convalidated;
  IF v_conflict_retention_default IS NULL
     OR position('90' IN v_conflict_retention_default) = 0
     OR v_conflict_retention_check IS NULL
     OR position('1' IN v_conflict_retention_check) = 0
     OR position('3650' IN v_conflict_retention_check) = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: per-company sync conflict retention nema validiran raspon i default 90 dana.';
  END IF;

  SELECT count(*)::integer, bool_and(t.tgenabled IN ('O', 'A')), max(p.proname),
         max(pg_get_functiondef(p.oid))
    INTO v_workday_trigger_count, v_workday_trigger_enabled,
         v_workday_trigger_function, v_workday_trigger_definition
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = to_regclass('public.workdays')
     AND NOT t.tgisinternal
     AND t.tgname = 'workdays_identity_guard';
  IF v_workday_trigger_count <> 1
     OR v_workday_trigger_enabled IS DISTINCT FROM true
     OR v_workday_trigger_function <> 'guard_workday_identity'
     OR position('WORKDAY_IDENTITY_IMMUTABLE' IN COALESCE(v_workday_trigger_definition, '')) = 0
     OR position('pg_advisory_xact_lock' IN COALESCE(v_workday_trigger_definition, '')) = 0
     OR position(':assignment-worker:' IN COALESCE(v_workday_trigger_definition, '')) = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: workday identitet/assignment-VOID race guard nedostaje ili je ugašen.';
  END IF;

  SELECT count(*)::integer, bool_and(t.tgenabled IN ('O', 'A')), max(p.proname),
         max(pg_get_functiondef(p.oid))
    INTO v_work_entry_trigger_count, v_work_entry_trigger_enabled,
         v_work_entry_trigger_function, v_work_entry_trigger_definition
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = to_regclass('public.work_entries')
     AND NOT t.tgisinternal
     AND t.tgname = 'work_entries_no_overlap';
  IF v_work_entry_trigger_count <> 1
     OR v_work_entry_trigger_enabled IS DISTINCT FROM true
     OR v_work_entry_trigger_function <> 'guard_work_entry_overlap'
     OR position('pg_advisory_xact_lock' IN COALESCE(v_work_entry_trigger_definition, '')) = 0
     OR position(':assignment-worker:' IN COALESCE(v_work_entry_trigger_definition, '')) = 0
     OR position(':assignment-machine:' IN COALESCE(v_work_entry_trigger_definition, '')) = 0
     OR position('UNKNOWN_END' IN COALESCE(v_work_entry_trigger_definition, '')) = 0
     OR position('KNOWN_END' IN COALESCE(v_work_entry_trigger_definition, '')) = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: work_entries overlap trigger nedostaje ili ne pokriva concurrency/UNKNOWN_END.';
  END IF;

  SELECT string_agg(required.trigger_name, ', ' ORDER BY required.trigger_name)
    INTO v_sync_guard_missing
    FROM (VALUES
      ('sync_receipts', 'sync_receipts_history_guard', 'guard_sync_receipt_update',
       'SYNC_RECEIPT_IDENTITY_IMMUTABLE', 'SYNC_RECEIPT_MUST_START_WITH_DETAILS'),
      ('sync_conflicts', 'sync_conflicts_history_guard', 'guard_sync_conflict_update',
       'SYNC_CONFLICT_IDENTITY_IMMUTABLE', 'SYNC_CONFLICT_RESOLUTION_IMMUTABLE')
    ) AS required(table_name, trigger_name, function_name, marker, second_marker)
    LEFT JOIN pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_class c ON c.relname = required.table_name AND c.relnamespace = n.oid
   WHERE c.oid IS NULL OR n.oid IS NULL
      OR NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE t.tgrelid = c.oid
           AND NOT t.tgisinternal
           AND t.tgname = required.trigger_name
           AND t.tgenabled IN ('O', 'A')
           AND p.proname = required.function_name
           AND position(required.marker IN pg_get_functiondef(p.oid)) > 0
           AND position(required.second_marker IN pg_get_functiondef(p.oid)) > 0
      );
  IF v_sync_guard_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: immutable sync receipt/conflict guard nedostaje ili je ugašen: %.', v_sync_guard_missing;
  END IF;

  RAISE NOTICE 'PREFLIGHT OK: R4 tenant tabele imaju FORCE RLS; change-log/cursor i workday/entry/conflict zaštite su prisutne.';
END
$preflight$;
