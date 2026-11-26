-- F9: svi učesnici incidenta, uključujući više povrijeđenih; raniji pojedinačni podatak ostaje.
-- Produkcijska baza može već imati ovu tabelu (i samo dio njenih objekata).
CREATE TABLE IF NOT EXISTS public.hse_incident_workers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  injured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hse_incident_workers_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hse_incident_workers_incident_fk FOREIGN KEY (company_id, incident_id) REFERENCES public.hse_incidents(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_incident_workers_worker_fk FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_incident_workers_unique UNIQUE (company_id, incident_id, worker_id)
);
ALTER TABLE public.hse_incident_workers
  ADD COLUMN IF NOT EXISTS id TEXT,
  ADD COLUMN IF NOT EXISTS company_id TEXT,
  ADD COLUMN IF NOT EXISTS incident_id TEXT,
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS injured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();
-- Ne izmišljamo nedostajuće identitete: nekonzistentni postojeći podaci moraju biti popravljeni.
ALTER TABLE public.hse_incident_workers
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN incident_id SET NOT NULL,
  ALTER COLUMN worker_id SET NOT NULL,
  ALTER COLUMN injured SET DEFAULT false,
  ALTER COLUMN injured SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN created_at SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.hse_incident_workers'::regclass AND contype='p') THEN
    ALTER TABLE public.hse_incident_workers ADD PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.hse_incident_workers'::regclass AND conname='hse_incident_workers_company_fk') THEN
    ALTER TABLE public.hse_incident_workers ADD CONSTRAINT hse_incident_workers_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.hse_incident_workers'::regclass AND conname='hse_incident_workers_incident_fk') THEN
    ALTER TABLE public.hse_incident_workers ADD CONSTRAINT hse_incident_workers_incident_fk FOREIGN KEY (company_id, incident_id) REFERENCES public.hse_incidents(company_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.hse_incident_workers'::regclass AND conname='hse_incident_workers_worker_fk') THEN
    ALTER TABLE public.hse_incident_workers ADD CONSTRAINT hse_incident_workers_worker_fk FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.hse_incident_workers'::regclass AND conname='hse_incident_workers_unique') THEN
    ALTER TABLE public.hse_incident_workers ADD CONSTRAINT hse_incident_workers_unique UNIQUE (company_id, incident_id, worker_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS hse_incident_workers_worker_idx ON public.hse_incident_workers (company_id, worker_id, incident_id);

-- Migraciona rola ima BYPASSRLS; postojeća veza se ne mijenja niti duplira.
INSERT INTO public.hse_incident_workers (id, company_id, incident_id, worker_id, injured)
SELECT 'hiw_' || md5(company_id || ':' || id || ':' || injured_worker_id), company_id, id, injured_worker_id, true
  FROM public.hse_incidents WHERE injured_worker_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.hse_incident_workers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'HSE_INCIDENT_IMMUTABLE: učesnici se ne prepisuju';
  END IF;
  IF NEW.injured AND EXISTS (
    SELECT 1 FROM public.hse_incidents i
     WHERE i.company_id = NEW.company_id AND i.id = NEW.incident_id AND i.kind = 'NEAR_MISS'
  ) THEN
    RAISE EXCEPTION 'HSE_NEAR_MISS_INJURED: neposredna opasnost nema povrijeđenih';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.hse_incident_workers_guard() FROM PUBLIC, gradix_app;
DROP TRIGGER IF EXISTS hse_incident_workers_guard ON public.hse_incident_workers;
CREATE TRIGGER hse_incident_workers_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hse_incident_workers
  FOR EACH ROW EXECUTE FUNCTION public.hse_incident_workers_guard();
ALTER TABLE public.hse_incident_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_incident_workers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hse_incident_workers_tenant_isolation ON public.hse_incident_workers;
CREATE POLICY hse_incident_workers_tenant_isolation ON public.hse_incident_workers
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));
