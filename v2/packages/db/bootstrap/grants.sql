-- Prava za aplikacijsku rolu. Idempotentno; pokreće se POSLIJE svake migracije
-- (db-apply.sh), pa promjena prava ne zavisi od toga je li migracija već evidentirana.
--
-- Model A: admin radi migracije, `gradix_app` samo radi aplikaciju.
-- Model B: `gradix_app` je vlasnik šeme — tada su prava već tu, a GRANT-ovi su bezopasni
--          (i izvršavaju se samo ako je rola različita od tekuće).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gradix_app') THEN
    RAISE NOTICE 'Rola gradix_app ne postoji — preskačem GRANT (model B).';
    RETURN;
  END IF;

  IF current_user <> 'gradix_app' THEN
    -- Model C (preporučen na Coolifyju): migracije radi vlasnik šeme (`gradix`),
    -- aplikacija radi kao `gradix_app`. Aplikacija NE dobija CREATE na šemi:
    -- tabele i poglede kreira isključivo migracija. To je i zaštita — aplikacijska
    -- rola ne može sama sebi dodati tabelu bez RLS-a.
    GRANT USAGE ON SCHEMA public TO gradix_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gradix_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gradix_app;
    -- Važno: ALTER DEFAULT PRIVILEGES važi za objekte koje kreira TEKUĆA rola.
    -- Zato se izvršava kao vlasnik šeme (admin konekcija), a ne kao gradix_app.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gradix_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO gradix_app;
  END IF;

  -- R1a: rate limit NAMJERNO nema direktan pristup tabeli. Aplikacija smije samo kroz
  -- funkcije (record/count/clear). Bez ovog REVOKE-a bi `GRANT ... ON ALL TABLES` iznad
  -- dao SELECT na tabeli bez ijedne RLS politike, pa bi „fail-closed“ bio samo na papiru.
  IF has_table_privilege('gradix_app', 'login_attempts', 'SELECT') THEN
    REVOKE ALL ON login_attempts FROM gradix_app;
  END IF;

  -- Uske lookup funkcije za prijavu i refresh. Aplikacija ih mora moći zvati.
  -- GRANT samo ako rola još NEMA pravo: kad je vlasnik funkcije, pravo već ima, a suvišan
  -- GRANT bi ispisao "no privileges were granted" upozorenje koje zbunjuje u logu.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'auth_memberships' AND n.nspname = 'public'
       AND NOT has_function_privilege('gradix_app', p.oid, 'EXECUTE')
  ) THEN
    GRANT EXECUTE ON FUNCTION auth_memberships(TEXT) TO gradix_app;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'auth_session_by_hash' AND n.nspname = 'public'
       AND NOT has_function_privilege('gradix_app', p.oid, 'EXECUTE')
  ) THEN
    GRANT EXECUTE ON FUNCTION auth_session_by_hash(TEXT) TO gradix_app;
  END IF;

  -- R1a: pozivnice, reset i rate limit.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'login_attempt_record' AND n.nspname = 'public'
       AND NOT has_function_privilege('gradix_app', p.oid, 'EXECUTE')
  ) THEN
    GRANT EXECUTE ON FUNCTION login_attempt_record(TEXT, TEXT, INTEGER) TO gradix_app;
    GRANT EXECUTE ON FUNCTION login_attempt_count(TEXT, INTEGER) TO gradix_app;
    GRANT EXECUTE ON FUNCTION login_attempt_clear(TEXT) TO gradix_app;
  END IF;

  -- Koliko još sekundi prozor drži korisnika (da poruka ne laže „sačekajte minutu").
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'login_attempt_retry_after' AND n.nspname = 'public'
       AND NOT has_function_privilege('gradix_app', p.oid, 'EXECUTE')
  ) THEN
    GRANT EXECUTE ON FUNCTION login_attempt_retry_after(TEXT, INTEGER) TO gradix_app;
  END IF;
END
$$;
