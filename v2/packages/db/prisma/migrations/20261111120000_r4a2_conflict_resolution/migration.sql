-- R4a-2 korak 2b: razrješenje sukoba (odobren dizajn, 2026-11-07).
--
-- - sync_conflicts dobija vrstu razrješenja, INTERNU napomenu ureda (odvojenu od
--   razloga koji vidi radnik/šef), oznaku „razriješila strana u sukobu" (OWNER
--   izuzetak) i idempotencijski ključ razrješenja. Razlog se pooštrava na
--   najmanje 10 znakova i na nivou baze, ne samo u servisu.
-- - work_entries dobija stanje odbačenosti i oznaku ispravke ureda: odbačen
--   unos se NE briše, samo mu se stanje mijenja; odbačeni segmenti više ne
--   učestvuju u provjeri preklapanja ni u jedinstvenom otvorenom segmentu.
-- - companies dobija prag podsjetnika za nerazriješene sukobe (bez pozadinskog
--   posla; upit računa u hodu).
-- Postojeće tabele već imaju FORCE RLS i tenant politike; nove tabele se ne uvode.
BEGIN;

ALTER TABLE public.companies
  ADD COLUMN conflict_reminder_days SMALLINT NOT NULL DEFAULT 3,
  ADD CONSTRAINT companies_conflict_reminder_days_check
    CHECK (conflict_reminder_days BETWEEN 1 AND 365);

ALTER TABLE public.sync_conflicts
  ADD COLUMN resolution_kind TEXT,
  ADD COLUMN internal_note TEXT,
  ADD COLUMN resolved_by_party BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN resolution_key TEXT;

ALTER TABLE public.sync_conflicts
  ADD CONSTRAINT sync_conflicts_resolution_kind_check CHECK (
    (status = 'OPEN' AND resolution_kind IS NULL AND internal_note IS NULL
      AND resolution_key IS NULL AND resolved_by_party = false)
    OR
    (status = 'RESOLVED' AND resolution_kind IN
      ('ACCEPT_SERVER', 'ACCEPT_RECEIVED', 'CORRECTED_TIMES', 'REJECTED'))
  ),
  ADD CONSTRAINT sync_conflicts_internal_note_check CHECK (
    internal_note IS NULL OR length(internal_note) BETWEEN 1 AND 2000
  ),
  ADD CONSTRAINT sync_conflicts_resolution_key_unique UNIQUE (company_id, resolution_key);

-- Razlog vidljiv radniku/šefu: najmanje 10 znakova i u bazi (zamjenjuje 1..500
-- provjeru iz izvorne migracije; stara migracija se ne dira).
ALTER TABLE public.sync_conflicts
  DROP CONSTRAINT sync_conflicts_resolution_check,
  ADD CONSTRAINT sync_conflicts_resolution_check CHECK (
    (status = 'OPEN'
      AND received_payload IS NOT NULL
      AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL
      AND resolution_payload IS NULL AND payload_purge_after IS NULL AND payload_purged_at IS NULL)
    OR
    (status = 'RESOLVED'
      AND resolved_by IS NOT NULL
      AND resolved_at IS NOT NULL
      AND length(btrim(COALESCE(resolution_reason, ''))) BETWEEN 10 AND 500
      AND payload_purge_after IS NOT NULL
      AND (
        (received_payload IS NOT NULL AND payload_purged_at IS NULL)
        OR (received_payload IS NULL AND payload_purged_at IS NOT NULL
            AND payload_purged_at >= payload_purge_after)
      ))
  );

ALTER TABLE public.work_entries
  ADD COLUMN resolution_state TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN rejected_at TIMESTAMPTZ,
  ADD COLUMN rejected_by TEXT,
  ADD COLUMN rejection_reason TEXT,
  ADD COLUMN office_corrected BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT work_entries_resolution_state_check CHECK (
    (resolution_state = 'ACTIVE' AND rejected_at IS NULL AND rejected_by IS NULL AND rejection_reason IS NULL)
    OR
    (resolution_state = 'REJECTED' AND rejected_at IS NOT NULL AND rejected_by IS NOT NULL
      AND length(btrim(COALESCE(rejection_reason, ''))) BETWEEN 10 AND 500)
  ),
  ADD CONSTRAINT work_entries_rejected_by_fk
    FOREIGN KEY (rejected_by) REFERENCES public.users(id) ON DELETE RESTRICT;

-- Odbačeni segment ne zauzima interval: jedinstveni otvoreni segment važi samo za aktivne.
DROP INDEX public.work_entries_one_open_per_worker;
CREATE UNIQUE INDEX work_entries_one_open_per_worker
  ON public.work_entries (company_id, worker_id)
  WHERE end_state = 'OPEN' AND resolution_state = 'ACTIVE';

-- Provjera preklapanja preskače odbačene segmente (i kad je novi red odbačen).
CREATE OR REPLACE FUNCTION public.guard_work_entry_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $work_entry_overlap$
DECLARE
  v_conflict_id TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.company_id || ':assignment-worker:' || NEW.worker_id, 0)
  );
  IF NEW.machine_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.company_id || ':assignment-machine:' || NEW.machine_id, 0)
    );
  END IF;

  IF NEW.end_state = 'UNKNOWN_END' THEN
    RETURN NEW;
  END IF;
  IF NEW.resolution_state = 'REJECTED' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.company_id || ':' || NEW.worker_id, 0)
  );

  SELECT entry.id INTO v_conflict_id
    FROM public.work_entries entry
   WHERE entry.company_id = NEW.company_id
     AND entry.worker_id = NEW.worker_id
     AND entry.id <> NEW.id
     AND entry.resolution_state = 'ACTIVE'
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

-- Guard sukoba: nova polja su dio nepromjenjivog identiteta razrješenja.
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
       OR NEW.resolution_kind IS NOT NULL OR NEW.internal_note IS NOT NULL
       OR NEW.resolution_key IS NOT NULL OR NEW.resolved_by_party = true
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
       OR length(btrim(COALESCE(NEW.resolution_reason, ''))) NOT BETWEEN 10 AND 500
       OR NEW.resolution_kind IS NULL
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
       AND NEW.resolution_kind IS NOT DISTINCT FROM OLD.resolution_kind
       AND NEW.internal_note IS NOT DISTINCT FROM OLD.internal_note
       AND NEW.resolution_key IS NOT DISTINCT FROM OLD.resolution_key
       AND NEW.resolved_by_party IS NOT DISTINCT FROM OLD.resolved_by_party
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
       AND NEW.resolution_kind IS NOT DISTINCT FROM OLD.resolution_kind
       AND NEW.internal_note IS NOT DISTINCT FROM OLD.internal_note
       AND NEW.resolution_key IS NOT DISTINCT FROM OLD.resolution_key
       AND NEW.resolved_by_party IS NOT DISTINCT FROM OLD.resolved_by_party
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

INSERT INTO public.schema_migrations (name)
VALUES ('20261111120000_r4a2_conflict_resolution')
ON CONFLICT DO NOTHING;
COMMIT;
