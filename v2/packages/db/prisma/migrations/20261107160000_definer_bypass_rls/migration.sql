-- ISTORIJSKA POPRAVKA: prijava i refresh nisu radili u starom Coolify testnom setupu
-- u kojem je aplikacijska rola (`gradix_app`) posjedovala šemu i tabele. Taj setup više
-- nije podržan za deploy; runtime preflight zahtijeva odvojenu, ne-vlasničku DATABASE_URL rolu.
--
-- Zašto je do greške dolazilo: `FORCE ROW LEVEL SECURITY` važi i za VLASNIKA tabela.
-- `SECURITY DEFINER` se izvršava kao vlasnik funkcije, pa je u starom jednorolnom setupu
-- lookup vraćao nula redova. U starom testu sa dvije role koji je koristio superusera je „radio“
-- iz pogrešnog razloga, jer superuser uvijek zaobilazi RLS. `SET row_security = off` nije rješenje:
-- PostgreSQL ga odbija uz FORCE RLS.
--
-- Rješenje: uske, SAMO-ČITAJUĆE politike vezane na TAČAN ključ pretrage.
--   * `memberships`: red je vidljiv kad je `app.auth_lookup_user` jednak `user_id`
--   * `sessions`:    red je vidljiv kad je `app.auth_lookup_token` jednak `token_hash`
-- Ključ postavlja isključivo server (apps/web/src/server/auth-lookup.ts), kratkotrajno
-- (SET LOCAL u transakciji), i to tek nakon provjerene lozinke / posjedovanja tokena.
--
-- Zašto je to bezbjedno: politika NE dozvoljava čitanje „svega“, nego najviše onoga što
-- funkcija ionako vraća za proslijeđeni parametar — nema novog opsega. Bez postavljenog
-- ključa politika ne propušta ništa (fail-closed). Upisi kroz nju nisu dozvoljeni (FOR SELECT).

DROP POLICY IF EXISTS auth_lookup_membership ON memberships;
CREATE POLICY auth_lookup_membership ON memberships
  FOR SELECT
  USING (user_id = nullif(current_setting('app.auth_lookup_user', true), ''));

DROP POLICY IF EXISTS auth_lookup_session ON sessions;
CREATE POLICY auth_lookup_session ON sessions
  FOR SELECT
  USING (token_hash = nullif(current_setting('app.auth_lookup_token', true), ''));

-- Funkcije više nisu SECURITY DEFINER: za podržanu ne-vlasničku aplikacijsku rolu pravo
-- pristupa nosi politika iznad. Superuseri i vlasničke DATABASE_URL role nisu podržani;
-- runtime preflight odbija takvu konfiguraciju.
CREATE OR REPLACE FUNCTION auth_memberships(p_user_id TEXT)
RETURNS TABLE (company_id TEXT, roles "Role"[], company_active BOOLEAN)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.company_id, m.roles, c.is_active
    FROM memberships m
    JOIN companies c ON c.id = m.company_id
   WHERE m.user_id = p_user_id
     AND m.is_active;
$$;

CREATE OR REPLACE FUNCTION auth_session_by_hash(p_token_hash TEXT)
RETURNS TABLE (id TEXT, user_id TEXT, company_id TEXT, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.user_id, s.company_id, s.expires_at, s.revoked_at
    FROM sessions s
   WHERE s.token_hash = p_token_hash;
$$;

INSERT INTO schema_migrations (name) VALUES ('20261107160000_definer_bypass_rls') ON CONFLICT DO NOTHING;
