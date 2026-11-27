-- F0.4 — obavještenja (spec 12 §1.2) + poslovi u pozadini.
--
-- Zašto sada: svaki modul poslije Faze 0 samo poziva `notify()`. Ako inbox ne postoji, svaki
-- modul izmišlja svoj način obavještavanja i korisnik dobija tri zvona na tri mjesta.
--
-- Tri tabele, tri odgovornosti:
--   `notifications`            — šta je korisniku rečeno (in-app je OBAVEZAN kanal);
--   `notification_preferences` — šta je izabrao za push/email (in-app se ne može isključiti);
--   `notification_deliveries`  — šta se stvarno poslalo, po kanalu, sa razlogom neuspjeha.

BEGIN;

CREATE TABLE public.notifications (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  -- Primalac: konkretna osoba ILI sve osobe s rolom (`role_target`). Nikad oboje prazno.
  user_id       TEXT,
  role_target   TEXT,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  -- `href` je OBAVEZAN: obavještenje bez linka je slijepa ulica (spec 12 §8).
  href          TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'INFO',
  source_type   TEXT,
  source_id     TEXT,
  -- Jedno obavještenje po STVARI, ne po prolazu posla (`budget:prj:rev2:80`).
  dedupe_key    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ,
  actioned_at   TIMESTAMPTZ,

  CONSTRAINT notifications_severity_check CHECK (severity IN ('INFO', 'WARN', 'CRITICAL')),
  CONSTRAINT notifications_target_check CHECK (user_id IS NOT NULL OR role_target IS NOT NULL),
  CONSTRAINT notifications_href_check CHECK (href LIKE '/%'),
  CONSTRAINT notifications_read_after_created_check CHECK (read_at IS NULL OR read_at >= created_at)
);

-- Jedno obavještenje po stvari po firmi: posao može pasti i ponoviti se 100 puta.
CREATE UNIQUE INDEX notifications_dedupe_unique
  ON public.notifications (company_id, dedupe_key);

-- Inbox: „moja neproučena, najnovija prva“ mora biti jedan indeks, ne skeniranje.
CREATE INDEX notifications_inbox_idx
  ON public.notifications (company_id, user_id, read_at, created_at DESC);

CREATE INDEX notifications_role_idx
  ON public.notifications (company_id, role_target, read_at, created_at DESC);

CREATE INDEX notifications_retention_idx
  ON public.notifications (company_id, created_at)
  WHERE read_at IS NOT NULL;

CREATE TABLE public.notification_preferences (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  user_id     TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  -- In-app se NE može isključiti: to je jedini kanal koji radi bez SMTP-a i bez push tokena.
  in_app      BOOLEAN NOT NULL DEFAULT true,
  push        BOOLEAN NOT NULL DEFAULT true,
  email       BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT notification_preferences_in_app_check CHECK (in_app),
  CONSTRAINT notification_preferences_unique UNIQUE (company_id, user_id, kind)
);

CREATE TABLE public.notification_deliveries (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  notification_id  TEXT NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING',
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT notification_deliveries_channel_check CHECK (channel IN ('IN_APP', 'PUSH', 'EMAIL')),
  CONSTRAINT notification_deliveries_status_check
    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'BLOCKED_NO_PROVIDER')),
  CONSTRAINT notification_deliveries_sent_check CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
  CONSTRAINT notification_deliveries_unique UNIQUE (notification_id, channel)
);

CREATE INDEX notification_deliveries_retry_idx
  ON public.notification_deliveries (company_id, status)
  WHERE status IN ('PENDING', 'FAILED');

-- RLS: ista politika kao svaka tenant tabela; `FORCE` znači i vlasnik šeme prolazi kroz nju.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_isolation ON public.notifications
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_tenant_isolation ON public.notification_preferences
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_deliveries_tenant_isolation ON public.notification_deliveries
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- Bez DELETE granta: brisanje po retenciji radi worker svojom (admin) konekcijom.
GRANT SELECT, INSERT, UPDATE ON TABLE public.notifications TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_preferences TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_deliveries TO gradix_app;

-- Opcija mjesečnog izvještaja emailom — po firmi, NIJE default (spec 12 §19).
ALTER TABLE public.companies
  ADD COLUMN monthly_report_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN monthly_report_recipients TEXT[];

INSERT INTO public.schema_migrations (name)
VALUES ('20261123140000_f0_4_notifications')
ON CONFLICT DO NOTHING;

COMMIT;
