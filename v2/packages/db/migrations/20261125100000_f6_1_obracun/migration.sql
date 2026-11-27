-- =============================================================================
-- FAZA 6 (Modul 7) — obračun sati i troška rada.
--
-- Model: MJESEC je jedinica obračuna (`pay_periods`), a ne „izvoz segmenata po datumu“.
-- Sat nikad nije plaćen dvaput: klasifikacija (`PRAZNIK > NEDJELJA > NOĆNI > PREKOVREMENI >
-- REDOVNI`) je u domeni, a baza čuva REZULTAT sa raspisom (`payroll_line_sources`) — tako se
-- svaki cent može objasniti do dana i parametra koji ga je proizveo.
--
-- Nijedan zakonski procenat nije u kodu ni u ovoj migraciji. `payroll_parameters` nosi vrijednost
-- SA DATUMOM VAŽENJA; nedostatak parametra nije nula nego `PARAMETER_MISSING` na liniji.
-- Jedini izuzetak je `OVERTIME_MULTIPLIER = 1.0`, koji je neutralni množilac (sat ostaje sat) —
-- to nije propis, nego odsustvo uvećanja, pa smije biti zadan.
--
-- Zaključan period se NE prepisuje: izmjena dana u `LOCKED` periodu otvara `pay_corrections` red
-- koji se primjenjuje u narednom obračunu. Stari obračun ostaje čitljiv dokaz.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. Osnov prekovremenog

/* Prekovremeni ima JEDAN osnov: dnevni prag ILI sedmični prag — nikad oba (§1.2/8).
   Kolone su odvojene da baza može to i da provjeri; servis dodatno odbija `WEEKLY` bez praga. */
ALTER TABLE public.companies
  ADD COLUMN overtime_basis TEXT NOT NULL DEFAULT 'DAILY',
  ADD COLUMN overtime_weekly_threshold NUMERIC(4, 2);

ALTER TABLE public.companies
  ADD CONSTRAINT companies_overtime_basis_check
    CHECK (overtime_basis IN ('DAILY', 'WEEKLY')),
  ADD CONSTRAINT companies_overtime_weekly_threshold_check
    CHECK (overtime_weekly_threshold IS NULL OR overtime_weekly_threshold BETWEEN 0 AND 168),
  /*
   * `WEEKLY` osnov BEZ praga bio bi tiha nula: svaki sat preko 0 h je prekovremeni, ili —
   * ako upit vrati NULL — nijedan sat nije. Oba ishoda su laž, pa kombinacija ne postoji.
   */
  ADD CONSTRAINT companies_overtime_basis_threshold_check
    CHECK (overtime_basis <> 'WEEKLY' OR overtime_weekly_threshold IS NOT NULL);

-- ---------------------------------------------------------------- 2. Period obračuna

CREATE TABLE public.pay_periods (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  year          SMALLINT NOT NULL,
  month         SMALLINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN',
  calculated_at TIMESTAMPTZ,
  calculated_by TEXT,
  approved_at   TIMESTAMPTZ,
  approved_by   TEXT,
  locked_at     TIMESTAMPTZ,
  locked_by     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pay_periods_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT pay_periods_company_period_unique UNIQUE (company_id, year, month),
  CONSTRAINT pay_periods_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT pay_periods_year_check CHECK (year BETWEEN 2000 AND 2100),
  CONSTRAINT pay_periods_month_check CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT pay_periods_status_check
    CHECK (status IN ('OPEN', 'CALCULATED', 'APPROVED', 'LOCKED')),
  /*
   * Svaki status nosi SVOJ trag: `CALCULATED` bez `calculated_at` ne bi rekao kad je obračun
   * nastao, a `APPROVED` bez `approved_by` ne bi rekao KO ga je pustio — a to je jedina osoba
   * koja odgovara za iznos (§1.8/27). Zato su vremena i autori vezani za stanje, ne opcionalni.
   */
  CONSTRAINT pay_periods_calculated_shape_check
    CHECK (
      (status = 'OPEN' AND calculated_at IS NULL AND calculated_by IS NULL)
      OR (status <> 'OPEN' AND calculated_at IS NOT NULL AND calculated_by IS NOT NULL)
    ),
  CONSTRAINT pay_periods_approved_shape_check
    CHECK (
      (approved_at IS NULL) = (approved_by IS NULL)
    ),
  CONSTRAINT pay_periods_locked_shape_check
    CHECK (
      (locked_at IS NULL) = (locked_by IS NULL)
    ),
  CONSTRAINT pay_periods_calculated_by_fk
    FOREIGN KEY (calculated_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT pay_periods_approved_by_fk
    FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT pay_periods_locked_by_fk
    FOREIGN KEY (locked_by) REFERENCES public.users(id) ON DELETE RESTRICT
);
CREATE INDEX pay_periods_company_year_idx ON public.pay_periods (company_id, year, month DESC);

-- ---------------------------------------------------------------- 3. Šifarnik komponenti

CREATE TABLE public.payroll_components (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  basis       TEXT NOT NULL,
  category    TEXT NOT NULL,
  is_taxable  BOOLEAN NOT NULL DEFAULT true,
  sort_order  SMALLINT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payroll_components_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_components_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT payroll_components_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_components_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_components_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_components_kind_check CHECK (kind IN ('EARNING', 'DEDUCTION')),
  CONSTRAINT payroll_components_basis_check
    CHECK (basis IN ('HOURS', 'DAYS', 'FIXED', 'PERCENT_OF_EARNINGS')),
  CONSTRAINT payroll_components_category_check CHECK (
    category IN ('REGULAR', 'OVERTIME', 'NIGHT', 'SUNDAY', 'HOLIDAY', 'ABSENCE',
                 'FIELD_ALLOWANCE', 'ADVANCE', 'LOAN', 'OTHER')
  ),
  /* Šifra je strojni ključ: velika slova, bez razmaka — inače bi `REDOVNI` i `redovni ` bili
     dvije komponente sa istim značenjem i zbroj bi se razišao sa popisom. */
  CONSTRAINT payroll_components_code_check
    CHECK (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  CONSTRAINT payroll_components_name_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT payroll_components_sort_check CHECK (sort_order BETWEEN 0 AND 999),
  /*
   * Dedukcija koja se računa iz SATI bila bi „negativna zarada“ i lako bi pretekla zaradu
   * (spec §1.5/21 traži da obračun nikad nije negativan). Zato satna osnovica postoji samo za
   * zarade: odbici su fiksni, po danima ili procenat zarade.
   */
  CONSTRAINT payroll_components_deduction_basis_check
    CHECK (kind <> 'DEDUCTION' OR basis <> 'HOURS'),
  /* Terenski dodatak je ZARADA, akontacija i pozajmica su ODBICI — suprotno bi tiho okrenulo
     predznak u izvozu. */
  CONSTRAINT payroll_components_category_kind_check CHECK (
    (category IN ('ADVANCE', 'LOAN') AND kind = 'DEDUCTION')
    OR (category NOT IN ('ADVANCE', 'LOAN') AND kind = 'EARNING')
  )
);
CREATE INDEX payroll_components_company_active_idx
  ON public.payroll_components (company_id, is_active, sort_order);

-- ---------------------------------------------------------------- 4. Parametri sa datumom važenja

CREATE TABLE public.payroll_parameters (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  code         TEXT NOT NULL,
  value        NUMERIC(12, 4) NOT NULL,
  unit         TEXT NOT NULL,
  valid_from   DATE NOT NULL,
  valid_to     DATE,
  confirmed_by TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  note         TEXT,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payroll_parameters_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_parameters_company_code_from_unique UNIQUE (company_id, code, valid_from),
  CONSTRAINT payroll_parameters_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_parameters_confirmed_by_fk
    FOREIGN KEY (confirmed_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_parameters_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_parameters_unit_check CHECK (unit IN ('MULTIPLIER', 'PERCENT', 'CENTS')),
  CONSTRAINT payroll_parameters_code_check CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  /* Vrijednost nosi predznak samo tamo gdje predznak ima smisla: množilac i procenat su
     nenegativni, novčani iznos takođe (odbici se unose kao pozitivan iznos koji se odbija). */
  CONSTRAINT payroll_parameters_value_check CHECK (value >= 0),
  CONSTRAINT payroll_parameters_period_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT payroll_parameters_note_check
    CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500)
);
CREATE INDEX payroll_parameters_company_code_idx
  ON public.payroll_parameters (company_id, code, valid_from DESC);

/* Dva važenja istog parametra ne smiju se preklopiti — inače obračun ima DVA moguća množioca za
   isti dan i iznos zavisi od redoslijeda u `ORDER BY`. Isti mehanizam i isti fallback kao kod
   satnica (`worker_rates`): `btree_gist` može nedostajati, pa se tada koristi triger sa bravom. */
DO $$
DECLARE
  ima_gist BOOLEAN := false;
BEGIN
  IF current_setting('gradix.bez_btree_gist', true) = 'on' THEN
    RAISE NOTICE 'payroll_parameters: btree_gist preskočen prekidačem, ide triger.';
  ELSE
    BEGIN
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      ima_gist := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'payroll_parameters: btree_gist nije dostupan (%): ide triger sa bravom.', SQLERRM;
      ima_gist := false;
    END;
  END IF;

  IF ima_gist THEN
    ALTER TABLE public.payroll_parameters
      ADD CONSTRAINT payroll_parameters_no_overlap
      EXCLUDE USING gist (
        company_id WITH =,
        code WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
      ) DEFERRABLE INITIALLY IMMEDIATE;
  ELSE
    CREATE OR REPLACE FUNCTION public.payroll_parameter_no_overlap()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
    AS $payroll_parameter_no_overlap$
    DECLARE
      sukobi INTEGER;
    BEGIN
      PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.company_id || ':' || NEW.code, 0)
      );
      SELECT count(*) INTO sukobi
        FROM public.payroll_parameters p
       WHERE p.company_id = NEW.company_id
         AND p.code = NEW.code
         AND p.id <> NEW.id
         AND daterange(p.valid_from, COALESCE(p.valid_to, 'infinity'::date), '[]')
             && daterange(NEW.valid_from, COALESCE(NEW.valid_to, 'infinity'::date), '[]');
      IF sukobi > 0 THEN
        RAISE EXCEPTION 'PARAMETER_OVERLAP'
          USING ERRCODE = '23P01',
                DETAIL = 'Parametar sa tim kodom već važi u tom periodu.';
      END IF;
      RETURN NEW;
    END;
    $payroll_parameter_no_overlap$;

    CREATE TRIGGER payroll_parameters_no_overlap
      BEFORE INSERT OR UPDATE ON public.payroll_parameters
      FOR EACH ROW EXECUTE FUNCTION public.payroll_parameter_no_overlap();
  END IF;
END
$$;

-- ---------------------------------------------------------------- 5. Izračun (revizije)

CREATE TABLE public.payroll_runs (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  period_id   TEXT NOT NULL,
  revision    INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'CALCULATED',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  computed_by TEXT NOT NULL,
  /* Ulazni hash: isti ulaz + isti parametri daju isti `payload`. Bez toga se ne može dokazati
     da dva izvoza za isti period potiču iz istog obračuna. */
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT payroll_runs_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_runs_company_period_revision_unique UNIQUE (company_id, period_id, revision),
  CONSTRAINT payroll_runs_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_period_fk
    FOREIGN KEY (company_id, period_id) REFERENCES public.pay_periods(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_computed_by_fk
    FOREIGN KEY (computed_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_revision_check CHECK (revision > 0),
  CONSTRAINT payroll_runs_status_check CHECK (status IN ('CALCULATED', 'APPROVED'))
);
CREATE INDEX payroll_runs_company_period_idx
  ON public.payroll_runs (company_id, period_id, revision DESC);

CREATE TABLE public.payroll_run_lines (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  run_id         TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  component_code TEXT NOT NULL,
  hours          NUMERIC(8, 3) NOT NULL DEFAULT 0,
  days           NUMERIC(4, 1) NOT NULL DEFAULT 0,
  rate_cents     BIGINT,
  amount_cents   BIGINT,
  currency_code  TEXT,
  calc_note      TEXT,
  source_hash    TEXT,
  status         TEXT NOT NULL DEFAULT 'OK',
  /* Faza 2 (bruto→neto) — kolone postoje da migracija kasnije ne prepisuje obračun; MVP ih
     ostavlja NULL i to je vidljivo, a ne „nula doprinosa“. */
  gross_cents    BIGINT,
  net_cents      BIGINT,
  contributions  JSONB,
  ordinal        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT payroll_run_lines_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_run_lines_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_run_lines_run_fk
    FOREIGN KEY (company_id, run_id) REFERENCES public.payroll_runs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT payroll_run_lines_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT payroll_run_lines_status_check
    CHECK (status IN ('OK', 'RATE_MISSING', 'PARAMETER_MISSING')),
  CONSTRAINT payroll_run_lines_hours_check CHECK (hours >= 0),
  CONSTRAINT payroll_run_lines_days_check CHECK (days >= 0),
  CONSTRAINT payroll_run_lines_rate_check CHECK (rate_cents IS NULL OR rate_cents >= 0),
  /* Iznos je NEGATIVAN samo za odbitke (`ADVANCE`/`LOAN`): u izvozu se sabira kao odbitak, a
     pozitivan broj u koloni „odbici“ bio bi iznos koji UMANJUJE odbitke. */
  CONSTRAINT payroll_run_lines_amount_check CHECK (amount_cents IS NULL OR amount_cents <= 0 OR status = 'OK'),
  CONSTRAINT payroll_run_lines_currency_check
    CHECK (currency_code IS NULL OR char_length(currency_code) = 3),
  /* `OK` linija MORA imati iznos; `RATE_MISSING`/`PARAMETER_MISSING` ga NE SMIJE imati — inače
     bi nedostatak podatka tiho postao nula (§1.3/13). */
  CONSTRAINT payroll_run_lines_status_shape_check CHECK (
    (status = 'OK' AND amount_cents IS NOT NULL AND currency_code IS NOT NULL)
    OR (status <> 'OK' AND amount_cents IS NULL AND currency_code IS NULL)
  ),
  CONSTRAINT payroll_run_lines_component_code_check
    CHECK (component_code ~ '^[A-Z][A-Z0-9_]{1,29}$')
);
CREATE INDEX payroll_run_lines_company_run_idx
  ON public.payroll_run_lines (company_id, run_id, worker_id, ordinal);
CREATE INDEX payroll_run_lines_company_worker_idx
  ON public.payroll_run_lines (company_id, worker_id);
CREATE INDEX payroll_run_lines_missing_idx
  ON public.payroll_run_lines (company_id, run_id)
  WHERE status <> 'OK';

-- ---------------------------------------------------------------- 6. Raspis (izvori linije)

CREATE TABLE public.payroll_line_sources (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  line_id           TEXT NOT NULL,
  source_type       TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  work_date         DATE,
  hours             NUMERIC(8, 3) NOT NULL DEFAULT 0,
  days              NUMERIC(4, 1) NOT NULL DEFAULT 0,
  amount_cents      BIGINT,
  /* Koji je parametar primijenjen — sa VRIJEDNOŠĆU I DATUMOM važenja u trenutku obračuna.
     Bez toga se poslije promjene množioca ne može objasniti stari iznos. */
  applied_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  note              TEXT,
  CONSTRAINT payroll_line_sources_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_line_sources_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT payroll_line_sources_line_fk
    FOREIGN KEY (company_id, line_id) REFERENCES public.payroll_run_lines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT payroll_line_sources_type_check
    CHECK (source_type IN ('WORK_ENTRY', 'WORKDAY', 'ADJUSTMENT', 'ADVANCE', 'CORRECTION')),
  CONSTRAINT payroll_line_sources_hours_check CHECK (hours >= 0),
  CONSTRAINT payroll_line_sources_days_check CHECK (days >= 0)
);
CREATE INDEX payroll_line_sources_company_line_idx
  ON public.payroll_line_sources (company_id, line_id);
CREATE INDEX payroll_line_sources_company_workday_idx
  ON public.payroll_line_sources (company_id, source_type, source_id);

-- ---------------------------------------------------------------- 7. Akontacije i pozajmice

CREATE TABLE public.worker_advances (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL,
  worker_id        TEXT NOT NULL,
  kind             TEXT NOT NULL,
  amount_cents     BIGINT NOT NULL,
  currency_code    TEXT NOT NULL DEFAULT 'BAM',
  issued_on        DATE NOT NULL,
  /* `installment_cents` je rata za `LOAN`; NULL znači „odbija se cijela u mjesecu izdavanja“
     (`ADVANCE`), što je i zadano ponašanje akontacije. */
  installment_cents BIGINT,
  remaining_cents  BIGINT NOT NULL,
  note             TEXT,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT worker_advances_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT worker_advances_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT worker_advances_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT worker_advances_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT worker_advances_kind_check CHECK (kind IN ('ADVANCE', 'LOAN')),
  CONSTRAINT worker_advances_amount_check CHECK (amount_cents > 0),
  CONSTRAINT worker_advances_installment_check
    CHECK (installment_cents IS NULL OR (installment_cents > 0 AND installment_cents <= amount_cents)),
  /* Ostatak nikad nije negativan: više se ne može naplatiti nego što je izdato (§1.5/21). */
  CONSTRAINT worker_advances_remaining_check
    CHECK (remaining_cents >= 0 AND remaining_cents <= amount_cents),
  CONSTRAINT worker_advances_currency_check CHECK (char_length(currency_code) = 3),
  /* Pozajmica BEZ rate nikad se ne bi odbila — bila bi „izdata, a nevidljiva“ u obračunu. */
  CONSTRAINT worker_advances_loan_installment_check
    CHECK (kind <> 'LOAN' OR installment_cents IS NOT NULL),
  CONSTRAINT worker_advances_note_check
    CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500)
);
CREATE INDEX worker_advances_company_worker_idx
  ON public.worker_advances (company_id, worker_id, issued_on DESC);
CREATE INDEX worker_advances_open_idx
  ON public.worker_advances (company_id, worker_id)
  WHERE remaining_cents > 0;

-- ---------------------------------------------------------------- 8. Korekcije poslije LOCKED

CREATE TABLE public.pay_corrections (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,
  period_id           TEXT NOT NULL,
  workday_id         TEXT,
  payroll_line_id    TEXT,
  delta_hours         NUMERIC(8, 3) NOT NULL DEFAULT 0,
  delta_amount_cents  BIGINT,
  reason              TEXT NOT NULL,
  target_period_id    TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'OPEN',
  applied_run_id      TEXT,
  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  applied_at          TIMESTAMPTZ,
  CONSTRAINT pay_corrections_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT pay_corrections_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT pay_corrections_period_fk
    FOREIGN KEY (company_id, period_id) REFERENCES public.pay_periods(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT pay_corrections_target_period_fk
    FOREIGN KEY (company_id, target_period_id) REFERENCES public.pay_periods(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT pay_corrections_workday_fk
    FOREIGN KEY (company_id, workday_id) REFERENCES public.workdays(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT pay_corrections_line_fk
    FOREIGN KEY (company_id, payroll_line_id) REFERENCES public.payroll_run_lines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT pay_corrections_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT pay_corrections_status_check CHECK (status IN ('OPEN', 'APPLIED')),
  CONSTRAINT pay_corrections_reason_check
    CHECK (char_length(btrim(reason)) >= 10),
  /* Korekcija mora pokazati ŠTA se ispravlja: dan ili liniju obračuna. Bez toga bi bila
     „ispravka 12,50 BAM“ bez ijednog zapisa koji je pogriješio. */
  CONSTRAINT pay_corrections_target_check
    CHECK (workday_id IS NOT NULL OR payroll_line_id IS NOT NULL),
  /* Korekcija se primjenjuje u NAREDNOM periodu — nikad u onom koji je zaključan (§1.7/25). */
  CONSTRAINT pay_corrections_forward_check CHECK (target_period_id <> period_id),
  CONSTRAINT pay_corrections_applied_shape_check
    CHECK (
      (status = 'APPLIED' AND applied_run_id IS NOT NULL AND applied_at IS NOT NULL)
      OR (status = 'OPEN' AND applied_run_id IS NULL AND applied_at IS NULL)
    ),
  CONSTRAINT pay_corrections_applied_run_fk
    FOREIGN KEY (company_id, applied_run_id) REFERENCES public.payroll_runs(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX pay_corrections_company_target_idx
  ON public.pay_corrections (company_id, target_period_id, status);
CREATE INDEX pay_corrections_company_period_idx
  ON public.pay_corrections (company_id, period_id, created_at DESC);

-- ---------------------------------------------------------------- 9. Zaštita zapisa obračuna

/* Izračunat obračun je DOKAZ: linije i raspis se ne mijenjaju, ne brišu i ne „prepravljaju“.
   Ispravka je nova revizija (`payroll_runs.revision`) — stara ostaje čitljiva sa istim iznosima.
   Isto pravilo kao kod `cost_entries`: knjiga se ne prepisuje. */
CREATE OR REPLACE FUNCTION public.payroll_freeze_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $payroll_freeze_guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAYROLL_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'Obračun se ne briše; ispravka je nova revizija.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'PAYROLL_IMMUTABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'Izračunata linija obračuna se ne mijenja; ispravka je nova revizija.';
  END IF;
  RETURN NEW;
END;
$payroll_freeze_guard$;

CREATE TRIGGER payroll_run_lines_freeze
  BEFORE UPDATE OR DELETE ON public.payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION public.payroll_freeze_guard();

CREATE TRIGGER payroll_line_sources_freeze
  BEFORE UPDATE OR DELETE ON public.payroll_line_sources
  FOR EACH ROW EXECUTE FUNCTION public.payroll_freeze_guard();

CREATE TRIGGER payroll_runs_freeze
  BEFORE DELETE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.payroll_freeze_guard();

/*
 * Prelazi perioda su strogi: `OPEN → CALCULATED → APPROVED → LOCKED`, bez preskakanja i bez
 * vraćanja. `LOCKED` je posljednje stanje; ponovno otvaranje zaključanog mjeseca ne postoji jer
 * bi značilo da isplaćeni obračun može nestati — a korekcije postoje baš da to ne treba.
 */
CREATE OR REPLACE FUNCTION public.pay_period_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $pay_period_guard$
DECLARE
  v_allowed TEXT[];
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE OLD.status
    WHEN 'OPEN' THEN ARRAY['CALCULATED']
    WHEN 'CALCULATED' THEN ARRAY['APPROVED', 'CALCULATED']
    WHEN 'APPROVED' THEN ARRAY['LOCKED']
    ELSE ARRAY[]::TEXT[]
  END;

  IF NOT (NEW.status = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'PAY_PERIOD_BAD_TRANSITION'
      USING ERRCODE = 'P0001',
            DETAIL = format('Period ne prelazi iz %s u %s.', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$pay_period_guard$;

CREATE TRIGGER pay_periods_transition_guard
  BEFORE UPDATE ON public.pay_periods
  FOR EACH ROW EXECUTE FUNCTION public.pay_period_transition_guard();

/*
 * Posljedica koja se lako izgubi: `pay_corrections` postoji da bi izmjena dana u ZAKLJUČANOM
 * periodu bila vidljiva i naplaćena u narednom mjesecu (§1.7). Izmjena dana u `OPEN`/`CALCULATED`
 * periodu je normalan rad i NE otvara korekciju — tada se obračun samo ponovo izračuna.
 *
 * Otvara se korekcija samo kad je period `LOCKED`, i to sa `target_period_id` = naredni mjesec
 * (ako postoji; ako ne postoji, servis ga pravi prije upisa — baza ga ne izmišlja).
 */
CREATE OR REPLACE FUNCTION public.open_correction_for_locked_day()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $open_correction$
DECLARE
  v_company   TEXT := NEW.company_id;
  v_old_date  DATE := OLD.work_date;
  v_period    public.pay_periods;
  v_target    public.pay_periods;
BEGIN
  IF NEW.work_date IS NOT DISTINCT FROM OLD.work_date
     AND NEW.approval_status IS NOT DISTINCT FROM OLD.approval_status
     AND NEW.day_kind IS NOT DISTINCT FROM OLD.day_kind THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_period
    FROM public.pay_periods p
   WHERE p.company_id = v_company
     AND p.year = EXTRACT(YEAR FROM v_old_date)::int
     AND p.month = EXTRACT(MONTH FROM v_old_date)::int;

  IF v_period.id IS NULL OR v_period.status <> 'LOCKED' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_target
    FROM public.pay_periods p
   WHERE p.company_id = v_company
     AND p.year = CASE WHEN EXTRACT(MONTH FROM v_old_date)::int = 12
                       THEN EXTRACT(YEAR FROM v_old_date)::int + 1
                       ELSE EXTRACT(YEAR FROM v_old_date)::int END
     AND p.month = CASE WHEN EXTRACT(MONTH FROM v_old_date)::int = 12
                        THEN 1
                        ELSE EXTRACT(MONTH FROM v_old_date)::int + 1 END;

  /* Bez narednog perioda nema gdje primijeniti korekciju — ali ni tišine: `NOTICE` je vidljiv u
     logu posla, a servis istu provjeru radi prije upisa i vraća jasnu grešku korisniku. */
  IF v_target.id IS NULL THEN
    RAISE NOTICE 'PAY_CORRECTION_NO_TARGET_PERIOD company=% workday=%', v_company, OLD.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.pay_corrections
    (id, company_id, period_id, workday_id, delta_hours, reason, target_period_id, created_by)
  VALUES (
    'cor_' || replace(gen_random_uuid()::text, '-', ''),
    v_company,
    v_period.id,
    OLD.id,
    0,
    format('Izmjena dana %s u zaključanom periodu %s/%s.',
           v_old_date, v_period.year, v_period.month),
    v_target.id,
    NEW.updated_by
  );

  RETURN NEW;
END;
$open_correction$;

CREATE TRIGGER workdays_open_correction
  AFTER UPDATE ON public.workdays
  FOR EACH ROW EXECUTE FUNCTION public.open_correction_for_locked_day();

-- ---------------------------------------------------------------- 10. RLS + grantovi

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pay_periods', 'payroll_components', 'payroll_parameters', 'payroll_runs',
    'payroll_run_lines', 'payroll_line_sources', 'worker_advances', 'pay_corrections'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (company_id = current_setting(''app.company_id''::text, true)) WITH CHECK (company_id = current_setting(''app.company_id''::text, true))',
      t
    );
  END LOOP;
END
$$;

/* Nijedan DELETE: period, obračun, linija i raspis su trag, ne radna tabela. Korekcija se
   primjenjuje (`APPLIED`), ne briše; akontacija se smanjuje (`remaining_cents`), ne uklanja. */
GRANT SELECT, INSERT, UPDATE ON TABLE public.pay_periods TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payroll_components TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payroll_parameters TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payroll_runs TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.payroll_run_lines TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.payroll_line_sources TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.worker_advances TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pay_corrections TO gradix_app;

-- ---------------------------------------------------------------- 11. Zadani set komponenti

/*
 * Zadani set komponenti NIJE u migraciji i ne pravi se za sve postojeće firme.
 *
 * Zašto: `created_by` je NOT NULL i pokazuje na STVARNOG korisnika. Popunjavanje unaprijed bi
 * svakoj firmi u bazi (uključujući testne i one koje nikad nisu obračunale) napravilo 11 redova
 * koji drže RESTRICT vezu ka `users` i `companies` — pa brisanje korisnika u drugim testovima
 * (i u stvarnom životu, pri čišćenju) pada na FK, iako ta firma nikad nije koristila obračun.
 *
 * Zato set nastaje LENJO, pri prvom pozivu `ensureComponents()` u servisu (isto pravilo kao kod
 * kategorija troška, §F5.2): firma koja obračun nikad ne otvori nema ni jedan red. Jedan izvor
 * istine je `DEFAULT_COMPONENTS` u `payroll-period-service.ts`, a ne dva koja se mogu razići.
 *
 * `OVERTIME_MULTIPLIER = 1.0` (neutralni množilac) iz istog razloga dodaje `ensureComponents()`.
 */

INSERT INTO public.schema_migrations (name)
VALUES ('20261125100000_f6_1_obracun')
ON CONFLICT DO NOTHING;

COMMIT;
