-- Prijava: kako saznati kojoj firmi korisnik pripada, a da RLS ostane uključen.
--
-- Problem: `users` je globalni identitet (nema RLS — ispravno), ali `memberships` JE
-- tenant tabela. Pri prijavi još ne znamo firmu, pa je ne možemo postaviti prije upita.
--
-- Rješenje: jedna uska, read-only SECURITY DEFINER funkcija koja vraća članstva
-- SAMO za zadati `user_id`. Aplikacija je zove tek nakon provjerene lozinke.
-- Nije opći bypass: funkcija ne prima firmu, ne prima filter, ne vraća druge korisnike.
-- Izvor obrasca: standardni PostgreSQL pristup za "login lookup" uz RLS.
--
-- Alternativa (odbačena): isključiti RLS na `memberships` — tada bi procurila lista
-- članstava svih firmi kroz bilo koji upit.

CREATE OR REPLACE FUNCTION auth_memberships(p_user_id TEXT)
RETURNS TABLE (company_id TEXT, roles "Role"[], company_active BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.company_id, m.roles, c.is_active
    FROM memberships m
    JOIN companies c ON c.id = m.company_id
   WHERE m.user_id = p_user_id
     AND m.is_active;
$$;

REVOKE ALL ON FUNCTION auth_memberships(TEXT) FROM PUBLIC;
-- Izvršavanje: aplikacijska rola ako postoji (model A), inače vlasnik funkcije (model B).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gradix_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth_memberships(TEXT) TO gradix_app';
  END IF;
END
$$;

-- Nagovještaj planeru za čest upit po korisniku (članstva su već pokrivena unique indeksom).
CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships (user_id);

INSERT INTO schema_migrations (name) VALUES ('20261107140000_auth_lookup') ON CONFLICT DO NOTHING;
