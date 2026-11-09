-- B: RLS za globalni tenant registry/identitete i usko app ACL.
BEGIN;
--
-- `companies.id` je tenant ključ; `users` je globalni identitet koji može biti povezan sa
-- članstvima. Obje tabele dobijaju fail-closed RLS. Prije tenanta su dozvoljeni samo:
--   * login: tačan normalizovani email (`app.auth_lookup_email`),
--   * članstva nakon provjere lozinke (`app.auth_lookup_user`),
--   * pregled pozivnice po tačnom hash-u (`app.invite_lookup_token`).
--
-- Ne koristimo FORCE RLS na ove dvije globalne tabele: migrator/seed i dalje mora održavati
-- globalni identitet i registry. Podržana DATABASE_URL rola nije vlasnik tabela (preflight
-- to odbija), pa aplikacijski upiti su i dalje pod RLS-om. Tenant tabele ostaju FORCE RLS.

-- Migracija je data-preserving. Ukloni ranije široke ACL-ove prije nego grants.sql poslije
-- svih migracija ponovo doda samo prava iz privilege-matrix.tsv.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM gradix_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM gradix_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM gradix_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM gradix_app;
REVOKE CREATE ON SCHEMA public FROM gradix_app;

-- Companies: red firme je dostupan unutar svog tenant konteksta, login lookup-a za aktivnog
-- člana ili tačnog, još važećeg invitation tokena (preview prije prijave).
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_current_tenant_read ON companies;
CREATE POLICY companies_current_tenant_read ON companies
  FOR SELECT
  USING (id = nullif(current_setting('app.company_id', true), ''));

DROP POLICY IF EXISTS companies_auth_membership_lookup ON companies;
CREATE POLICY companies_auth_membership_lookup ON companies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM memberships m
       WHERE m.company_id = companies.id
         AND m.user_id = nullif(current_setting('app.auth_lookup_user', true), '')
         AND m.is_active
    )
  );

DROP POLICY IF EXISTS companies_invitation_lookup ON companies;
CREATE POLICY companies_invitation_lookup ON companies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM invitations i
       WHERE i.company_id = companies.id
         AND i.token_hash = nullif(current_setting('app.invite_lookup_token', true), '')
         AND i.used_at IS NULL
         AND i.revoked_at IS NULL
         AND i.expires_at > now()
    )
  );

-- Users: ordinary reads/updates require a membership in the current company. Login may read
-- only the row matching the exact normalized email set in a transaction-local lookup. A new
-- app-created identity is allowed only while accepting the matching invitation; seed remains
-- an owner/migrator operation through DATABASE_ADMIN_URL.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_company_read ON users;
CREATE POLICY users_company_read ON users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM memberships m
       WHERE m.user_id = users.id
         AND m.company_id = nullif(current_setting('app.company_id', true), '')
    )
  );

DROP POLICY IF EXISTS users_login_email_lookup ON users;
CREATE POLICY users_login_email_lookup ON users
  FOR SELECT
  USING (
    lower(email) = lower(nullif(current_setting('app.auth_lookup_email', true), ''))
  );

DROP POLICY IF EXISTS users_company_update ON users;
CREATE POLICY users_company_update ON users
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
        FROM memberships m
       WHERE m.user_id = users.id
         AND m.company_id = nullif(current_setting('app.company_id', true), '')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM memberships m
       WHERE m.user_id = users.id
         AND m.company_id = nullif(current_setting('app.company_id', true), '')
    )
  );

DROP POLICY IF EXISTS users_invitation_insert ON users;
CREATE POLICY users_invitation_insert ON users
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM invitations i
       WHERE i.company_id = nullif(current_setting('app.company_id', true), '')
         AND lower(i.email) = lower(users.email)
         AND i.token_hash = nullif(current_setting('app.invite_lookup_token', true), '')
         AND i.used_at IS NOT NULL
         AND i.revoked_at IS NULL
         AND i.expires_at > now()
    )
  );

INSERT INTO schema_migrations (name)
VALUES ('20261110120000_b_tenant_global_rls_privileges')
ON CONFLICT DO NOTHING;
COMMIT;
