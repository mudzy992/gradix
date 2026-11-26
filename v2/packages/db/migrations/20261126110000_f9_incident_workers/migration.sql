-- F9: svi učesnici incidenta, uključujući više povrijeđenih; raniji pojedinačni podatak ostaje.
CREATE TABLE public.hse_incident_workers (
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
CREATE INDEX hse_incident_workers_worker_idx ON public.hse_incident_workers (company_id, worker_id, incident_id);

-- Migraciona rola ima BYPASSRLS, pa se očuvaju svi ranije prijavljeni povrijeđeni.
INSERT INTO public.hse_incident_workers (id, company_id, incident_id, worker_id, injured)
SELECT 'hiw_' || md5(company_id || ':' || id || ':' || injured_worker_id), company_id, id, injured_worker_id, true
  FROM public.hse_incidents WHERE injured_worker_id IS NOT NULL;

CREATE FUNCTION public.hse_incident_workers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER hse_incident_workers_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hse_incident_workers
  FOR EACH ROW EXECUTE FUNCTION public.hse_incident_workers_guard();
ALTER TABLE public.hse_incident_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_incident_workers FORCE ROW LEVEL SECURITY;
CREATE POLICY hse_incident_workers_tenant_isolation ON public.hse_incident_workers
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));
