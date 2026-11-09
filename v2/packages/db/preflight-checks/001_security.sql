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
         bool_and(t.tgenabled <> 'D'),
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

  RAISE NOTICE 'PREFLIGHT OK: DATABASE_URL rola "%" nije vlasnik tabela, nije superuser i nema BYPASSRLS.', v_role.rolname;
  RAISE NOTICE 'PREFLIGHT OK: RLS uključen i politika postoji na svih % tabela sa company_id.', v_company_table_count;
  RAISE NOTICE 'PREFLIGHT OK: memberships.scope DEFAULT je SELF; invitations.scope nema DEFAULT.';
  RAISE NOTICE 'PREFLIGHT OK: preklapanje = %; btree_gist %.',
    v_mechanism, COALESCE(v_gist_version, 'nije instaliran');
END
$preflight$;
