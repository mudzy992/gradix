-- R4 korak 3: kanonski radni dani, segmenti, receipts i konfliktni payload.
-- Sve nove poslovne tabele su tenant-scope-ovane i FORCE RLS; aplikacija nema DELETE grant.
BEGIN;

ALTER TABLE public.companies
  ADD COLUMN sync_conflict_retention_days SMALLINT NOT NULL DEFAULT 90,
  ADD CONSTRAINT companies_sync_conflict_retention_check
    CHECK (sync_conflict_retention_days BETWEEN 1 AND 3650);

CREATE TABLE public.workdays (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  work_date      DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED')),
  header_version INTEGER NOT NULL DEFAULT 1 CHECK (header_version > 0),
  created_by     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workdays_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT workdays_company_id_worker_unique UNIQUE (company_id, id, worker_id),
  CONSTRAINT workdays_one_canonical_day UNIQUE (company_id, worker_id, work_date),
  CONSTRAINT workdays_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT workdays_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT workdays_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT workdays_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);
CREATE INDEX workdays_company_date_idx
  ON public.workdays (company_id, work_date, id);
CREATE INDEX workdays_company_worker_date_idx
  ON public.workdays (company_id, worker_id, work_date DESC);

CREATE OR REPLACE FUNCTION public.guard_workday_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $workday_guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Serijalizuje kanonski workday insert sa VOID provjerom R3 dodjele za istog radnika.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.company_id || ':assignment-worker:' || NEW.worker_id, 0)
    );
    RETURN NEW;
  END IF;

  IF ROW(NEW.id, NEW.company_id, NEW.worker_id, NEW.work_date, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.company_id, OLD.worker_id, OLD.work_date, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'WORKDAY_IDENTITY_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'ID, firma, radnik, poslovni datum i početni autor radnog dana su nepromjenjivi.';
  END IF;
  RETURN NEW;
END;
$workday_guard$;

CREATE TRIGGER workdays_identity_guard
  BEFORE INSERT OR UPDATE ON public.workdays
  FOR EACH ROW EXECUTE FUNCTION public.guard_workday_identity();

CREATE TABLE public.work_entries (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  workday_id     TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('WORK', 'BREAK')),
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,
  end_state      TEXT NOT NULL CHECK (end_state IN ('OPEN', 'KNOWN_END', 'UNKNOWN_END')),
  project_id     TEXT,
  machine_id     TEXT,
  note           TEXT CHECK (note IS NULL OR length(note) <= 2000),
  version        INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_entries_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT work_entries_workday_worker_fk
    FOREIGN KEY (company_id, workday_id, worker_id)
    REFERENCES public.workdays(company_id, id, worker_id) ON DELETE RESTRICT,
  CONSTRAINT work_entries_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_entries_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_entries_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT work_entries_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT work_entries_kind_target_check CHECK (
    (kind = 'WORK' AND project_id IS NOT NULL)
    OR (kind = 'BREAK' AND project_id IS NULL AND machine_id IS NULL)
  ),
  CONSTRAINT work_entries_end_state_check CHECK (
    (end_state IN ('OPEN', 'UNKNOWN_END') AND ended_at IS NULL)
    OR (end_state = 'KNOWN_END' AND ended_at IS NOT NULL AND ended_at > started_at)
  )
);
CREATE INDEX work_entries_company_workday_idx
  ON public.work_entries (company_id, workday_id, started_at, id);
CREATE INDEX work_entries_company_worker_started_idx
  ON public.work_entries (company_id, worker_id, started_at);
CREATE INDEX work_entries_company_project_started_idx
  ON public.work_entries (company_id, project_id, started_at)
  WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX work_entries_one_open_per_worker
  ON public.work_entries (company_id, worker_id)
  WHERE end_state = 'OPEN';

CREATE OR REPLACE FUNCTION public.guard_work_entry_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $work_entry_overlap$
DECLARE
  v_conflict_id TEXT;
BEGIN
  -- Serijalizuje dodavanje stvarne upotrebe mašine sa R3 VOID provjerom; za worker-VOID
  -- workday zaglavlje već drži istu worker-key bravu. UNKNOWN_END ipak predstavlja upotrebu.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.company_id || ':assignment-worker:' || NEW.worker_id, 0)
  );
  IF NEW.machine_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.company_id || ':assignment-machine:' || NEW.machine_id, 0)
    );
  END IF;

  -- UNKNOWN_END sačuva poznati početak, ali nema poznato trajanje i ne zauzima interval.
  IF NEW.end_state = 'UNKNOWN_END' THEN
    RETURN NEW;
  END IF;

  -- Zaključavanje po radniku, ne po projektu: jedan radnik ne može imati istovremene segmente
  -- preko različitih projekata. OPEN tretira NULL kraj kao beskonačnost; susjedni intervali [)
  -- su dozvoljeni jer se striktno porede granice.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.company_id || ':' || NEW.worker_id, 0)
  );

  SELECT entry.id INTO v_conflict_id
    FROM public.work_entries entry
   WHERE entry.company_id = NEW.company_id
     AND entry.worker_id = NEW.worker_id
     AND entry.id <> NEW.id
     AND entry.end_state IN ('OPEN', 'KNOWN_END')
     AND entry.started_at < COALESCE(NEW.ended_at, 'infinity'::timestamptz)
     AND NEW.started_at < COALESCE(entry.ended_at, 'infinity'::timestamptz)
   LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'WORK_ENTRY_OVERLAP'
      USING ERRCODE = '23P01',
            DETAIL = 'Radnik već ima OPEN ili KNOWN_END segment koji se vremenski preklapa.';
  END IF;

  RETURN NEW;
END;
$work_entry_overlap$;

CREATE TRIGGER work_entries_no_overlap
  BEFORE INSERT OR UPDATE ON public.work_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_work_entry_overlap();

CREATE TABLE public.sync_receipts (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,
  actor_id            TEXT NOT NULL,
  local_id            TEXT NOT NULL CHECK (length(btrim(local_id)) BETWEEN 1 AND 128),
  request_hash        TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result              JSONB,
  result_expires_at   TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + interval '90 days'),
  result_purged_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sync_receipts_company_actor_local_unique UNIQUE (company_id, actor_id, local_id),
  CONSTRAINT sync_receipts_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT sync_receipts_actor_fk
    FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT sync_receipts_purge_state_check CHECK (
    (result IS NOT NULL AND result_purged_at IS NULL)
    OR (result IS NULL AND result_purged_at IS NOT NULL AND result_purged_at >= result_expires_at)
  )
);
CREATE INDEX sync_receipts_expiry_idx
  ON public.sync_receipts (company_id, result_expires_at, id);

CREATE OR REPLACE FUNCTION public.guard_sync_receipt_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $receipt_guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.result IS NULL OR NEW.result_purged_at IS NOT NULL THEN
      RAISE EXCEPTION 'SYNC_RECEIPT_MUST_START_WITH_DETAILS'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.id, NEW.company_id, NEW.actor_id, NEW.local_id, NEW.request_hash,
         NEW.result_expires_at, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.company_id, OLD.actor_id, OLD.local_id, OLD.request_hash,
         OLD.result_expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'SYNC_RECEIPT_IDENTITY_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.result IS NOT DISTINCT FROM OLD.result
     AND NEW.result_purged_at IS NOT DISTINCT FROM OLD.result_purged_at THEN
    RETURN NEW;
  END IF;
  IF OLD.result IS NOT NULL
     AND NEW.result IS NULL
     AND OLD.result_expires_at <= clock_timestamp()
     AND NEW.result_purged_at IS NULL THEN
    NEW.result_purged_at := clock_timestamp();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'SYNC_RECEIPT_DETAILS_IMMUTABLE'
    USING ERRCODE = 'P0001',
          DETAIL = 'Receipt detalji se mogu ukloniti tek nakon result_expires_at; compact idempotency ključ ostaje.';
END;
$receipt_guard$;

CREATE TRIGGER sync_receipts_history_guard
  BEFORE INSERT OR UPDATE ON public.sync_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_sync_receipt_update();

CREATE TABLE public.sync_conflicts (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT NOT NULL,
  actor_id              TEXT NOT NULL,
  local_id              TEXT NOT NULL CHECK (length(btrim(local_id)) BETWEEN 1 AND 128),
  work_entry_id         TEXT,
  received_payload      JSONB,
  payload_hash          TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  server_version        INTEGER CHECK (server_version IS NULL OR server_version > 0),
  status                TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolved_by           TEXT,
  resolved_at           TIMESTAMPTZ,
  resolution_reason     TEXT,
  resolution_payload    JSONB,
  payload_purge_after   TIMESTAMPTZ,
  payload_purged_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sync_conflicts_company_actor_local_unique UNIQUE (company_id, actor_id, local_id),
  CONSTRAINT sync_conflicts_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT sync_conflicts_actor_fk
    FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT sync_conflicts_resolved_by_fk
    FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT sync_conflicts_work_entry_fk
    FOREIGN KEY (company_id, work_entry_id)
    REFERENCES public.work_entries(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sync_conflicts_resolution_check CHECK (
    (status = 'OPEN'
      AND received_payload IS NOT NULL
      AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL
      AND resolution_payload IS NULL AND payload_purge_after IS NULL AND payload_purged_at IS NULL)
    OR
    (status = 'RESOLVED'
      AND resolved_by IS NOT NULL
      AND resolved_at IS NOT NULL
      AND length(btrim(COALESCE(resolution_reason, ''))) BETWEEN 1 AND 500
      AND payload_purge_after IS NOT NULL
      AND (
        (received_payload IS NOT NULL AND payload_purged_at IS NULL)
        OR (received_payload IS NULL AND payload_purged_at IS NOT NULL
            AND payload_purged_at >= payload_purge_after)
      ))
  )
);
CREATE INDEX sync_conflicts_open_idx
  ON public.sync_conflicts (company_id, created_at, id)
  WHERE status = 'OPEN';
CREATE INDEX sync_conflicts_work_entry_idx
  ON public.sync_conflicts (company_id, work_entry_id, created_at DESC)
  WHERE work_entry_id IS NOT NULL;
CREATE INDEX sync_conflicts_payload_purge_idx
  ON public.sync_conflicts (company_id, payload_purge_after, id)
  WHERE status = 'RESOLVED' AND received_payload IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_sync_conflict_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $conflict_guard$
DECLARE
  v_retention_days SMALLINT;
  v_now TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN'
       OR NEW.received_payload IS NULL
       OR NEW.resolved_by IS NOT NULL OR NEW.resolved_at IS NOT NULL
       OR NEW.resolution_reason IS NOT NULL OR NEW.resolution_payload IS NOT NULL
       OR NEW.payload_purge_after IS NOT NULL OR NEW.payload_purged_at IS NOT NULL THEN
      RAISE EXCEPTION 'SYNC_CONFLICT_MUST_START_OPEN'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.id, NEW.company_id, NEW.actor_id, NEW.local_id, NEW.work_entry_id,
         NEW.payload_hash, NEW.server_version, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.company_id, OLD.actor_id, OLD.local_id, OLD.work_entry_id,
         OLD.payload_hash, OLD.server_version, OLD.created_at) THEN
    RAISE EXCEPTION 'SYNC_CONFLICT_IDENTITY_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'OPEN' AND NEW.status = 'RESOLVED' THEN
    IF NEW.received_payload IS DISTINCT FROM OLD.received_payload
       OR NEW.resolved_by IS NULL
       OR length(btrim(COALESCE(NEW.resolution_reason, ''))) NOT BETWEEN 1 AND 500
       OR NEW.resolved_at IS NOT NULL
       OR NEW.payload_purge_after IS NOT NULL
       OR NEW.payload_purged_at IS NOT NULL THEN
      RAISE EXCEPTION 'SYNC_CONFLICT_RESOLUTION_INVALID'
        USING ERRCODE = '23514';
    END IF;

    SELECT sync_conflict_retention_days INTO v_retention_days
      FROM public.companies
     WHERE id = NEW.company_id;
    IF NOT FOUND OR v_retention_days IS NULL THEN
      RAISE EXCEPTION 'SYNC_CONFLICT_RETENTION_SETTING_MISSING'
        USING ERRCODE = '23503';
    END IF;
    v_now := clock_timestamp();
    NEW.resolved_at := v_now;
    NEW.payload_purge_after := v_now + make_interval(days => v_retention_days::integer);
    RETURN NEW;
  END IF;

  IF OLD.status = 'RESOLVED' AND NEW.status = 'RESOLVED' THEN
    IF NEW.resolved_by IS NOT DISTINCT FROM OLD.resolved_by
       AND NEW.resolved_at IS NOT DISTINCT FROM OLD.resolved_at
       AND NEW.resolution_reason IS NOT DISTINCT FROM OLD.resolution_reason
       AND NEW.resolution_payload IS NOT DISTINCT FROM OLD.resolution_payload
       AND NEW.payload_purge_after IS NOT DISTINCT FROM OLD.payload_purge_after
       AND NEW.received_payload IS NOT DISTINCT FROM OLD.received_payload
       AND NEW.payload_purged_at IS NOT DISTINCT FROM OLD.payload_purged_at THEN
      RETURN NEW;
    END IF;

    IF OLD.received_payload IS NOT NULL
       AND NEW.received_payload IS NULL
       AND NEW.resolved_by IS NOT DISTINCT FROM OLD.resolved_by
       AND NEW.resolved_at IS NOT DISTINCT FROM OLD.resolved_at
       AND NEW.resolution_reason IS NOT DISTINCT FROM OLD.resolution_reason
       AND NEW.payload_purge_after IS NOT DISTINCT FROM OLD.payload_purge_after
       AND NEW.payload_purged_at IS NULL
       AND OLD.payload_purge_after <= clock_timestamp() THEN
      NEW.payload_purged_at := clock_timestamp();
      NEW.resolution_payload := NULL;
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'SYNC_CONFLICT_RESOLUTION_IMMUTABLE'
    USING ERRCODE = 'P0001',
          DETAIL = 'Sukob se razrješava jednom; payload se čuva do podešenog roka, pa se brišu samo detalji.';
END;
$conflict_guard$;

CREATE TRIGGER sync_conflicts_history_guard
  BEFORE INSERT OR UPDATE ON public.sync_conflicts
  FOR EACH ROW EXECUTE FUNCTION public.guard_sync_conflict_update();

ALTER TABLE public.workdays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workdays FORCE ROW LEVEL SECURITY;
CREATE POLICY workdays_tenant_isolation ON public.workdays
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.work_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY work_entries_tenant_isolation ON public.work_entries
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.sync_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_receipts_tenant_isolation ON public.sync_receipts
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_conflicts FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_conflicts_tenant_isolation ON public.sync_conflicts
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

INSERT INTO public.schema_migrations (name)
VALUES ('20261110150000_r4_workday_core')
ON CONFLICT DO NOTHING;
COMMIT;
