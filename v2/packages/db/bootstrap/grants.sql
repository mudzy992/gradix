-- Aplikacijska rola dobija tačno prava iz `preflight-checks/privilege-matrix.tsv`.
-- Pokreće se kao migrator/vlasnik nakon svih migracija i pri svakom deployu. Idempotentno.
--
-- Nikad GRANT ALL na sve tabele/sekvence: nov objekat nema pristup dok matrica nije
-- pregledana. Preflight pod DATABASE_URL provjerava efektivna prava (uključujući naslijeđena).
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gradix_app') THEN
    RAISE EXCEPTION 'Nedostaje rola gradix_app; prvo pokreni bootstrap/roles.sql.';
  END IF;
  IF current_user = 'gradix_app' THEN
    RAISE EXCEPTION 'grants.sql mora pokrenuti migrator/vlasnik, ne gradix_app.';
  END IF;
END
$$;

-- Ukloni istorijski široki ACL i javne pristupe; zatim se ispod dodaju samo prava iz matrice.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, gradix_app;
GRANT USAGE ON SCHEMA public TO gradix_app;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, gradix_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, gradix_app;

-- REVOKE ALL ON TABLE uklanja tabelna prava, ali zato eksplicitno ukloni i eventualne
-- column-level ACL-ove (SELECT/INSERT/UPDATE/REFERENCES) koje bi inače zaobišle matricu.
DO $$
DECLARE
  v_column RECORD;
BEGIN
  FOR v_column IN
    SELECT c.relname, a.attname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND a.attnum > 0
       AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE public.%2$I FROM PUBLIC, gradix_app',
      v_column.attname, v_column.relname
    );
  END LOOP;
END
$$;

-- Novе tabele i sekvence ostaju bez app ACL-a. Važi za DDL koji izvrši ova migracijska rola.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM gradix_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM gradix_app;

-- Tabele — tačno `needed` kolona iz privilege-matrix.tsv.
GRANT SELECT ON TABLE public.companies TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.users TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.memberships TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sessions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.machines TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.audit_events TO gradix_app;
-- platform_users, schema_migrations, login_attempts: namjerno bez direktnih prava.
GRANT SELECT, INSERT ON TABLE public.sync_items TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.invitations TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.password_resets TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.workers TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.equipment_categories TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.obligation_types TO gradix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.obligations TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.obligation_versions TO gradix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.obligation_attachments TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.projects TO gradix_app;
GRANT SELECT, INSERT, DELETE ON TABLE public.project_assignments TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_assignment_overrides TO gradix_app;
-- No direct sequence rights; login_attempts_id_seq is used only by its definer function.

-- App-callable lookup and rate-limit functions. Revoke default PUBLIC EXECUTE first; these
-- functions are the only deliberate exceptions to direct table access in the login path.
REVOKE ALL ON FUNCTION public.auth_memberships(TEXT) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.auth_memberships(TEXT) TO gradix_app;
REVOKE ALL ON FUNCTION public.auth_session_by_hash(TEXT) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.auth_session_by_hash(TEXT) TO gradix_app;

REVOKE ALL ON FUNCTION public.login_attempt_record(TEXT, TEXT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.login_attempt_record(TEXT, TEXT, INTEGER) TO gradix_app;
REVOKE ALL ON FUNCTION public.login_attempt_count(TEXT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.login_attempt_count(TEXT, INTEGER) TO gradix_app;
REVOKE ALL ON FUNCTION public.login_attempt_clear(TEXT) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.login_attempt_clear(TEXT) TO gradix_app;
REVOKE ALL ON FUNCTION public.login_attempt_retry_after(TEXT, INTEGER) FROM PUBLIC, gradix_app;
GRANT EXECUTE ON FUNCTION public.login_attempt_retry_after(TEXT, INTEGER) TO gradix_app;

-- SECURITY DEFINER trigger helpers run through their trigger, never by direct app invocation.
REVOKE ALL ON FUNCTION public.companies_seed_equipment_categories() FROM PUBLIC, gradix_app;
REVOKE ALL ON FUNCTION public.companies_seed_obligation_types() FROM PUBLIC, gradix_app;

COMMIT;
