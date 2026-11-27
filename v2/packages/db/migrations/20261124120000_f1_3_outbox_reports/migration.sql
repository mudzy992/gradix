-- F1.3 — šabloni obavještenja, poslovi izvještaja i dnevni rollup (spec 01 §1.11, §2.2).
--
-- Zašto `report_jobs` i `daily_rollups` postoje već sada, bez ijednog posla koji ih puni:
-- Faza 1 uvodi `notify()`, a mjesečni izvještaj je prvi posao koji šalje NEŠTO, a ne samo
-- obavještava. Bez ovih tabela Faza 2 bi ih morala dodavati u istom rezu kao posao — a tada
-- se, po iskustvu, nikad ne stigne napisati „zašto“. Tabele su prazne i to je u redu.
--
-- `daily_rollups` je izvedeni podatak: dnevni zbir po firmi i datumu. Njegova svrha je
-- dashboard koji ne skenira 12 mjeseci radnih dana na svaki otvaranje (Modul 9).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Šabloni obavještenja (spec 01 §1.11.47)
-- ---------------------------------------------------------------------------
-- `company_id NULL` = PLATFORMSKI default. Firma može imati svoj tekst za isti `code`, pa
-- `notify()` traži prvo njen, pa platformski. `code` je iz zatvorenog kataloga (u kodu), da
-- šabloni ne postanu način da se izmisli novo obavještenje bez prevoda i bez `href`-a.
CREATE TABLE public.notification_templates (
  id         TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  locale     "Locale" NOT NULL DEFAULT 'bs',
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  -- Varijable koje šablon smije koristiti (`{{worker}}`, `{{date}}`). Zatvoren spisak u kodu.
  variables  TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT notification_templates_subject_check CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  -- Platformski default je unique po (code, locale); firmi isti code može biti samo jednom.
  CONSTRAINT notification_templates_unique UNIQUE (company_id, code, locale)
);

-- Postgres tretira NULL-ove u UNIQUE kao različite, pa platformski default traži poseban
-- parcijalni indeks — bez njega bi svaki deploy mogao ubaciti drugi „default“.
CREATE UNIQUE INDEX notification_templates_platform_unique
  ON public.notification_templates (code, locale)
  WHERE company_id IS NULL;

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates FORCE ROW LEVEL SECURITY;
-- Firma vidi SVOJ šablon i platformski default; tuđi ne vidi nikad.
CREATE POLICY notification_templates_read ON public.notification_templates
  FOR SELECT
  USING (
    company_id = current_setting('app.company_id', true)
    OR company_id IS NULL
  );
CREATE POLICY notification_templates_write ON public.notification_templates
  FOR ALL
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- ---------------------------------------------------------------------------
-- 2. Poslovi izvještaja (kostur; puni ga Modul 9/12)
-- ---------------------------------------------------------------------------
CREATE TABLE public.report_jobs (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  kind         TEXT NOT NULL,
  period_from  DATE NOT NULL,
  period_to    DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'QUEUED',
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  -- Rezultat: gdje je fajl (S3 ključ) i kada je gotov. Nikad sadržaj u bazi.
  object_key   TEXT,
  completed_at TIMESTAMPTZ,
  requested_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT report_jobs_kind_check CHECK (kind IN ('MONTHLY_SUMMARY', 'HOURS_EXPORT', 'COST_EXPORT')),
  CONSTRAINT report_jobs_status_check
    CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DEAD')),
  CONSTRAINT report_jobs_period_check CHECK (period_to >= period_from),
  CONSTRAINT report_jobs_done_check CHECK ((status = 'DONE') = (completed_at IS NOT NULL))
);

CREATE INDEX report_jobs_pending_idx ON public.report_jobs (company_id, status, created_at)
  WHERE status IN ('QUEUED', 'RUNNING');

ALTER TABLE public.report_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY report_jobs_tenant_isolation ON public.report_jobs
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- ---------------------------------------------------------------------------
-- 3. Dnevni rollup (izvedeni podatak, Modul 9)
-- ---------------------------------------------------------------------------
-- Jedan red po firmi i datumu. `workday_count` i `hours_total` su ono što dashboard prikazuje;
-- bez ovoga svaki otvaranje Pregleda zbraja sve radne dane firme.
CREATE TABLE public.daily_rollups (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  rollup_date    DATE NOT NULL,
  workday_count  INTEGER NOT NULL DEFAULT 0,
  hours_total    NUMERIC(10,2) NOT NULL DEFAULT 0,
  machine_hours  NUMERIC(10,2) NOT NULL DEFAULT 0,
  fuel_liters    NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_cents     BIGINT NOT NULL DEFAULT 0,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT daily_rollups_nonneg_check
    CHECK (workday_count >= 0 AND hours_total >= 0 AND machine_hours >= 0
           AND fuel_liters >= 0 AND cost_cents >= 0),
  CONSTRAINT daily_rollups_unique UNIQUE (company_id, rollup_date)
);

CREATE INDEX daily_rollups_company_date_idx ON public.daily_rollups (company_id, rollup_date DESC);

ALTER TABLE public.daily_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_rollups FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_rollups_tenant_isolation ON public.daily_rollups
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- ---------------------------------------------------------------------------
-- 4. Uređaji za push (mobilni); puni se u Modulu 12
-- ---------------------------------------------------------------------------
-- `expo_push_token` je tajna u smislu da identifikuje uređaj; ne ide u audit ni u log.
CREATE TABLE public.user_devices (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  expo_push_token TEXT NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_devices_platform_check CHECK (platform IN ('ios', 'android')),
  CONSTRAINT user_devices_token_unique UNIQUE (expo_push_token)
);

CREATE INDEX user_devices_user_idx ON public.user_devices (company_id, user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY user_devices_tenant_isolation ON public.user_devices
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

INSERT INTO public.schema_migrations (name)
VALUES ('20261124120000_f1_3_outbox_reports')
ON CONFLICT DO NOTHING;

COMMIT;
