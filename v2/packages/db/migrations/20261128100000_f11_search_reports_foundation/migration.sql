-- F11A: samo struktura i indeksi. Postojeći podaci (uključujući stare redove bez
-- projekta/vrste/formatiranja) ostaju čitljivi. RLS i postojeći grants se ne mijenjaju.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX projects_search_name_trgm_idx ON public.projects USING gin (name gin_trgm_ops);
CREATE INDEX projects_search_code_trgm_idx ON public.projects USING gin (code gin_trgm_ops);
CREATE INDEX workers_search_first_trgm_idx ON public.workers USING gin (first_name gin_trgm_ops);
CREATE INDEX workers_search_last_trgm_idx ON public.workers USING gin (last_name gin_trgm_ops);
CREATE INDEX workers_search_full_name_trgm_idx ON public.workers USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX machines_search_name_trgm_idx ON public.machines USING gin (name gin_trgm_ops);
CREATE INDEX machines_search_code_trgm_idx ON public.machines USING gin (code gin_trgm_ops);
CREATE INDEX tenders_search_title_trgm_idx ON public.tenders USING gin (title gin_trgm_ops);
CREATE INDEX partners_search_name_trgm_idx ON public.partners USING gin (name gin_trgm_ops);
CREATE INDEX partners_search_code_trgm_idx ON public.partners USING gin (code gin_trgm_ops);
CREATE INDEX attachments_search_filename_trgm_idx ON public.attachments USING gin (file_name gin_trgm_ops);
CREATE INDEX purchase_invoices_search_number_trgm_idx ON public.purchase_invoices USING gin (invoice_number gin_trgm_ops);

-- Nullable za očuvanje već postojećih redova iz F1. Odvojeni djelimični indeksi
-- sprečavaju i duplikate starih zbirnih i duplikate projektnih redova.
ALTER TABLE public.daily_rollups ADD COLUMN project_id TEXT;
ALTER TABLE public.daily_rollups DROP CONSTRAINT daily_rollups_unique;
ALTER TABLE public.daily_rollups ADD CONSTRAINT daily_rollups_project_fk
  FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX daily_rollups_company_day_total_unique ON public.daily_rollups (company_id, rollup_date)
  WHERE project_id IS NULL;
CREATE UNIQUE INDEX daily_rollups_company_project_day_unique ON public.daily_rollups (company_id, project_id, rollup_date)
  WHERE project_id IS NOT NULL;

-- Ledger dopušta negativne OFFSET redove. Projektni neto trošak može biti negativan;
-- ostale količine ostaju nenegativne. Ne zamjenjuje izvorni ledger.
ALTER TABLE public.daily_rollups DROP CONSTRAINT daily_rollups_nonneg_check;
ALTER TABLE public.daily_rollups ADD CONSTRAINT daily_rollups_nonneg_check
  CHECK (workday_count >= 0 AND hours_total >= 0 AND machine_hours >= 0 AND fuel_liters >= 0);

ALTER TABLE public.report_jobs
  ADD COLUMN report_key TEXT,
  ADD COLUMN params JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN format TEXT,
  ADD COLUMN attachment_id TEXT,
  ADD COLUMN dedupe_key TEXT,
  ADD CONSTRAINT report_jobs_format_check CHECK (format IS NULL OR format IN ('PDF', 'XLSX')),
  ADD CONSTRAINT report_jobs_params_check CHECK (jsonb_typeof(params) = 'object'),
  ADD CONSTRAINT report_jobs_attachment_fk FOREIGN KEY (company_id, attachment_id)
    REFERENCES public.attachments(company_id, id) ON DELETE RESTRICT;
ALTER TABLE public.report_jobs DROP CONSTRAINT report_jobs_kind_check;
ALTER TABLE public.report_jobs ADD CONSTRAINT report_jobs_kind_check
  CHECK (kind IN ('MONTHLY_SUMMARY', 'HOURS_EXPORT', 'COST_EXPORT', 'REPORT'));
ALTER TABLE public.report_jobs ADD CONSTRAINT report_jobs_report_check CHECK (
  kind <> 'REPORT' OR (report_key IN ('PROJECT_COSTS', 'MACHINE_UTILIZATION', 'FUEL', 'WORK_HOURS', 'DEADLINES', 'TENDERS', 'HSE')
    AND report_key IS NOT NULL AND format IS NOT NULL)
);
CREATE UNIQUE INDEX report_jobs_company_dedupe_idx ON public.report_jobs (company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

INSERT INTO public.schema_migrations(name) VALUES ('20261128100000_f11_search_reports_foundation') ON CONFLICT DO NOTHING;
