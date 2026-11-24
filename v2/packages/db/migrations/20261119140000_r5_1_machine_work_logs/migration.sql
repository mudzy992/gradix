-- R5.1: sati mašine, očitanja brojila i revizije. FORCE RLS; no DELETE grant.
-- Izvor: v1/backend/prisma/schema/fleet.prisma (TimerSession → machine_work_logs)
BEGIN;

-- ---------------------------------------------------------------- machine_work_logs
CREATE TABLE public.machine_work_logs (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  machine_id     TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  project_id     TEXT,
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ NOT NULL,
  mode           TEXT NOT NULL,
  meter_end      NUMERIC(12,1),
  note           TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT machine_work_logs_interval_check CHECK (ended_at > started_at),
  CONSTRAINT machine_work_logs_mode_check CHECK (mode IN ('WORK', 'IDLE', 'BREAKDOWN')),
  CONSTRAINT machine_work_logs_meter_end_check CHECK (meter_end IS NULL OR meter_end >= 0),
  CONSTRAINT machine_work_logs_note_check CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT machine_work_logs_version_check CHECK (version > 0),
  CONSTRAINT machine_work_logs_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT machine_work_logs_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_work_logs_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_work_logs_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_work_logs_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_work_logs_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT machine_work_logs_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_work_logs_company_started_idx
  ON public.machine_work_logs (company_id, started_at DESC, id);
CREATE INDEX machine_work_logs_machine_started_idx
  ON public.machine_work_logs (company_id, machine_id, started_at);
CREATE INDEX machine_work_logs_worker_started_idx
  ON public.machine_work_logs (company_id, worker_id, started_at);

CREATE OR REPLACE FUNCTION public.guard_machine_work_log_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $mwl_overlap$
DECLARE
  v_conflict_id TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.company_id || ':machine-work-log:' || NEW.machine_id, 0)
  );

  SELECT mwl.id INTO v_conflict_id
    FROM public.machine_work_logs mwl
   WHERE mwl.company_id = NEW.company_id
     AND mwl.machine_id = NEW.machine_id
     AND mwl.id <> NEW.id
     AND mwl.started_at < NEW.ended_at
     AND NEW.started_at < mwl.ended_at
   LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'MACHINE_WORK_LOG_OVERLAP'
      USING ERRCODE = '23P01',
            DETAIL = 'Mašina već ima zapis radnih sati koji se vremenski preklapa.';
  END IF;

  RETURN NEW;
END;
$mwl_overlap$;

CREATE TRIGGER machine_work_logs_no_overlap
  BEFORE INSERT OR UPDATE ON public.machine_work_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_machine_work_log_overlap();

-- ---------------------------------------------------------------- machine_meter_readings
CREATE TABLE public.machine_meter_readings (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  machine_id     TEXT NOT NULL,
  reading_value  NUMERIC(12,1) NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL,
  source         TEXT NOT NULL,
  work_log_id    TEXT,
  actor_id       TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT machine_meter_readings_reading_check CHECK (reading_value >= 0),
  CONSTRAINT machine_meter_readings_source_check CHECK (source IN ('WORK_LOG', 'MANUAL')),
  CONSTRAINT machine_meter_readings_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT machine_meter_readings_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_meter_readings_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_meter_readings_work_log_fk
    FOREIGN KEY (company_id, work_log_id)
    REFERENCES public.machine_work_logs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_meter_readings_actor_fk
    FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_meter_readings_machine_idx
  ON public.machine_meter_readings (company_id, machine_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION public.guard_machine_meter_reading_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $meter_guard$
DECLARE
  v_current NUMERIC(12,1);
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.company_id || ':machine-meter:' || NEW.machine_id, 0)
  );

  SELECT m.meter_value INTO v_current
    FROM public.machines m
   WHERE m.company_id = NEW.company_id AND m.id = NEW.machine_id;

  IF v_current IS NOT NULL
     AND NEW.reading_value < v_current
     AND nullif(current_setting('app.meter_amendment', true), '') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'METER_READING_REGRESSION'
      USING ERRCODE = 'P0001',
            DETAIL = format('Očitanje %s je manje od trenutne vrijednosti %s.', NEW.reading_value, v_current);
  END IF;

  UPDATE public.machines
     SET meter_value = NEW.reading_value,
         meter_updated_at = clock_timestamp()
   WHERE company_id = NEW.company_id AND id = NEW.machine_id;

  RETURN NEW;
END;
$meter_guard$;

CREATE TRIGGER machine_meter_readings_guard
  BEFORE INSERT ON public.machine_meter_readings
  FOR EACH ROW EXECUTE FUNCTION public.guard_machine_meter_reading_insert();

-- ---------------------------------------------------------------- machine_work_log_revisions
CREATE TABLE public.machine_work_log_revisions (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  work_log_id    TEXT NOT NULL,
  base_version   INTEGER NOT NULL CHECK (base_version > 0),
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  author_id      TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT machine_work_log_revisions_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_work_log_revisions_work_log_fk
    FOREIGN KEY (company_id, work_log_id)
    REFERENCES public.machine_work_logs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_work_log_revisions_author_fk
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_work_log_revisions_log_idx
  ON public.machine_work_log_revisions (company_id, work_log_id, created_at DESC);

-- ---------------------------------------------------------------- RLS
ALTER TABLE public.machine_work_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_work_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY machine_work_logs_tenant_isolation ON public.machine_work_logs
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.machine_meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_meter_readings FORCE ROW LEVEL SECURITY;
CREATE POLICY machine_meter_readings_tenant_isolation ON public.machine_meter_readings
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.machine_work_log_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_work_log_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY machine_work_log_revisions_tenant_isolation ON public.machine_work_log_revisions
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_work_logs TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.machine_meter_readings TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.machine_work_log_revisions TO gradix_app;

INSERT INTO public.schema_migrations (name)
VALUES ('20261119140000_r5_1_machine_work_logs')
ON CONFLICT DO NOTHING;
COMMIT;