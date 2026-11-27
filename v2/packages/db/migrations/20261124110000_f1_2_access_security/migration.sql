-- F1.2 — sigurnost pristupa: 2FA, istorija lozinki, uređaji, platform operator, audit klase
-- (spec 01 §1.2–§1.9, §2.2, §2.3).
--
-- Obrazac koji se ponavlja: globalne tabele (`users` i njegovi sateliti) NISU tenant tabele,
-- ali im pristup ide kroz politiku koja traži članstvo u tekućoj firmi — isto kao `users`
-- od migracije `b_tenant_global_rls_privileges`. Tako `2FA` tajna jednog korisnika nije
-- vidljiva firmi B čak i ako se ID pogodi.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Lozinke: istorija i zaključavanje
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  -- Zaključavanje poslije 10 promašaja (spec 01 §1.4.19). Vrijeme, ne brojač stanja:
  -- isteklo zaključavanje se ne mora „resetovati“ poslom.
  ADD COLUMN locked_until        TIMESTAMPTZ,
  ADD COLUMN failed_login_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN password_changed_at TIMESTAMPTZ,
  -- Prisilni reset od 180 dana — SAMO uredske role (§1.4.20). Za ostale ostaje NULL.
  ADD COLUMN password_expires_at TIMESTAMPTZ,
  ADD COLUMN totp_enabled        BOOLEAN NOT NULL DEFAULT false,
  -- Obavezna rola bez uparivanja: prijava prolazi, ali smije samo uparivanje i odjavu.
  ADD COLUMN must_enroll_2fa     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN last_login_at       TIMESTAMPTZ,
  ADD COLUMN timezone            TEXT NOT NULL DEFAULT 'Europe/Sarajevo';

-- Postojeći nalozi: datum promjene nije poznat, pa se uzima vrijeme migracije. Alternativa je
-- NULL, ali tada bi svi odmah bili „istekli“; ovako svako dobija pun prozor od 180 dana.
UPDATE public.users SET password_changed_at = created_at WHERE password_changed_at IS NULL;

CREATE TABLE public.password_history (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_history_user_idx ON public.password_history (user_id, created_at DESC);

-- Max 3 zapisa po korisniku održava SERVIS, u istoj transakciji koja upisuje novi hash.
--
-- Zašto ne trigger: aplikacijska rola nema DELETE na ovoj tabeli (matrica), pa bi trim tražio
-- SECURITY DEFINER funkciju — nova izvršiva definer funkcija je nova površina napada, a
-- preflight bi je morao posebno odobravati. Servis je jedini put pisanja (bez DELETE granta
-- niko drugi i ne može obrisati), pa je trim tamo i dovoljan.

-- ---------------------------------------------------------------------------
-- 2. Dvofaktorska autentikacija (TOTP)
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_totp (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  -- AES-256-GCM, ključ izveden iz AUTH_SECRET. Tajna NIKAD nije u audit-u ni u logu.
  secret_enc   TEXT NOT NULL,
  -- Uparivanje nije gotovo dok korisnik ne unese prvi kod: `confirmed_at IS NULL` znači
  -- „tajna postoji, ali nije potvrđena“ i takva 2FA se ne traži pri prijavi.
  confirmed_at TIMESTAMPTZ,
  -- Zadnji prihvaćen vremenski korak (TOTP je 30 s): spriječi ponovnu upotrebu istog koda.
  last_used_step BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_recovery_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_recovery_codes_unique UNIQUE (user_id, code_hash)
);

CREATE INDEX user_recovery_codes_user_idx ON public.user_recovery_codes (user_id) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Sesije kao uređaji (spec 01 §1.6)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sessions
  ADD COLUMN user_agent   TEXT,
  ADD COLUMN device_label TEXT,
  ADD COLUMN ip_hash      TEXT,
  ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Jedna aktivna sesija po uređaju (§1.6.30): pri ponovnoj prijavi sa istog uređaja stara
  -- se opoziva. `device_hash` je hash stabilnog dijela UA + korisnik, nikad sirovi UA.
  ADD COLUMN device_hash  TEXT;

CREATE INDEX sessions_device_idx ON public.sessions (company_id, user_id, device_hash)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Platform operator (spec 01 §1.8)
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_users
  ADD COLUMN display_name TEXT,
  ADD COLUMN is_active    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN last_login_at TIMESTAMPTZ,
  -- TOTP je i za operatora obavezan: on mijenja firme, a ne samo čita.
  ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE public.platform_sessions (
  id              TEXT PRIMARY KEY,
  platform_user_id TEXT NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  user_agent      TEXT,
  ip_hash         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX platform_sessions_user_idx ON public.platform_sessions (platform_user_id, created_at DESC);

-- Support pristup: vremenski ograničen, sa OBAVEZNIM razlogom, vidljiv firmi u njenom auditu.
CREATE TABLE public.platform_support_sessions (
  id               TEXT PRIMARY KEY,
  platform_user_id TEXT NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  company_id       TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reason           TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  revoked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT platform_support_sessions_reason_check CHECK (length(btrim(reason)) >= 10),
  -- Nikad duže od sat vremena (§1.8.37); UI nudi 15/30/60.
  CONSTRAINT platform_support_sessions_window_check CHECK (expires_at <= created_at + INTERVAL '60 minutes')
);

CREATE INDEX platform_support_sessions_company_idx
  ON public.platform_support_sessions (company_id, created_at DESC);
CREATE INDEX platform_support_sessions_active_idx
  ON public.platform_support_sessions (company_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Audit: klase retencije i čitanje osjetljivih podataka (spec 01 §1.9)
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_events
  -- STANDARD 2 g. · ACCESS 5 g. · FINANCIAL 10 g.
  ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'STANDARD',
  -- Rola u trenutku radnje: rola se mijenja, a trag mora ostati tačan.
  ADD COLUMN actor_role TEXT,
  -- Čitanje osjetljivog podatka nema `entity_id` izmjene; ipak mora imatiSUBJEKTA.
  ADD CONSTRAINT audit_events_retention_class_check
    CHECK (retention_class IN ('STANDARD', 'ACCESS', 'FINANCIAL'));

CREATE INDEX audit_events_retention_idx ON public.audit_events (retention_class, created_at);

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sessions FORCE ROW LEVEL SECURITY;
-- Bez politike za `gradix_app` i bez GRANT-a u matrici: platforma ide kroz svoju rolu.
-- Politika postoji samo da FORCE RLS ne bude prazan (preflight traži razlog za RLS bez politike).

ALTER TABLE public.platform_support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_sessions FORCE ROW LEVEL SECURITY;
-- Firma MORA vidjeti da je support pristup aktivan (zaglavlje UI-a, §1.8.37) — zato tenant
-- politika, jedina tenant politika među platform tabelama.
CREATE POLICY platform_support_sessions_tenant_read ON public.platform_support_sessions
  FOR SELECT
  USING (company_id = current_setting('app.company_id', true));

-- Globalni sateliti korisnika: čitanje i pisanje samo za člana tekuće firme. Bez ovoga bi
-- `user_totp` bio čitljiv svakome kome se pogodi `user_id`.
ALTER TABLE public.password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_history FORCE ROW LEVEL SECURITY;
CREATE POLICY password_history_member ON public.password_history
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.user_id = password_history.user_id
         AND m.company_id = current_setting('app.company_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.user_id = password_history.user_id
         AND m.company_id = current_setting('app.company_id', true)
    )
  );

ALTER TABLE public.user_totp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_totp FORCE ROW LEVEL SECURITY;
CREATE POLICY user_totp_member ON public.user_totp
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.user_id = user_totp.user_id
         AND m.company_id = current_setting('app.company_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.user_id = user_totp.user_id
         AND m.company_id = current_setting('app.company_id', true)
    )
  );
-- Prijava mora pročitati TOTP tajnu PRIJE nego što tenant kontekst postoji (email+lozinka su
-- već provjereni). To ide kroz usku politiku na tačan ključ, isti obrazac kao login lookup.
CREATE POLICY user_totp_login_lookup ON public.user_totp
  FOR SELECT
  USING (user_id = nullif(current_setting('app.auth_lookup_user', true), ''));

ALTER TABLE public.user_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY user_recovery_codes_member ON public.user_recovery_codes
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.user_id = user_recovery_codes.user_id
         AND m.company_id = current_setting('app.company_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.user_id = user_recovery_codes.user_id
         AND m.company_id = current_setting('app.company_id', true)
    )
  );
CREATE POLICY user_recovery_codes_login_lookup ON public.user_recovery_codes
  FOR SELECT
  USING (user_id = nullif(current_setting('app.auth_lookup_user', true), ''));

INSERT INTO public.schema_migrations (name)
VALUES ('20261124110000_f1_2_access_security')
ON CONFLICT DO NOTHING;

COMMIT;
