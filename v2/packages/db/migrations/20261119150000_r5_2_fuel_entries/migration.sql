-- R5.2: gorivo (fuel_entries) + revizije; proširenje brojila (FUEL). FORCE RLS; no DELETE grant.
BEGIN;

-- ---------------------------------------------------------------- fuel_entries
CREATE TABLE public.fuel_entries (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL,
  machine_id         TEXT NOT NULL,
  driver_worker_id   TEXT NOT NULL,
  project_id         TEXT,
  filled_at          TIMESTAMPTZ NOT NULL,
  liters             NUMERIC(12,3) NOT NULL,
  amount_cents       BIGINT NOT NULL,
  currency_code      TEXT NOT NULL,
  unit_price_cents   BIGINT,
  meter_reading      NUMERIC(12,1),
  note               TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  created_by         TEXT NOT NULL,
  updated_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fuel_entries_liters_check CHECK (liters > 0),
  CONSTRAINT fuel_entries_amount_check CHECK (amount_cents >= 0),
  CONSTRAINT fuel_entries_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT fuel_entries_unit_price_check CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  CONSTRAINT fuel_entries_meter_check CHECK (meter_reading IS NULL OR meter_reading >= 0),
  CONSTRAINT fuel_entries_note_check CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT fuel_entries_version_check CHECK (version > 0),
  CONSTRAINT fuel_entries_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT fuel_entries_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT fuel_entries_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fuel_entries_driver_fk
    FOREIGN KEY (company_id, driver_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fuel_entries_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fuel_entries_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT fuel_entries_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX fuel_entries_company_filled_idx
  ON public.fuel_entries (company_id, filled_at DESC, id);
CREATE INDEX fuel_entries_machine_filled_idx
  ON public.fuel_entries (company_id, machine_id, filled_at);
CREATE INDEX fuel_entries_driver_filled_idx
  ON public.fuel_entries (company_id, driver_worker_id, filled_at);

-- ---------------------------------------------------------------- machine_meter_readings (FUEL source)
ALTER TABLE public.machine_meter_readings
  DROP CONSTRAINT machine_meter_readings_source_check;
ALTER TABLE public.machine_meter_readings
  ADD COLUMN fuel_entry_id TEXT,
  ADD CONSTRAINT machine_meter_readings_source_check
    CHECK (source IN ('WORK_LOG', 'MANUAL', 'FUEL')),
  ADD CONSTRAINT machine_meter_readings_fuel_entry_fk
    FOREIGN KEY (company_id, fuel_entry_id)
    REFERENCES public.fuel_entries(company_id, id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------- fuel_entry_revisions
CREATE TABLE public.fuel_entry_revisions (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  fuel_entry_id  TEXT NOT NULL,
  base_version   INTEGER NOT NULL CHECK (base_version > 0),
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  author_id      TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fuel_entry_revisions_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT fuel_entry_revisions_entry_fk
    FOREIGN KEY (company_id, fuel_entry_id)
    REFERENCES public.fuel_entries(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fuel_entry_revisions_author_fk
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX fuel_entry_revisions_entry_idx
  ON public.fuel_entry_revisions (company_id, fuel_entry_id, created_at DESC);

-- ---------------------------------------------------------------- RLS
ALTER TABLE public.fuel_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY fuel_entries_tenant_isolation ON public.fuel_entries
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.fuel_entry_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_entry_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY fuel_entry_revisions_tenant_isolation ON public.fuel_entry_revisions
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON TABLE public.fuel_entries TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.fuel_entry_revisions TO gradix_app;

INSERT INTO public.schema_migrations (name)
VALUES ('20261119150000_r5_2_fuel_entries')
ON CONFLICT DO NOTHING;
COMMIT;