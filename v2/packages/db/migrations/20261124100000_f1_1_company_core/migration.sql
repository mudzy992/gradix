-- F1.1 — jezgro firme: Postavke, praznici, radno vrijeme (spec 01 §1.1, §2.1, §2.2).
--
-- Zašto ovo prije 2FA i sesija: obračun sati (Modul 6) računa prekovremeno i noćni rad iz
-- PODATAKA firme, a ne iz konstanti u kodu. Ako `workday_hours` i noćni prozor ne postoje kao
-- podatak, svaka firma dobija isti obračun — a pilot firma radi subotom.
--
-- Sve kolone su nullable ili sa defaultom: postojeće firme ne pucaju, a NULL znači
-- „nije uneseno“, ne „nula“. UI razlikuje ta dva stanja (prazno polje vs. 0).

BEGIN;

ALTER TABLE public.companies
  -- Identitet i kontakt (zaglavlje izvoza i fakture).
  ADD COLUMN legal_name        TEXT,
  ADD COLUMN tax_id            TEXT,
  ADD COLUMN vat_id            TEXT,
  ADD COLUMN vat_registered    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN address           TEXT,
  ADD COLUMN city              TEXT,
  ADD COLUMN postal_code       TEXT,
  ADD COLUMN country           TEXT NOT NULL DEFAULT 'BA',
  ADD COLUMN phone             TEXT,
  ADD COLUMN email             TEXT,
  ADD COLUMN web               TEXT,
  ADD COLUMN iban              TEXT,
  ADD COLUMN bank_name         TEXT,
  ADD COLUMN logo_object_key   TEXT,
  -- Rad i obračun. `workday_hours` i prag su numeric(4,2) da 7,50 h stane bez zaokruživanja.
  ADD COLUMN week_start        TEXT NOT NULL DEFAULT 'MON',
  ADD COLUMN workday_hours     NUMERIC(4,2) NOT NULL DEFAULT 8.00,
  ADD COLUMN overtime_daily_threshold NUMERIC(4,2) NOT NULL DEFAULT 8.00,
  ADD COLUMN night_from        TIME,
  ADD COLUMN night_to          TIME,
  ADD COLUMN holiday_paid      BOOLEAN NOT NULL DEFAULT true,
  -- Pragovi odobrenja (Modul 5 i 6): iznos iznad kojeg treba odobrenje, po firmi.
  ADD COLUMN approval_threshold_cents BIGINT,
  ADD COLUMN approval_threshold_currency TEXT,
  -- Default postavke izvoza i prikaza.
  ADD COLUMN default_locale    "Locale",
  ADD COLUMN default_currency  TEXT,
  -- Trag zadnje promjene postavki: ko i kada. Vlasnik mora vidjeti da je neko dirao prag.
  ADD COLUMN settings_updated_at TIMESTAMPTZ,
  ADD COLUMN settings_updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_week_start_check CHECK (week_start IN ('MON', 'SUN')),
  ADD CONSTRAINT companies_workday_hours_check CHECK (workday_hours > 0 AND workday_hours <= 24),
  ADD CONSTRAINT companies_overtime_threshold_check
    CHECK (overtime_daily_threshold >= 0 AND overtime_daily_threshold <= 24),
  -- Noćni prozor je interval koji smije preći ponoć (22:00–06:00), pa se NE traži from < to.
  -- Traži se da su oba postavljena ili nijedan: pola prozora je greška u podacima.
  ADD CONSTRAINT companies_night_window_check
    CHECK ((night_from IS NULL) = (night_to IS NULL)),
  ADD CONSTRAINT companies_approval_threshold_check
    CHECK ((approval_threshold_cents IS NULL) = (approval_threshold_currency IS NULL)),
  ADD CONSTRAINT companies_approval_threshold_positive_check
    CHECK (approval_threshold_cents IS NULL OR approval_threshold_cents > 0);

-- Default valuta/jezik su izvedeni iz postojećih `currency`/`locale` da ne postoje dva izvora
-- istine: `currency`/`locale` ostaju kanonske kolone, ove dvije samo pamte šta je bilo zadato
-- kao default pri kreiranju firme (za onboarding čarobnjak i izvoz).
UPDATE public.companies SET default_currency = currency, default_locale = locale;

-- ---------------------------------------------------------------------------
-- Praznici i prenesene radne subote
-- ---------------------------------------------------------------------------
-- Jedna tabela za oba slučaja: `is_working = true` znači „ovaj datum je RADNI iako je
-- neradni dan po kalendaru“ (prenesena subota). Bez toga obračun sati nema kako znati da je
-- subota bila radna, pa bi svi ti sati ispali prekovremeni.
CREATE TABLE public.company_holidays (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  name         TEXT NOT NULL,
  is_paid      BOOLEAN NOT NULL DEFAULT true,
  is_working   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT company_holidays_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT company_holidays_unique UNIQUE (company_id, holiday_date)
);

CREATE INDEX company_holidays_company_date_idx ON public.company_holidays (company_id, holiday_date);

ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY company_holidays_tenant_isolation ON public.company_holidays
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- ---------------------------------------------------------------------------
-- Šifarnici koje onboarding puni (spec 01 §1.10)
-- ---------------------------------------------------------------------------
-- Kategorije mašina i tipovi obaveza imaju `companies_seed_*` triggere iz R2; onboarding ih
-- zove eksplicitno, pa firma kreirana kroz operatora nije prazna. Ovdje se samo bilježi da je
-- seed izvršen — da čarobnjak ne bi dva puta punio šifarnike pri ponovnom pokušaju.
ALTER TABLE public.companies
  ADD COLUMN seeded_at TIMESTAMPTZ;

INSERT INTO public.schema_migrations (name)
VALUES ('20261124100000_f1_1_company_core')
ON CONFLICT DO NOTHING;

COMMIT;
