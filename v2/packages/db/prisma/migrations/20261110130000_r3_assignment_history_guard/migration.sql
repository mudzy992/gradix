-- R3 historija dodjela: očuvaj svaki postojeći red, zabrani hard-delete i retroaktivno
-- skraćivanje. Samo schema changes; nema UPDATE/backfill nad postojećim dodjelama.
BEGIN;

ALTER TABLE public.project_assignments
  ADD COLUMN voided_at TIMESTAMPTZ,
  ADD COLUMN voided_by TEXT,
  ADD COLUMN void_reason TEXT;

ALTER TABLE public.project_assignments
  ADD CONSTRAINT project_assignments_void_fields_check CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR
    (voided_at IS NOT NULL
      AND length(btrim(COALESCE(voided_by, ''))) BETWEEN 1 AND 255
      AND length(btrim(COALESCE(void_reason, ''))) BETWEEN 10 AND 500)
  );

-- Fizički nestanak projekta/radnika/mašine/firme ne smije povući dokaz dodjele.
ALTER TABLE public.project_assignments
  DROP CONSTRAINT IF EXISTS project_assignments_company_id_fkey,
  DROP CONSTRAINT IF EXISTS project_assignments_project_fk,
  DROP CONSTRAINT IF EXISTS project_assignments_worker_fk,
  DROP CONSTRAINT IF EXISTS project_assignments_machine_fk;

ALTER TABLE public.project_assignments
  ADD CONSTRAINT project_assignments_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD CONSTRAINT project_assignments_project_fk
    FOREIGN KEY (company_id, project_id)
    REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT project_assignments_worker_fk
    FOREIGN KEY (company_id, worker_id)
    REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT project_assignments_machine_fk
    FOREIGN KEY (company_id, machine_id)
    REFERENCES public.machines(company_id, id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.guard_project_assignment_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $guard$
DECLARE
  v_today DATE;
  v_has_workday BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PROJECT_ASSIGNMENT_DELETE_FORBIDDEN'
      USING ERRCODE = 'P0001',
            DETAIL = 'Dodjela je historijski dokaz; završite je ili je poništite uz razlog.';
  END IF;

  SELECT (clock_timestamp() AT TIME ZONE c.timezone)::date
    INTO v_today
    FROM public.companies c
   WHERE c.id = NEW.company_id;

  IF NOT FOUND OR v_today IS NULL THEN
    RAISE EXCEPTION 'PROJECT_ASSIGNMENT_COMPANY_TIMEZONE_MISSING'
      USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.voided_at IS NOT NULL OR NEW.voided_by IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
      RAISE EXCEPTION 'PROJECT_ASSIGNMENT_VOID_ONLY_AFTER_CREATE'
        USING ERRCODE = 'P0001',
              DETAIL = 'Nova dodjela ne može biti unaprijed poništena; prvo se upisuje, pa se po potrebi poništava.';
    END IF;
    IF NEW.to_date IS NOT NULL AND NEW.to_date < v_today THEN
      RAISE EXCEPTION 'PROJECT_ASSIGNMENT_END_MUST_BE_TODAY_OR_FUTURE'
        USING ERRCODE = '23514',
              DETAIL = 'Kraj dodjele se ne može upisati retroaktivno.';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.id, NEW.company_id, NEW.project_id, NEW.worker_id, NEW.machine_id,
         NEW.from_date, NEW.note, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.company_id, OLD.project_id, OLD.worker_id, OLD.machine_id,
         OLD.from_date, OLD.note, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'PROJECT_ASSIGNMENT_IDENTITY_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'Identitet, cilj, projekat, početak i početni zapis dodjele su nepromjenjivi.';
  END IF;

  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'PROJECT_ASSIGNMENT_VOID_IS_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'Poništena dodjela i njen razlog se ne mogu mijenjati niti vratiti.';
  END IF;

  IF NEW.voided_at IS NOT NULL THEN
    -- Ista worker-key se zaključava pri workday INSERT-u; ista machine-key pri work_entry
    -- INSERT/UPDATE-u. Tako VOID i novi work dokaz imaju serijski, jasan redoslijed pod trkom.
    IF NEW.worker_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.company_id || ':assignment-worker:' || NEW.worker_id, 0)
      );
    ELSIF NEW.machine_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.company_id || ':assignment-machine:' || NEW.machine_id, 0)
      );
    END IF;

    IF NEW.to_date IS DISTINCT FROM OLD.to_date THEN
      RAISE EXCEPTION 'PROJECT_ASSIGNMENT_VOID_CANNOT_CHANGE_PERIOD'
        USING ERRCODE = 'P0001';
    END IF;
    IF length(btrim(COALESCE(NEW.voided_by, ''))) = 0
       OR length(btrim(COALESCE(NEW.void_reason, ''))) NOT BETWEEN 10 AND 500 THEN
      RAISE EXCEPTION 'PROJECT_ASSIGNMENT_VOID_REASON_REQUIRED'
        USING ERRCODE = '23514',
              DETAIL = 'Poništavanje traži autora i razlog od 10 do 500 znakova.';
    END IF;

    -- R3 migracija može biti primijenjena prije R4 tabela. Kad postoje, DB provjerava stvarni
    -- rad po radniku/datumu ili korištenje mašine; nema tihog poništavanja historijskog dana.
    IF NEW.worker_id IS NOT NULL AND to_regclass('public.workdays') IS NOT NULL THEN
      EXECUTE $sql$
        SELECT EXISTS (
          SELECT 1
            FROM public.workdays d
           WHERE d.company_id = $1
             AND d.worker_id = $2
             AND d.work_date >= $3
             AND ($4 IS NULL OR d.work_date <= $4)
        )
      $sql$
      INTO v_has_workday
      USING NEW.company_id, NEW.worker_id, NEW.from_date, NEW.to_date;
      IF v_has_workday THEN
        RAISE EXCEPTION 'PROJECT_ASSIGNMENT_HAS_WORKDAYS'
          USING ERRCODE = 'P0001',
                DETAIL = 'Dodjela se ne može poništiti jer u njenom periodu postoji radni dan.';
      END IF;
    ELSIF NEW.machine_id IS NOT NULL
       AND to_regclass('public.workdays') IS NOT NULL
       AND to_regclass('public.work_entries') IS NOT NULL THEN
      EXECUTE $sql$
        SELECT EXISTS (
          SELECT 1
            FROM public.work_entries e
            JOIN public.workdays d
              ON d.company_id = e.company_id AND d.id = e.workday_id
           WHERE e.company_id = $1
             AND e.machine_id = $2
             AND d.work_date >= $3
             AND ($4 IS NULL OR d.work_date <= $4)
        )
      $sql$
      INTO v_has_workday
      USING NEW.company_id, NEW.machine_id, NEW.from_date, NEW.to_date;
      IF v_has_workday THEN
        RAISE EXCEPTION 'PROJECT_ASSIGNMENT_HAS_WORKDAYS'
          USING ERRCODE = 'P0001',
                DETAIL = 'Dodjela se ne može poništiti jer je mašina korištena u tom periodu.';
      END IF;
    END IF;

    -- Vrijeme je serversko i nastaje samo jednom. Autor i razlog ostaju trajni.
    NEW.voided_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.voided_by IS DISTINCT FROM OLD.voided_by
     OR NEW.void_reason IS DISTINCT FROM OLD.void_reason THEN
    RAISE EXCEPTION 'PROJECT_ASSIGNMENT_VOID_FIELDS_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.to_date IS DISTINCT FROM OLD.to_date THEN
    IF NEW.to_date IS NOT NULL AND NEW.to_date < v_today THEN
      RAISE EXCEPTION 'PROJECT_ASSIGNMENT_END_MUST_BE_TODAY_OR_FUTURE'
        USING ERRCODE = '23514',
              DETAIL = 'Kraj dodjele se može postaviti samo na današnji ili budući poslovni datum.';
    END IF;
    IF OLD.to_date IS NOT NULL AND NEW.to_date IS NOT NULL AND NEW.to_date < OLD.to_date THEN
      RAISE EXCEPTION 'PROJECT_ASSIGNMENT_END_CANNOT_MOVE_BACKWARDS'
        USING ERRCODE = 'P0001',
              DETAIL = 'Postojeći kraj dodjele se može samo produžiti, nikad skratiti.';
    END IF;
    -- NULL znači da dodjela nema planirani kraj i zato je produženje, ne skraćivanje.
  END IF;

  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS project_assignments_history_guard ON public.project_assignments;
CREATE TRIGGER project_assignments_history_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_assignment_history();

CREATE OR REPLACE FUNCTION public.reject_project_assignments_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $truncate_guard$
BEGIN
  RAISE EXCEPTION 'PROJECT_ASSIGNMENT_TRUNCATE_FORBIDDEN'
    USING ERRCODE = 'P0001',
          DETAIL = 'Historijske dodjele se ne mogu ukloniti ni TRUNCATE-om.';
END;
$truncate_guard$;

DROP TRIGGER IF EXISTS project_assignments_truncate_guard ON public.project_assignments;
CREATE TRIGGER project_assignments_truncate_guard
  BEFORE TRUNCATE ON public.project_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_project_assignments_truncate();

-- Void red više nije aktivna dodjela za provjeru preklapanja; svi postojeći redovi imaju
-- voided_at IS NULL, pa ova zamjena ne mijenja njihovo trenutno stanje. Definicija fallbacka je
-- izvan DO bloka jer CREATE FUNCTION nije naredba koju PL/pgSQL može pouzdano pripremiti statički.
CREATE OR REPLACE FUNCTION public.project_assignment_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $overlap_guard$
DECLARE
  v_conflicts INTEGER;
BEGIN
  IF NEW.voided_at IS NOT NULL
     OR (NEW.worker_id IS NULL AND NEW.machine_id IS NULL) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.company_id || ':' || NEW.project_id || ':' ||
                     COALESCE(NEW.worker_id, NEW.machine_id), 0)
  );

  SELECT count(*) INTO v_conflicts
    FROM public.project_assignments a
   WHERE a.company_id = NEW.company_id
     AND a.project_id = NEW.project_id
     AND a.id <> NEW.id
     AND a.voided_at IS NULL
     AND (
       (NEW.worker_id IS NOT NULL AND a.worker_id = NEW.worker_id) OR
       (NEW.machine_id IS NOT NULL AND a.machine_id = NEW.machine_id)
     )
     AND a.from_date <= COALESCE(NEW.to_date, 'infinity'::date)
     AND NEW.from_date <= COALESCE(a.to_date, 'infinity'::date);

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'ASSIGNMENT_OVERLAP'
      USING ERRCODE = 'P0001',
            DETAIL = 'Isti entitet je već dodijeljen ovom projektu u periodu koji se preklapa.';
  END IF;
  RETURN NEW;
END;
$overlap_guard$;

DO $overlap$
DECLARE
  v_gist BOOLEAN := false;
  v_force_trigger BOOLEAN := current_setting('gradix.bez_btree_gist', true) = 'on';
BEGIN
  IF v_force_trigger THEN
    RAISE NOTICE 'btree_gist preskočen prekidačem (gradix.bez_btree_gist); koristi se advisory-lock trigger.';
    v_gist := false;
  ELSE
  BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') INTO v_gist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'btree_gist nije dostupan (%); koristi se advisory-lock trigger.', SQLERRM;
    v_gist := false;
  END;
  END IF;

  ALTER TABLE public.project_assignments
    DROP CONSTRAINT IF EXISTS project_assignments_worker_no_overlap,
    DROP CONSTRAINT IF EXISTS project_assignments_machine_no_overlap;
  DROP TRIGGER IF EXISTS project_assignments_no_overlap ON public.project_assignments;

  IF v_gist THEN
    DROP FUNCTION IF EXISTS public.project_assignment_no_overlap();
    ALTER TABLE public.project_assignments
      ADD CONSTRAINT project_assignments_worker_no_overlap
      EXCLUDE USING gist (
        project_id WITH =,
        worker_id WITH =,
        daterange(from_date, COALESCE(to_date, 'infinity'::date), '[]') WITH &&
      ) WHERE (worker_id IS NOT NULL AND voided_at IS NULL);

    ALTER TABLE public.project_assignments
      ADD CONSTRAINT project_assignments_machine_no_overlap
      EXCLUDE USING gist (
        project_id WITH =,
        machine_id WITH =,
        daterange(from_date, COALESCE(to_date, 'infinity'::date), '[]') WITH &&
      ) WHERE (machine_id IS NOT NULL AND voided_at IS NULL);
  ELSE
    CREATE TRIGGER project_assignments_no_overlap
      BEFORE INSERT OR UPDATE ON public.project_assignments
      FOR EACH ROW EXECUTE FUNCTION public.project_assignment_no_overlap();
  END IF;
END;
$overlap$;

INSERT INTO public.schema_migrations(name)
VALUES ('20261110130000_r3_assignment_history_guard')
ON CONFLICT DO NOTHING;

COMMIT;
