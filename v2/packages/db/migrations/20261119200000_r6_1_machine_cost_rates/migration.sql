-- R6.1: machine_cost_rates + project_cost_entries. FORCE RLS; no DELETE.
-- Formula: hours = duration(work_log); amount = hours × rate (Money cents).
BEGIN;

CREATE TABLE public.machine_cost_rates (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  machine_id     TEXT NOT NULL,
  amount_cents   BIGINT NOT NULL,
  currency_code  TEXT NOT NULL,
  valid_from     DATE NOT NULL,
  valid_to       DATE,
  created_by     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT machine_cost_rates_amount_check CHECK (amount_cents >= 0),
  CONSTRAINT machine_cost_rates_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT machine_cost_rates_valid_range_check
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT machine_cost_rates_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT machine_cost_rates_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_cost_rates_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_cost_rates_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT machine_cost_rates_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_cost_rates_machine_valid_idx
  ON public.machine_cost_rates (company_id, machine_id, valid_from);

CREATE TABLE public.project_cost_entries (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  project_id     TEXT NOT NULL,
  source_type    TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  machine_id     TEXT NOT NULL,
  hours          NUMERIC(12,3) NOT NULL,
  rate_cents     BIGINT NOT NULL,
  amount_cents   BIGINT NOT NULL,
  currency_code  TEXT NOT NULL,
  booked_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  booked_by      TEXT NOT NULL,
  note           TEXT,
  CONSTRAINT project_cost_entries_source_type_check
    CHECK (source_type IN ('MACHINE_WORK_LOG')),
  CONSTRAINT project_cost_entries_hours_check CHECK (hours > 0),
  CONSTRAINT project_cost_entries_rate_check CHECK (rate_cents >= 0),
  CONSTRAINT project_cost_entries_amount_check CHECK (amount_cents >= 0),
  CONSTRAINT project_cost_entries_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT project_cost_entries_note_check
    CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT project_cost_entries_source_unique
    UNIQUE (company_id, source_type, source_id),
  CONSTRAINT project_cost_entries_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT project_cost_entries_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_cost_entries_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_cost_entries_booked_by_fk
    FOREIGN KEY (booked_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX project_cost_entries_project_booked_idx
  ON public.project_cost_entries (company_id, project_id, booked_at DESC);
CREATE INDEX project_cost_entries_machine_idx
  ON public.project_cost_entries (company_id, machine_id, booked_at DESC);

ALTER TABLE public.machine_cost_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_cost_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY machine_cost_rates_tenant_isolation ON public.machine_cost_rates
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.project_cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_cost_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY project_cost_entries_tenant_isolation ON public.project_cost_entries
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_cost_rates TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.project_cost_entries TO gradix_app;

INSERT INTO public.schema_migrations (name)
VALUES ('20261119200000_r6_1_machine_cost_rates')
ON CONFLICT DO NOTHING;
COMMIT;
