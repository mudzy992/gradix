-- Global user credentials, not tenant data. The server sets the authenticated (or
-- exact pre-auth login lookup) user in a transaction-local setting. As with the
-- existing company RLS, the app is a trusted middle tier, not an end-user DB role.
CREATE TABLE public.user_passkeys (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  device_name text NOT NULL CHECK (length(btrim(device_name)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX user_passkeys_user_idx ON public.user_passkeys(user_id, created_at);
ALTER TABLE public.user_passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_passkeys FORCE ROW LEVEL SECURITY;
CREATE POLICY passkeys_user_isolation ON public.user_passkeys
  USING (user_id = nullif(current_setting('app.passkey_user_id', true), ''))
  WITH CHECK (user_id = nullif(current_setting('app.passkey_user_id', true), ''));

-- A challenge is scoped by an unpredictable browser-held token, stored only as a
-- digest. Login challenges carry no tenant id; registration is also bound to the
-- already authenticated user and session. Claim using DELETE ... RETURNING.
CREATE TABLE public.webauthn_challenges (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  challenge text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('REGISTER', 'LOGIN')),
  user_id text REFERENCES public.users(id) ON DELETE CASCADE,
  session_id text,
  login_identifier_hash text,
  rp_id text NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CHECK ((purpose = 'REGISTER' AND user_id IS NOT NULL AND session_id IS NOT NULL AND login_identifier_hash IS NULL)
      OR (purpose = 'LOGIN' AND user_id IS NULL AND session_id IS NULL AND login_identifier_hash IS NOT NULL))
);
CREATE INDEX webauthn_challenges_expiry_idx ON public.webauthn_challenges(expires_at);
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY webauthn_challenge_token_isolation ON public.webauthn_challenges
  USING (token_hash = nullif(current_setting('app.webauthn_token_hash', true), ''))
  WITH CHECK (token_hash = nullif(current_setting('app.webauthn_token_hash', true), ''));

-- Bounded maintenance through an owner-only FORCE-RLS policy. Runtime can call
-- the narrow definer but cannot read expired challenges or delete unexpired ones.
CREATE POLICY webauthn_expired_owner_select ON public.webauthn_challenges
  FOR SELECT TO CURRENT_USER USING (expires_at <= now());
CREATE POLICY webauthn_expired_owner_delete ON public.webauthn_challenges
  FOR DELETE TO CURRENT_USER USING (expires_at <= now());
CREATE FUNCTION public.purge_expired_webauthn_challenges() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  DELETE FROM public.webauthn_challenges
   WHERE token_hash IN (SELECT token_hash FROM public.webauthn_challenges
                         WHERE expires_at <= now() ORDER BY expires_at LIMIT 1000)
     AND expires_at <= now()
$$;
REVOKE ALL ON FUNCTION public.purge_expired_webauthn_challenges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_webauthn_challenges() TO gradix_app;

INSERT INTO public.schema_migrations(name) VALUES ('20261130100000_f11_5_passkeys') ON CONFLICT DO NOTHING;
