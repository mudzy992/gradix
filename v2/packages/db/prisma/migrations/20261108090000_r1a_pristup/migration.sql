-- R1a: pristup — pozivnice, reset lozinke, opseg članstva, rate limit koji radi na više replika.
--
-- Tri obrasca RLS-a, svi fail-closed (vidi docs/PLAN-R1.md):
--   1. tenant politika          → invitations, password_resets (admin izdaje, ima firmu)
--   2. politika na TAČAN KLJUČ  → čitanje pozivnice/reseta prije prijave, bez tenantа
--   3. bez SELECT prava         → login_attempts (samo kroz dvije funkcije)
--
-- Nijedna tabela ne dobija politiku koja pušta „sve“. Token se u bazi drži samo kao SHA-256.

-- ---------------------------------------------------------------------------
-- 1. Pozivnice
-- ---------------------------------------------------------------------------
CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  roles       "Role"[] NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'COMPANY' CHECK (scope IN ('COMPANY', 'PROJECTS', 'SELF')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX invitations_company_idx ON invitations (company_id, created_at DESC);
-- Jedna važeća pozivnica po emailu u firmi (opozvane/iskorištene ne broje se).
CREATE UNIQUE INDEX invitations_one_pending_per_email
  ON invitations (company_id, lower(email))
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE  ROW LEVEL SECURITY;

-- Tenant pristup: admin izdate firme.
CREATE POLICY tenant_isolation ON invitations
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- Prije prijave: red je vidljiv SAMO kad se poklopi tačan ključ koji je server stavio u
-- `app.invite_lookup_token` (isti obrazac kao `auth_lookup_session`).
CREATE POLICY invite_lookup ON invitations
  FOR SELECT
  USING (token_hash = nullif(current_setting('app.invite_lookup_token', true), ''));

-- Prihvatanje: jedan red, atomski, samo dok nije iskorišten ni opozvan ni istekao.
CREATE POLICY invite_accept ON invitations
  FOR UPDATE
  USING (
    token_hash = nullif(current_setting('app.invite_lookup_token', true), '')
    AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  )
  WITH CHECK (
    token_hash = nullif(current_setting('app.invite_lookup_token', true), '')
  );

-- ---------------------------------------------------------------------------
-- 2. Reset lozinke (admin pokreće)
-- ---------------------------------------------------------------------------
CREATE TABLE password_resets (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_resets_company_idx ON password_resets (company_id, created_at DESC);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);

ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON password_resets
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

CREATE POLICY reset_lookup ON password_resets
  FOR SELECT
  USING (token_hash = nullif(current_setting('app.reset_lookup_token', true), ''));

CREATE POLICY reset_accept ON password_resets
  FOR UPDATE
  USING (
    token_hash = nullif(current_setting('app.reset_lookup_token', true), '')
    AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  )
  WITH CHECK (token_hash = nullif(current_setting('app.reset_lookup_token', true), ''));

-- ---------------------------------------------------------------------------
-- 3. Opseg članstva: cijela firma / dodijeljeni projekti / samo svoje
-- ---------------------------------------------------------------------------
-- `project_ids` je TEXT[] bez FK-a: tabela `projects` dolazi u R2. Dok je nema, RLS politika
-- ne može provjeriti da li projekat postoji, pa se validacija radi u aplikaciji, a kolona je
-- prazna za `COMPANY` i `SELF`. Kad `projects` postoji, dodaje se FK i backfill u istom rezu.
ALTER TABLE memberships
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'COMPANY' CHECK (scope IN ('COMPANY', 'PROJECTS', 'SELF')),
  ADD COLUMN project_ids TEXT[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- 4. Rate limit prijave koji radi na više replika
-- ---------------------------------------------------------------------------
-- Tabela NIJE tenant i NE SADRŽI čitljiv identitet: `email_hash` je SHA-256 sa AUTH_SECRET
-- kao pepperom, `ip_hash` isto. Bez peppera se iz baze ne može pogoditi email.
CREATE TABLE login_attempts (
  id          BIGSERIAL PRIMARY KEY,
  email_hash  TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_email_idx ON login_attempts (email_hash, at DESC);
CREATE INDEX login_attempts_at_idx ON login_attempts (at);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
-- Bez ijedne politike: rola ne vidi ni jedan red. Pristup ide isključivo kroz funkcije niže,
-- koje su SECURITY DEFINER (vlasnik je `gradix`, ne aplikacijska rola u modelu C).
-- Prava se dodjeljuju centralno u `packages/db/bootstrap/grants.sql` (pokreće se poslije
-- svake migracije). Ona tamo i EKSPLICITNO opoziva prava na ovoj tabeli — bez toga bi
-- `GRANT ... ON ALL TABLES` dao aplikaciji direktan SELECT i RLS bez politike ne bi bio
-- dovoljan dokaz.

CREATE OR REPLACE FUNCTION login_attempt_record(p_email_hash TEXT, p_ip_hash TEXT, p_window_seconds INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE recent INTEGER;
BEGIN
  -- Čišćenje bez `worker` procesa: sve starije od prozora izlazi pri svakom zapisu.
  DELETE FROM login_attempts WHERE at < now() - make_interval(secs => p_window_seconds * 10);
  INSERT INTO login_attempts (email_hash, ip_hash) VALUES (p_email_hash, p_ip_hash);
  SELECT count(*) INTO recent
    FROM login_attempts
   WHERE email_hash = p_email_hash
     AND at > now() - make_interval(secs => p_window_seconds);
  RETURN recent;
END;
$$;

CREATE OR REPLACE FUNCTION login_attempt_count(p_email_hash TEXT, p_window_seconds INTEGER)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int FROM login_attempts
   WHERE email_hash = p_email_hash
     AND at > now() - make_interval(secs => p_window_seconds);
$$;

CREATE OR REPLACE FUNCTION login_attempt_clear(p_email_hash TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM login_attempts WHERE email_hash = p_email_hash;
$$;

-- ---------------------------------------------------------------------------
-- 5. Audit: polja koja preživljavaju brisanje korisnika + metadata bez tajni
-- ---------------------------------------------------------------------------
ALTER TABLE audit_events
  ADD COLUMN actor_email TEXT,
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN ip_hash TEXT;

CREATE INDEX audit_events_actor_idx ON audit_events (company_id, actor_id, created_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events (company_id, entity_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Prava
-- ---------------------------------------------------------------------------
-- Namjerno NIŠTA ovdje: prava idu kroz `bootstrap/grants.sql`, koja se izvršava poslije
-- svake migracije (idempotentno) i koja za `login_attempts` radi REVOKE, a za nove tabele
-- i funkcije GRANT. Jedno mjesto za prava, jedan test.

-- ---------------------------------------------------------------------------
-- 7. Token za obaveznu promjenu lozinke (R1a)
-- ---------------------------------------------------------------------------
-- Nosač u access JWT-u: dok je `mustChangePassword` u bazi `true`, sesija dobija kratak
-- token (15 min) i SVE rute osim promjene lozinke i odjave vraćaju `AUTH_PASSWORD_CHANGE_REQUIRED`.
-- Uz to `authenticate` provjerava bazu na svakom zahtjevu, pa i sesija izdata prije
-- promjene prestaje važiti odmah.
ALTER TABLE sessions ADD COLUMN pwd_change_required BOOLEAN NOT NULL DEFAULT false;

INSERT INTO schema_migrations (name) VALUES ('20261108090000_r1a_pristup') ON CONFLICT DO NOTHING;
