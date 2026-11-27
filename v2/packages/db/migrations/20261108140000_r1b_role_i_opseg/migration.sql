-- R1b: opseg članstva na dvije vrijednosti, audit indeksi za filtere i keyset.
--
-- Odluka vlasnika (2026-11-08): opseg „dodijeljeni projekti" odlazi u R2. Zato se vrijednost
-- PROJECTS i kolona `memberships.project_ids` BRIŠU — ništa što UI ne nudi ne ostaje u bazi.
-- Vraćanje ide pravom migracijom u R2 (vidi docs/PLAN-R2.md), kad postoji tabela `projects`.

-- ---------------------------------------------------------------------------
-- 1. Opseg: samo COMPANY i SELF
-- ---------------------------------------------------------------------------
-- Prvo podaci, pa ograničenje: nijedan red ne smije ostati sa vrijednošću koja se gasi.
-- U R1a nijedan ekran nije nudio PROJECTS, pa je ovo u praksi no-op — ali migracija ne smije
-- zavisiti od te pretpostavke.
UPDATE memberships SET scope = 'COMPANY' WHERE scope = 'PROJECTS';

ALTER TABLE memberships DROP CONSTRAINT memberships_scope_check;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_scope_check CHECK (scope IN ('COMPANY', 'SELF'));

-- Kolona bez FK-a (tabela `projects` dolazi u R2) i bez ijednog ekrana koji je puni: briše se.
ALTER TABLE memberships DROP COLUMN project_ids;

-- ---------------------------------------------------------------------------
-- 2. Audit: filter i keyset cursor
-- ---------------------------------------------------------------------------
-- Filter po radnji („ko je mijenjao role") i po resursu.
CREATE INDEX IF NOT EXISTS audit_events_action_idx
  ON audit_events (company_id, action, created_at DESC);

-- Keyset paginacija: `ORDER BY created_at DESC, id DESC` sa `WHERE (created_at, id) < (...)`.
-- Offset bi na tragu koji raste preskakao i duplirao zapise kad u međuvremenu stigne novi.
CREATE INDEX IF NOT EXISTS audit_events_keyset_idx
  ON audit_events (company_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 3. Prava
-- ---------------------------------------------------------------------------
-- Nijedno novo pravo: sve ide kroz postojeće tabele i `bootstrap/grants.sql`.

INSERT INTO schema_migrations (name) VALUES ('20261108140000_r1b_role_i_opseg') ON CONFLICT DO NOTHING;
