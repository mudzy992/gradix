-- Refresh: pronalaženje sesije po hashu tokena PRIJE nego znamo firmu.
--
-- `sessions` je tenant tabela (RLS), a klijent koji šalje refresh ne nosi firmu.
-- Isti obrazac kao `auth_memberships`: uska, read-only, SECURITY DEFINER funkcija
-- koja prima samo hash i vraća jedan red (ili nijedan).

CREATE OR REPLACE FUNCTION auth_session_by_hash(p_token_hash TEXT)
RETURNS TABLE (id TEXT, user_id TEXT, company_id TEXT, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.user_id, s.company_id, s.expires_at, s.revoked_at
    FROM sessions s
   WHERE s.token_hash = p_token_hash;
$$;

REVOKE ALL ON FUNCTION auth_session_by_hash(TEXT) FROM PUBLIC;
-- Istorijski testovi su imali i jednu vlasničku rolu; to nije podržani deploy model.
-- Današnji runtime preflight zahtijeva ne-vlasničku DATABASE_URL rolu (ADR 0012).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gradix_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth_session_by_hash(TEXT) TO gradix_app';
  END IF;
END
$$;

INSERT INTO schema_migrations (name) VALUES ('20261107150000_session_lookup') ON CONFLICT DO NOTHING;
