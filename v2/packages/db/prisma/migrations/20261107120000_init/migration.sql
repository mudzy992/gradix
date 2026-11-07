-- R0 init: hodajući kostur + RLS dubinska zaštita.
-- Naprijed-samo. Ručno napisano jer u sandboxu nema pristupa binaries.prisma.sh
-- (Prisma generator/migrate engine se skida sa tog hosta — vidi ADR 0002).
-- Šema odgovara packages/db/prisma/schema.prisma.

-- ID-evi su cuid() iz aplikacije, pa baza ne traži pgcrypto/gen_random_uuid.

CREATE TYPE "Locale" AS ENUM ('bs', 'en');

-- Role unutar firme. Operator platforme nije rola (odvojen entitet platform_users).
CREATE TYPE "Role" AS ENUM (
  'OWNER', 'ADMIN', 'PROJECT_MANAGER', 'SITE_SUPERVISOR', 'WORKER',
  'DRIVER', 'MACHINE_OPERATOR', 'MECHANIC', 'ACCOUNTANT'
);

CREATE TABLE companies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  timezone   TEXT NOT NULL DEFAULT 'Europe/Sarajevo',
  currency   TEXT NOT NULL DEFAULT 'BAM',
  locale     "Locale" NOT NULL DEFAULT 'bs',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  locale               "Locale" NOT NULL DEFAULT 'bs',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Članstvo je jedino mjesto gdje korisnik dobija firmu i role.
CREATE TABLE memberships (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  roles      "Role"[] NOT NULL DEFAULT '{}',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memberships_user_company_unique UNIQUE (user_id, company_id)
);
CREATE INDEX memberships_company_id_idx ON memberships (company_id);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_company_user_idx ON sessions (company_id, user_id);

-- Minimalna tabela mehanizacije za spike (puni model je R2).
CREATE TABLE machines (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT machines_company_code_unique UNIQUE (company_id, code)
);
CREATE INDEX machines_company_id_idx ON machines (company_id);

CREATE TABLE audit_events (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_company_created_idx ON audit_events (company_id, created_at);

CREATE TABLE platform_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- RLS: dubinska zaštita, ne zamjena za aplikacijski scope (ADR 0003).
--
-- Aplikacija u svakoj transakciji postavlja `app.company_id` (SET LOCAL).
-- Politike propuštaju red samo ako se company_id poklapa.
--
-- Dvije zamke koje su namjerne i dokumentovane:
--  1) Bez postavljene varijable politika ne propušta ništa (fail-closed).
--  2) Vlasnik tabele zaobilazi RLS osim uz FORCE ROW LEVEL SECURITY — zato FORCE.
--     U produkciji aplikacija koristi odvojenu rolu koja nije vlasnik šeme.
-- ---------------------------------------------------------------------------

ALTER TABLE memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships  FORCE  ROW LEVEL SECURITY;
ALTER TABLE sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions     FORCE  ROW LEVEL SECURITY;
ALTER TABLE machines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines     FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON memberships
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

CREATE POLICY tenant_isolation ON sessions
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

CREATE POLICY tenant_isolation ON machines
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

CREATE POLICY tenant_isolation ON audit_events
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));
