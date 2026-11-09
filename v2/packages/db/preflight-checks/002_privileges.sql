\set ON_ERROR_STOP on

-- `privilege-matrix.tsv` je izvor istine za public tabele/sekvence. Učitava se lokalno od
-- psql klijenta, zato se ova skripta pokreće iz istog direktorija (vidi run.sh).
CREATE TEMP TABLE privilege_matrix (
  kind TEXT NOT NULL CHECK (kind IN ('table', 'sequence')),
  object TEXT NOT NULL,
  needed TEXT NOT NULL,
  current_before TEXT NOT NULL,
  rls_exception_reason TEXT,
  rationale TEXT NOT NULL,
  PRIMARY KEY (kind, object)
);
\copy privilege_matrix FROM 'privilege-matrix.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true)

DO $privilege_preflight$
DECLARE
  v_untracked TEXT;
  v_missing_objects TEXT;
  v_unlisted_non_rls TEXT;
  v_stale_allowlist TEXT;
  v_bad_allowlist TEXT;
  v_missing_policies TEXT;
  v_missing_privileges TEXT := '';
  v_extra_privileges TEXT := '';
  v_unexpected_definers TEXT;
  v_relation OID;
  v_function REGPROCEDURE;
  v_item RECORD;
  v_privilege TEXT;
  v_needed TEXT[];
  v_effective BOOLEAN;
  v_required_functions TEXT[] := ARRAY[
    'public.auth_memberships(text)',
    'public.auth_session_by_hash(text)',
    'public.login_attempt_record(text,text,integer)',
    'public.login_attempt_count(text,integer)',
    'public.login_attempt_clear(text)',
    'public.login_attempt_retry_after(text,integer)',
    'public.sync_cursor_reserve(text,text,integer)',
    'public.sync_cursor_reserve_item(text,text,integer)',
    'public.sync_cursor_skip(text,bigint,text)',
    'public.sync_cursor_publish(text,bigint,text,text,text,text,bigint,jsonb,boolean)',
    'public.sync_cursor_sweep(text,integer)',
    'public.sync_cursor_pull(text,bigint,integer)'
  ];
  v_function_signature TEXT;
  v_internal_trigger_functions TEXT[] := ARRAY[
    'public.companies_seed_equipment_categories()',
    'public.companies_seed_obligation_types()',
    'public.guard_project_assignment_history()',
    'public.reject_project_assignments_truncate()',
    'public.guard_workday_identity()',
    'public.guard_work_entry_overlap()',
    'public.guard_sync_receipt_update()',
    'public.guard_sync_conflict_update()'
  ];
  v_sync_function_unsafe TEXT;
BEGIN
  IF NOT has_schema_privilege(current_user, 'public', 'USAGE') THEN
    RAISE EXCEPTION 'PREFLIGHT: aplikacijska rola nema USAGE na public šemi.';
  END IF;
  IF has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'PREFLIGHT: aplikacijska rola ima CREATE na public šemi; runtime rola ne smije kreirati objekte.';
  END IF;

  -- Svaka public tabela/view i sekvenca mora biti navedena; novi objekat ne dobija implicitni ACL.
  SELECT string_agg(format('%I.%I (%s)', n.nspname, c.relname,
                           CASE WHEN c.relkind = 'S' THEN 'sequence' ELSE 'table' END), ', '
                    ORDER BY c.relname)
    INTO v_untracked
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     AND NOT EXISTS (
       SELECT 1 FROM privilege_matrix m
        WHERE m.kind = CASE WHEN c.relkind = 'S' THEN 'sequence' ELSE 'table' END
          AND m.object = c.relname
     );
  IF v_untracked IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public objekti nedostaju iz privilege-matrix.tsv: %.', v_untracked;
  END IF;

  SELECT string_agg(m.kind || ' ' || m.object, ', ' ORDER BY m.kind, m.object)
    INTO v_missing_objects
    FROM privilege_matrix m
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = m.object
        AND c.relkind = CASE WHEN m.kind = 'sequence' THEN 'S' ELSE c.relkind END
        AND (m.kind = 'sequence' OR c.relkind IN ('r', 'p', 'v', 'm', 'f'))
   );
  IF v_missing_objects IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: matrica navodi objekte kojih nema u public šemi: %.', v_missing_objects;
  END IF;

  -- Svaka tabela bez RLS-a mora imati eksplicitan, razlogom obrazložen allowlist unos.
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO v_unlisted_non_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND NOT c.relrowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM privilege_matrix m
        WHERE m.kind = 'table'
          AND m.object = c.relname
          AND nullif(btrim(m.rls_exception_reason), '') IS NOT NULL
     );
  IF v_unlisted_non_rls IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public tabele bez RLS-a nisu obrazložene u allowlisti: %.', v_unlisted_non_rls;
  END IF;

  SELECT string_agg(m.object, ', ' ORDER BY m.object)
    INTO v_stale_allowlist
    FROM privilege_matrix m
    JOIN pg_class c ON c.relname = m.object
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE m.kind = 'table'
     AND nullif(btrim(m.rls_exception_reason), '') IS NOT NULL
     AND c.relrowsecurity;
  IF v_stale_allowlist IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: allowlist razlog je ostao na tabelama koje sada imaju RLS; ažuriraj matricu: %.', v_stale_allowlist;
  END IF;

  SELECT string_agg(m.kind || ' ' || m.object, ', ' ORDER BY m.kind, m.object)
    INTO v_bad_allowlist
    FROM privilege_matrix m
   WHERE nullif(btrim(m.rls_exception_reason), '') IS NOT NULL
     AND (m.kind <> 'table' OR NOT EXISTS (
       SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = m.object
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relrowsecurity
     ));
  IF v_bad_allowlist IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: RLS allowlist smije navesti samo postojeće tabele bez RLS-a: %.', v_bad_allowlist;
  END IF;

  -- Globalni users/companies nemaju company_id, ali su pod posebnim, pregledanim RLS politikama.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'users' AND c.relrowsecurity
       AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: users mora imati RLS uključen i barem jednu politiku.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'companies' AND c.relrowsecurity
       AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: companies mora imati RLS uključen i barem jednu politiku.';
  END IF;

  SELECT string_agg(required.policy_name, ', ' ORDER BY required.policy_name)
    INTO v_missing_policies
    FROM (VALUES
      ('companies', 'companies_current_tenant_read'),
      ('companies', 'companies_auth_membership_lookup'),
      ('companies', 'companies_invitation_lookup'),
      ('users', 'users_company_read'),
      ('users', 'users_login_email_lookup'),
      ('users', 'users_company_update'),
      ('users', 'users_invitation_insert')
    ) AS required(table_name, policy_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = required.table_name
        AND p.polname = required.policy_name
   );
  IF v_missing_policies IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: nedostaju obavezne users/companies RLS politike: %.', v_missing_policies;
  END IF;

  -- Efektivna prava, uključujući prava naslijeđena kroz PUBLIC/članstvo u drugim rolama,
  -- moraju biti tačno jednaka needed koloni. Column-level ACL-ovi su uključeni u provjeru.
  FOR v_item IN SELECT * FROM privilege_matrix ORDER BY kind, object LOOP
    IF v_item.needed IN ('', '-') THEN
      v_needed := ARRAY[]::TEXT[];
    ELSE
      v_needed := string_to_array(v_item.needed, ';');
    END IF;

    IF v_item.kind = 'table' AND EXISTS (
      SELECT 1 FROM unnest(v_needed) AS needed(privilege)
       WHERE needed.privilege NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: privilege-matrix.tsv navodi nepoznato pravo za tabelu %.', v_item.object;
    ELSIF v_item.kind = 'sequence' AND EXISTS (
      SELECT 1 FROM unnest(v_needed) AS needed(privilege)
       WHERE needed.privilege NOT IN ('USAGE', 'SELECT', 'UPDATE')
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: privilege-matrix.tsv navodi nepoznato pravo za sekvencu %.', v_item.object;
    END IF;

    IF v_item.kind = 'table' THEN
      v_relation := to_regclass(format('%I.%I', 'public', v_item.object));
      IF v_relation IS NULL THEN
        RAISE EXCEPTION 'PREFLIGHT: ne mogu razriješiti tabelu public.%.', v_item.object;
      END IF;

      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        v_effective := has_table_privilege(current_user, v_relation, v_privilege);
        IF v_privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN
          v_effective := v_effective OR has_any_column_privilege(current_user, v_relation, v_privilege);
        END IF;
        IF v_effective AND NOT (v_privilege = ANY(v_needed)) THEN
          v_extra_privileges := concat_ws(', ', nullif(v_extra_privileges, ''),
            format('table %I: unexpected %s', v_item.object, v_privilege));
        ELSIF NOT v_effective AND v_privilege = ANY(v_needed) THEN
          v_missing_privileges := concat_ws(', ', nullif(v_missing_privileges, ''),
            format('table %I: missing %s', v_item.object, v_privilege));
        END IF;
      END LOOP;
    ELSE
      v_relation := to_regclass(format('%I.%I', 'public', v_item.object));
      IF v_relation IS NULL THEN
        RAISE EXCEPTION 'PREFLIGHT: ne mogu razriješiti sekvencu public.%.', v_item.object;
      END IF;

      FOREACH v_privilege IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
        v_effective := has_sequence_privilege(current_user, v_relation, v_privilege);
        IF v_effective AND NOT (v_privilege = ANY(v_needed)) THEN
          v_extra_privileges := concat_ws(', ', nullif(v_extra_privileges, ''),
            format('sequence %I: unexpected %s', v_item.object, v_privilege));
        ELSIF NOT v_effective AND v_privilege = ANY(v_needed) THEN
          v_missing_privileges := concat_ws(', ', nullif(v_missing_privileges, ''),
            format('sequence %I: missing %s', v_item.object, v_privilege));
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF v_extra_privileges <> '' THEN
    RAISE EXCEPTION 'PREFLIGHT: efektivni app grantovi prelaze privilege-matrix.tsv: %.', v_extra_privileges;
  END IF;
  IF v_missing_privileges <> '' THEN
    RAISE EXCEPTION 'PREFLIGHT: nedostaju kritična prava iz privilege-matrix.tsv: %.', v_missing_privileges;
  END IF;

  -- Kontrolisane lookup/rate-limit funkcije su eksplicitna iznimka od table ACL-a.
  FOREACH v_function_signature IN ARRAY v_required_functions LOOP
    v_function := to_regprocedure(v_function_signature);
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: nedostaje kritična funkcija %.', v_function_signature;
    END IF;
    IF NOT has_function_privilege(current_user, v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'PREFLIGHT: aplikacijska rola nema EXECUTE na kritičnoj funkciji %.', v_function_signature;
    END IF;
  END LOOP;

  FOREACH v_function_signature IN ARRAY v_internal_trigger_functions LOOP
    v_function := to_regprocedure(v_function_signature);
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: nedostaje interni trigger helper %.', v_function_signature;
    END IF;
    IF has_function_privilege(current_user, v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'PREFLIGHT: aplikacijska rola ne smije direktno izvršiti trigger helper %.', v_function_signature;
    END IF;
  END LOOP;

  v_function := to_regprocedure('public.project_assignment_no_overlap()');
  IF v_function IS NOT NULL AND has_function_privilege(current_user, v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'PREFLIGHT: aplikacijska rola ne smije direktno izvršiti R3 overlap trigger helper.';
  END IF;

  SELECT string_agg(p.oid::regprocedure::TEXT, ', ' ORDER BY p.oid::regprocedure::TEXT)
    INTO v_sync_function_unsafe
    FROM pg_proc p
   WHERE p.oid = ANY(ARRAY[
       to_regprocedure('public.sync_cursor_reserve(text,text,integer)')::oid,
       to_regprocedure('public.sync_cursor_reserve_item(text,text,integer)')::oid,
       to_regprocedure('public.sync_cursor_skip(text,bigint,text)')::oid,
       to_regprocedure('public.sync_cursor_publish(text,bigint,text,text,text,text,bigint,jsonb,boolean)')::oid,
       to_regprocedure('public.sync_cursor_sweep(text,integer)')::oid,
       to_regprocedure('public.sync_cursor_pull(text,bigint,integer)')::oid
     ])
     AND (
       NOT p.prosecdef
       OR position('app.company_id' IN p.prosrc) = 0
       OR position('search_path=pg_catalog, public, pg_temp' IN
                    array_to_string(COALESCE(p.proconfig, ARRAY[]::TEXT[]), ';')) = 0
     );
  IF v_sync_function_unsafe IS NOT NULL THEN
    RAISE EXCEPTION
      'PREFLIGHT: cursor SECURITY DEFINER funkcije nemaju tenant provjeru/search_path ili nisu definer: %.',
      v_sync_function_unsafe;
  END IF;

  -- App ne smije direktno pozivati neočekivanu SECURITY DEFINER funkciju. Samo provjerene
  -- lookup/rate-limit/cursor funkcije su dozvoljeni definer API; trigger helperi nisu direktno
  -- izvršivi od gradix_app.
  SELECT string_agg(p.oid::regprocedure::TEXT, ', ' ORDER BY p.oid::regprocedure::TEXT)
    INTO v_unexpected_definers
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND has_function_privilege(current_user, p.oid, 'EXECUTE')
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(ARRAY[
           to_regprocedure('public.login_attempt_record(text,text,integer)')::oid,
           to_regprocedure('public.login_attempt_count(text,integer)')::oid,
           to_regprocedure('public.login_attempt_clear(text)')::oid,
           to_regprocedure('public.login_attempt_retry_after(text,integer)')::oid,
           to_regprocedure('public.sync_cursor_reserve(text,text,integer)')::oid,
           to_regprocedure('public.sync_cursor_reserve_item(text,text,integer)')::oid,
           to_regprocedure('public.sync_cursor_skip(text,bigint,text)')::oid,
           to_regprocedure('public.sync_cursor_publish(text,bigint,text,text,text,text,bigint,jsonb,boolean)')::oid,
           to_regprocedure('public.sync_cursor_sweep(text,integer)')::oid,
           to_regprocedure('public.sync_cursor_pull(text,bigint,integer)')::oid
         ]) AS allowed(function_oid)
        WHERE allowed.function_oid = p.oid
     );
  IF v_unexpected_definers IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: gradix_app može izvršiti neallowlistanu SECURITY DEFINER funkciju: %.', v_unexpected_definers;
  END IF;

  RAISE NOTICE 'PREFLIGHT OK: % public table/sequence objekata je inventarisano; efektivni ACL tačno prati needed matricu.',
    (SELECT count(*) FROM privilege_matrix);
  RAISE NOTICE 'PREFLIGHT OK: svaka public tabela bez RLS-a ima obrazložen allowlist unos; users/companies imaju pregledane RLS politike.';
  RAISE NOTICE 'PREFLIGHT OK: schema_migrations, platform_users, login_attempts i login_attempts_id_seq nemaju direktna app prava.';
  RAISE NOTICE 'PREFLIGHT OK: lookup/rate-limit/cursor funkcije imaju ograničen EXECUTE i siguran tenant-checked SECURITY DEFINER; nema neočekivanog prava.';
END
$privilege_preflight$;
