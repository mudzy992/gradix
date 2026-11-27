-- =============================================================================
-- FAZA 5 (Modul 6) — drugi dio: JEDAN ledger troška (`cost_entries`), budžet sa revizijama,
-- predmjer, aneksi, zadaci, pragovi upozorenja i zamrznuti snapshot zatvaranja.
--
-- Ovim se `project_cost_entries` ZAMJENJUJE: redovi se prenose, tabela se briše. Ručno dugme
-- `bookProjectCosts` prestaje postojati — knjiženje je posljedica događaja (promjena statusa
-- izvora), pa nema stanja u kojem je trošak nastao a nije knjižen zato što se niko nije sjetio.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. Zatvoren projekat ima datum

/* Postojeći `FINISHED` redovi nemaju `closed_at`. Bez backfill-a bi novi CHECK oborio migraciju
   na svakoj bazi koja već ima završen projekat — a takva baza je svaka produkcijska. */
UPDATE public.projects
   SET closed_at = COALESCE(updated_at, now())
 WHERE status = 'FINISHED' AND closed_at IS NULL;

-- ---------------------------------------------------------------- 2. Ledger troška

CREATE TABLE public.cost_entries (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  project_id     TEXT NOT NULL,
  phase_id       TEXT,
  category_id    TEXT NOT NULL,
  source_type    TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  /* Mašina je OPCIONA: trošak rada, materijala i podizvođača nema mašinu. NOT NULL bi prisilio
     izmišljeni `machine_id` ili drugu tabelu za isti pojam. */
  machine_id     TEXT,
  /* `occurred_on` = dan događaja (dan rada, dan točenja) — po njemu idu izvještaji.
     `booked_at` = kad je knjiženo — po njemu ide revizija i redoslijed u ledgeru. */
  occurred_on    DATE NOT NULL,
  amount_cents   BIGINT,
  currency_code  TEXT,
  quantity       NUMERIC(14, 3),
  unit           TEXT,
  rate_snapshot  JSONB,
  status         TEXT NOT NULL DEFAULT 'POSTED',
  /* Storno: `reversed_by` je red koji je PONIŠTIO ovaj, `reverses_id` je red koji ovaj PONIŠTAVA.
     Dvije kolone, jer jedno pitanje je „zašto ovaj red više ne važi“ (prvo), a drugo „šta je
     ovaj red došao zamijeniti“ (drugo). Jedna kolona ne odgovara na oba. */
  reversed_by    TEXT,
  reverses_id    TEXT,
  note           TEXT,
  booked_by      TEXT NOT NULL,
  booked_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  version        INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT cost_entries_source_check
    CHECK (source_type IN ('WORKDAY', 'MACHINE_WORK_LOG', 'FUEL_ENTRY', 'HAUL',
                           'SERVICE_ORDER', 'PURCHASE', 'SUBCONTRACTOR', 'MANUAL')),
  CONSTRAINT cost_entries_status_check
    CHECK (status IN ('POSTED', 'PENDING', 'REVERSED')),
  /* `PENDING` je trošak bez cijene; `POSTED` je trošak SA cijenom. Bez ovog uslova bi `PENDING`
     mogao nositi iznos i tada bi „nepoznato“ tiho postalo broj — tačno greška D1 iz Modula 5. */
  CONSTRAINT cost_entries_pending_shape_check
    CHECK (
      (status = 'PENDING' AND amount_cents IS NULL AND currency_code IS NULL)
      OR (status <> 'PENDING' AND amount_cents IS NOT NULL AND currency_code IS NOT NULL)
    ),
  CONSTRAINT cost_entries_amount_check CHECK (amount_cents IS NULL OR amount_cents >= 0),
  CONSTRAINT cost_entries_currency_check
    CHECK (currency_code IS NULL OR char_length(currency_code) = 3),
  CONSTRAINT cost_entries_quantity_check CHECK (quantity IS NULL OR quantity >= 0),
  CONSTRAINT cost_entries_unit_check
    CHECK (unit IS NULL OR char_length(btrim(unit)) BETWEEN 1 AND 16),
  /*
   * Storno mora reći ZAŠTO je red poništen: ili pokazuje na red koji ga zamjenjuje
   * (`reversed_by`), ili nosi razlog u `note`. Treće stanje — `REVERSED` bez ijednog traga —
   * ne postoji, jer bi tada iz ledžera nestao trošak bez objašnjenja.
   *
   * Zašto ne „uvijek `reversed_by`“: čisto poništenje (pogrešan unos, bez zamjenskog iznosa)
   * nema red koji ga zamjenjuje, pa bi se morao izmišljati red sa nultim iznosom — a nula u
   * ledžeru nije poništenje nego trošak od nula maraka.
   */
  CONSTRAINT cost_entries_reversed_check
    CHECK (status <> 'REVERSED' OR reversed_by IS NOT NULL OR note IS NOT NULL),
  CONSTRAINT cost_entries_no_self_reverse_check
    CHECK (reverses_id IS NULL OR reverses_id <> id),
  CONSTRAINT cost_entries_note_check CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 1000),
  CONSTRAINT cost_entries_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT cost_entries_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT cost_entries_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT cost_entries_phase_fk
    FOREIGN KEY (company_id, phase_id) REFERENCES public.project_phases(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT cost_entries_category_fk
    FOREIGN KEY (company_id, category_id) REFERENCES public.cost_categories(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT cost_entries_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT cost_entries_booked_by_fk
    FOREIGN KEY (booked_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT cost_entries_reversed_by_fk
    FOREIGN KEY (company_id, reversed_by) REFERENCES public.cost_entries(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT cost_entries_reverses_id_fk
    FOREIGN KEY (company_id, reverses_id) REFERENCES public.cost_entries(company_id, id) ON DELETE RESTRICT
);

/*
 * Idempotencija po IZVORU (spec 06 §1.3.12): jedan događaj = jedan trošak.
 *
 * Djelimični unikat (`status <> 'REVERSED'`) je namjeran: storniran red ostaje kao dokaz, a isti
 * izvor smije dobiti novi trošak (ispravka). Puni unikat bi značio da greška u knjiženju trajno
 * blokira taj događaj — a storno bi bio nemoguć upravo kad je najpotrebniji.
 */
CREATE UNIQUE INDEX cost_entries_source_unique
  ON public.cost_entries (company_id, source_type, source_id)
  WHERE status <> 'REVERSED';

CREATE INDEX cost_entries_project_period_idx
  ON public.cost_entries (company_id, project_id, occurred_on DESC, id);
CREATE INDEX cost_entries_phase_idx
  ON public.cost_entries (company_id, phase_id) WHERE phase_id IS NOT NULL;
CREATE INDEX cost_entries_category_idx
  ON public.cost_entries (company_id, category_id, occurred_on DESC);
CREATE INDEX cost_entries_pending_idx
  ON public.cost_entries (company_id, project_id) WHERE status = 'PENDING';

COMMENT ON TABLE public.cost_entries IS
  'JEDAN ledger troška svih izvora (spec 06 §1.3). Nepromjenjiv: ispravka je storno (original '
  'REVERSED + novi POSTED sa razlogom), nikad UPDATE iznosa i nikad DELETE.';

/*
 * Zaštita ledgera, u bazi a ne samo u servisu:
 *   1. nema novog troška na ZATVORENOM projektu (`PROJECT_CLOSED`);
 *   2. nema brisanja (grant ionako ne postoji — ovo je druga linija);
 *   3. UPDATE smije samo POSTED/PENDING → REVERSED uz `reversed_by`; iznos, izvor, projekat i
 *      kategorija su nepromjenjivi. Bez toga bi „ispravka“ mogla tiho prepisati istoriju.
 */
CREATE OR REPLACE FUNCTION public.cost_entry_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $cost_entry_guard$
DECLARE
  v_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'COST_ENTRY_DELETE_FORBIDDEN'
      USING DETAIL = 'Trošak se ne briše; ispravka je storno koji ostaje u ledgeru.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.phase_id IS DISTINCT FROM OLD.phase_id
       OR NEW.category_id IS DISTINCT FROM OLD.category_id
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.machine_id IS DISTINCT FROM OLD.machine_id
       OR NEW.occurred_on IS DISTINCT FROM OLD.occurred_on
       OR NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.unit IS DISTINCT FROM OLD.unit
       OR NEW.rate_snapshot IS DISTINCT FROM OLD.rate_snapshot
       OR NEW.reverses_id IS DISTINCT FROM OLD.reverses_id
       OR NEW.booked_by IS DISTINCT FROM OLD.booked_by
       OR NEW.booked_at IS DISTINCT FROM OLD.booked_at THEN
      RAISE EXCEPTION 'COST_ENTRY_IMMUTABLE'
        USING DETAIL = 'Knjižen trošak se ne mijenja; ispravka ide kao storno i novi red.';
    END IF;
    IF OLD.status = 'REVERSED' THEN
      RAISE EXCEPTION 'COST_ENTRY_IMMUTABLE'
        USING DETAIL = 'Storniran trošak je konačan.';
    END IF;
    -- Dozvoljeno: PENDING → POSTED (cijena je stigla) i POSTED/PENDING → REVERSED.
    IF NEW.status = 'POSTED' AND OLD.status <> 'PENDING' THEN
      RAISE EXCEPTION 'COST_ENTRY_IMMUTABLE'
        USING DETAIL = 'POSTED trošak se ne vraća u izmjenu; ispravka ide stornom.';
    END IF;
    IF NEW.status = 'PENDING' AND OLD.status <> 'PENDING' THEN
      RAISE EXCEPTION 'COST_ENTRY_IMMUTABLE'
        USING DETAIL = 'Trošak se ne vraća u PENDING; iznos se ispravlja stornom.';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT: zatvoren projekat ne prima nova knjiženja (spec 06 §1.8.32).
  SELECT p.status INTO v_status
    FROM public.projects p
   WHERE p.company_id = NEW.company_id AND p.id = NEW.project_id;

  IF v_status = 'FINISHED' THEN
    RAISE EXCEPTION 'PROJECT_CLOSED'
      USING DETAIL = 'Projekat je zatvoren; knjiženje traži ponovno otvaranje uz razlog.';
  END IF;

  IF NEW.status = 'REVERSED' THEN
    RAISE EXCEPTION 'COST_ENTRY_IMMUTABLE'
      USING DETAIL = 'Storno se upisuje kao POSTED red koji poništava original, a original se tada označi.';
  END IF;

  RETURN NEW;
END;
$cost_entry_guard$;

CREATE TRIGGER cost_entries_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cost_entries
  FOR EACH ROW EXECUTE FUNCTION public.cost_entry_guard();

-- ---------------------------------------------------------------- 3. Prenos starog ledgera

/* Prenos `project_cost_entries` → `cost_entries`.
 *
 * Kategorija: `MEHANIZACIJA` ako postoji zadana kategorija za `MACHINE_WORK_LOG`, inače `OSTALO`.
 * Za firme koje još nemaju nijednu kategoriju (nastale prije F5 i bez člana), set se pravi ovdje
 * — `created_by` se uzima sa prvog starog knjiženja te firme, jer je to korisnik koji STVARNO
 * postoji i koji je te troškove upisao. */
INSERT INTO public.cost_categories
  (id, company_id, code, name, sort_order, default_for_source_type, created_by, updated_by)
SELECT
  'cc_' || replace(gen_random_uuid()::text, '-', ''),
  c.id,
  seed.code,
  seed.name,
  seed.sort_order,
  seed.source_type,
  (SELECT m.user_id FROM public.memberships m WHERE m.company_id = c.id ORDER BY m.created_at LIMIT 1),
  (SELECT m.user_id FROM public.memberships m WHERE m.company_id = c.id ORDER BY m.created_at LIMIT 1)
FROM public.companies c
CROSS JOIN (VALUES
  ('RAD', 'Rad', 10, 'WORKDAY'),
  ('MEHANIZACIJA', 'Mehanizacija', 20, 'MACHINE_WORK_LOG'),
  ('GORIVO', 'Gorivo', 30, 'FUEL_ENTRY'),
  ('MATERIJAL', 'Materijal', 40, 'PURCHASE'),
  ('PODIZVOĐAČI', 'Podizvođači', 50, 'SUBCONTRACTOR'),
  ('TRANSPORT', 'Transport', 60, 'HAUL'),
  ('OSTALO', 'Ostalo', 99, NULL)
) AS seed(code, name, sort_order, source_type)
WHERE EXISTS (SELECT 1 FROM public.memberships m WHERE m.company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.cost_categories cc WHERE cc.company_id = c.id)
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_entries
  (id, company_id, project_id, phase_id, category_id, source_type, source_id, machine_id,
   occurred_on, amount_cents, currency_code, quantity, unit, rate_snapshot, status, note,
   booked_by, booked_at)
SELECT
  e.id,
  e.company_id,
  e.project_id,
  NULL,
  COALESCE(
    (SELECT cc.id FROM public.cost_categories cc
      WHERE cc.company_id = e.company_id AND cc.default_for_source_type = 'MACHINE_WORK_LOG'
      ORDER BY cc.sort_order LIMIT 1),
    (SELECT cc.id FROM public.cost_categories cc
      WHERE cc.company_id = e.company_id AND cc.code = 'OSTALO' LIMIT 1)
  ),
  e.source_type,
  e.source_id,
  e.machine_id,
  /* Lokalni dan knjiženja: izvještaji po periodu idu po `occurred_on`, pa dan mora biti dan
     firme, ne UTC dan (u 00:30 po lokalnom vremenu UTC je još jučer). */
  (e.booked_at AT TIME ZONE COALESCE(
    (SELECT c.timezone FROM public.companies c WHERE c.id = e.company_id), 'UTC'))::date,
  e.amount_cents,
  e.currency_code,
  e.hours,
  'h',
  e.rate_snapshot,
  'POSTED',
  e.note,
  e.booked_by,
  e.booked_at
FROM public.project_cost_entries e
WHERE COALESCE(
  (SELECT cc.id FROM public.cost_categories cc
    WHERE cc.company_id = e.company_id AND cc.default_for_source_type = 'MACHINE_WORK_LOG'
    ORDER BY cc.sort_order LIMIT 1),
  (SELECT cc.id FROM public.cost_categories cc
    WHERE cc.company_id = e.company_id AND cc.code = 'OSTALO' LIMIT 1)
) IS NOT NULL
ON CONFLICT DO NOTHING;

/*
 * Tabela se briše tek kad su redovi stvarno preneseni. Provjera broji redove koje NEMA u novom
 * ledgeru (po `id`), a ne sve stare redove — prva verzija je brojala sve i zaustavljala
 * migraciju i kad je prenos bio potpun.
 */
DO $$
DECLARE
  v_ostalo INTEGER;
BEGIN
  SELECT count(*) INTO v_ostalo
    FROM public.project_cost_entries e
   WHERE NOT EXISTS (
     SELECT 1 FROM public.cost_entries c
      WHERE c.company_id = e.company_id AND c.id = e.id
   );
  IF v_ostalo > 0 THEN
    RAISE EXCEPTION 'COST_MIGRATION_INCOMPLETE'
      USING DETAIL = format('Ostalo je %s redova bez prenesene kategorije; drop je zaustavljen.', v_ostalo);
  END IF;
END
$$;

DROP TABLE public.project_cost_entries;

-- ---------------------------------------------------------------- 4. Budžet sa revizijama

CREATE TABLE public.project_budget_lines (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  phase_id      TEXT,
  category_id   TEXT NOT NULL,
  amount_cents  BIGINT NOT NULL,
  currency_code TEXT NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 1,
  valid_from    DATE NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by    TEXT NOT NULL,
  CONSTRAINT project_budget_lines_amount_check CHECK (amount_cents >= 0),
  CONSTRAINT project_budget_lines_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT project_budget_lines_revision_check CHECK (revision BETWEEN 1 AND 999),
  CONSTRAINT project_budget_lines_note_check CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  CONSTRAINT project_budget_lines_company_id_unique UNIQUE (company_id, id),
  /* Jedna linija po reviziji po (fazi|null, kategoriji). `phase_id NULL` je budžet na nivou
     projekta; u PostgreSQL-u `NULL` ne pravi konflikt u UNIQUE-u, pa je potreban i djelimični
     indeks ispod — bez njega bi se ista linija na nivou projekta mogla upisati dvaput. */
  CONSTRAINT project_budget_lines_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT project_budget_lines_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_budget_lines_phase_fk
    FOREIGN KEY (company_id, phase_id) REFERENCES public.project_phases(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_budget_lines_category_fk
    FOREIGN KEY (company_id, category_id) REFERENCES public.cost_categories(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_budget_lines_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX project_budget_lines_revision_unique
  ON public.project_budget_lines (company_id, project_id, phase_id, category_id, revision)
  WHERE phase_id IS NOT NULL;
CREATE UNIQUE INDEX project_budget_lines_revision_project_unique
  ON public.project_budget_lines (company_id, project_id, category_id, revision)
  WHERE phase_id IS NULL;
CREATE INDEX project_budget_lines_revision_idx
  ON public.project_budget_lines (company_id, project_id, revision DESC, valid_from DESC);

COMMENT ON TABLE public.project_budget_lines IS
  'Budžet po revizijama (spec 06 §1.2.7). Nikad se ne prepisuje: izmjena je NOVA revizija, stara '
  'ostaje čitljiva, pa se trošak poredi sa budžetom koji je važio NA DAN troška.';

/* Budžet je append-only: jedina dozvoljena izmjena je `note` (objašnjenje unosa). Iznos i
   revizija se ne mijenjaju — inače bi „ispravka“ tiho promijenila prag koji je već upozorio. */
CREATE OR REPLACE FUNCTION public.budget_line_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $budget_line_immutable$
BEGIN
  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.revision IS DISTINCT FROM OLD.revision
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.phase_id IS DISTINCT FROM OLD.phase_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'BUDGET_REVISION_CONFLICT'
      USING DETAIL = 'Budžet se ne prepisuje; izmjena je nova revizija.';
  END IF;
  RETURN NEW;
END;
$budget_line_immutable$;

CREATE TRIGGER project_budget_lines_immutable
  BEFORE UPDATE ON public.project_budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.budget_line_immutable();

-- ---------------------------------------------------------------- 5. Predmjer

CREATE TABLE public.project_boq_items (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  project_id        TEXT NOT NULL,
  phase_id          TEXT,
  code              TEXT NOT NULL,
  description       TEXT NOT NULL,
  unit              TEXT NOT NULL,
  quantity_planned  NUMERIC(14, 3) NOT NULL,
  unit_price_cents  BIGINT NOT NULL,
  quantity_executed NUMERIC(14, 3) NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by        TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by        TEXT NOT NULL,
  CONSTRAINT project_boq_items_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT project_boq_items_description_check CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  CONSTRAINT project_boq_items_unit_check CHECK (char_length(btrim(unit)) BETWEEN 1 AND 16),
  CONSTRAINT project_boq_items_quantity_check CHECK (quantity_planned > 0 AND quantity_executed >= 0),
  CONSTRAINT project_boq_items_price_check CHECK (unit_price_cents >= 0),
  CONSTRAINT project_boq_items_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT project_boq_items_project_code_unique UNIQUE (company_id, project_id, code),
  CONSTRAINT project_boq_items_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT project_boq_items_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_boq_items_phase_fk
    FOREIGN KEY (company_id, phase_id) REFERENCES public.project_phases(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_boq_items_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT project_boq_items_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX project_boq_items_project_idx
  ON public.project_boq_items (company_id, project_id, sort_order, code);

COMMENT ON TABLE public.project_boq_items IS
  'Predmjer (spec 06 §1.4.18). Kod `progress_source = BOQ` izvedene količine daju % završenosti; '
  'kod `MANUAL` se količine NE miješaju u napredak — miješanje dva metra je najčešći izvor '
  '„100 %“ projekta koji još traje.';

-- ---------------------------------------------------------------- 6. Aneksi

CREATE TABLE public.project_amendments (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  project_id     TEXT NOT NULL,
  code           TEXT NOT NULL,
  title          TEXT NOT NULL,
  kind           TEXT NOT NULL,
  amount_cents   BIGINT,
  currency_code  TEXT,
  extension_days INTEGER,
  status         TEXT NOT NULL DEFAULT 'DRAFT',
  approved_at    TIMESTAMPTZ,
  approved_by    TEXT,
  document_id    TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by     TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by     TEXT NOT NULL,
  CONSTRAINT project_amendments_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT project_amendments_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT project_amendments_kind_check CHECK (kind IN ('SCOPE', 'TIME', 'PRICE', 'OTHER')),
  CONSTRAINT project_amendments_status_check
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  /* Odobrenje je čin sa datumom i osobom; jedno bez drugog je nedokazivo. */
  CONSTRAINT project_amendments_approved_check
    CHECK ((status = 'APPROVED') = (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT project_amendments_amount_check CHECK (amount_cents IS NULL OR amount_cents >= 0),
  CONSTRAINT project_amendments_amount_pair_check
    CHECK ((amount_cents IS NULL) = (currency_code IS NULL)),
  CONSTRAINT project_amendments_currency_check
    CHECK (currency_code IS NULL OR char_length(currency_code) = 3),
  CONSTRAINT project_amendments_extension_check
    CHECK (extension_days IS NULL OR extension_days BETWEEN 0 AND 3650),
  CONSTRAINT project_amendments_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT project_amendments_project_code_unique UNIQUE (company_id, project_id, code),
  CONSTRAINT project_amendments_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT project_amendments_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  /* `document_id` NEMA FK na `attachments`: ta tabela nema `UNIQUE (company_id, id)`, a
     uvođenje tog unikata bi dirnulo Modul 1 bez potrebe. Veza se čuva u servisu (prilog mora
     biti iste firme), isto kao kod tendera. */
  CONSTRAINT project_amendments_approved_by_fk
    FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT project_amendments_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT project_amendments_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX project_amendments_project_idx
  ON public.project_amendments (company_id, project_id, created_at DESC);

-- ---------------------------------------------------------------- 7. Zadaci

CREATE TABLE public.project_tasks (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL,
  project_id         TEXT NOT NULL,
  phase_id           TEXT,
  title              TEXT NOT NULL,
  description        TEXT,
  assignee_worker_id TEXT,
  assignee_user_id   TEXT,
  due_on             DATE,
  priority           TEXT NOT NULL DEFAULT 'NORMAL',
  status             TEXT NOT NULL DEFAULT 'OPEN',
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by         TEXT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by         TEXT NOT NULL,
  CONSTRAINT project_tasks_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT project_tasks_description_check
    CHECK (description IS NULL OR length(description) <= 4000),
  CONSTRAINT project_tasks_priority_check CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  CONSTRAINT project_tasks_status_check
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED')),
  /* Zadatak ima JEDNOG izvršioca — radnika ili nalog, nikad oboje (spec 06 §1.6.24). Dvije
     kolone istovremeno bi značile „dva izvršioca“, a model timova nije u opsegu. */
  CONSTRAINT project_tasks_assignee_check
    CHECK (assignee_worker_id IS NULL OR assignee_user_id IS NULL),
  CONSTRAINT project_tasks_done_check
    CHECK ((status = 'DONE') = (completed_at IS NOT NULL)),
  CONSTRAINT project_tasks_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT project_tasks_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT project_tasks_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_tasks_phase_fk
    FOREIGN KEY (company_id, phase_id) REFERENCES public.project_phases(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_tasks_worker_fk
    FOREIGN KEY (company_id, assignee_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_tasks_user_fk
    FOREIGN KEY (assignee_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT project_tasks_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT project_tasks_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX project_tasks_project_idx
  ON public.project_tasks (company_id, project_id, status, due_on);
CREATE INDEX project_tasks_assignee_idx
  ON public.project_tasks (company_id, assignee_worker_id, due_on)
  WHERE status <> 'DONE';
CREATE INDEX project_tasks_user_idx
  ON public.project_tasks (company_id, assignee_user_id, due_on)
  WHERE status <> 'DONE';

CREATE TABLE public.task_comments (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT task_comments_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  CONSTRAINT task_comments_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT task_comments_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT task_comments_task_fk
    FOREIGN KEY (company_id, task_id) REFERENCES public.project_tasks(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT task_comments_author_fk
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX task_comments_task_idx
  ON public.task_comments (company_id, task_id, created_at);

-- ---------------------------------------------------------------- 8. Pragovi i zatvaranje

CREATE TABLE public.budget_alert_events (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  revision      INTEGER NOT NULL,
  /* `TOTAL` ili `code` kategorije — jedan prag se prati po kategoriji i ukupno (spec 06 §1.7.26). */
  scope         TEXT NOT NULL,
  threshold_pct SMALLINT NOT NULL,
  fired_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT,
  /* Dedupe: JEDNO upozorenje po pragu po reviziji po opsegu. Bez ovoga bi svaki novi trošak
     iznad praga poslao novo obavještenje i korisnik bi isključio obavještenja — a to je gore od
     nepostojećih (isti obrazac kao `reminders.scan`). */
  dedupe_key    TEXT NOT NULL,
  CONSTRAINT budget_alert_events_scope_check
    CHECK (scope = 'TOTAL' OR length(btrim(scope)) BETWEEN 1 AND 40),
  CONSTRAINT budget_alert_events_threshold_check CHECK (threshold_pct IN (80, 100)),
  CONSTRAINT budget_alert_events_revision_check CHECK (revision BETWEEN 1 AND 999),
  CONSTRAINT budget_alert_events_resolved_check
    CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
  CONSTRAINT budget_alert_events_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT budget_alert_events_dedupe_unique UNIQUE (company_id, dedupe_key),
  CONSTRAINT budget_alert_events_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT budget_alert_events_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT budget_alert_events_resolved_by_fk
    FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX budget_alert_events_project_idx
  ON public.budget_alert_events (company_id, project_id, fired_at DESC);

CREATE TABLE public.project_close_snapshots (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  closed_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  closed_by  TEXT NOT NULL,
  payload    JSONB NOT NULL,
  CONSTRAINT project_close_snapshots_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT project_close_snapshots_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT project_close_snapshots_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_close_snapshots_closed_by_fk
    FOREIGN KEY (closed_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX project_close_snapshots_project_idx
  ON public.project_close_snapshots (company_id, project_id, closed_at DESC);

COMMENT ON TABLE public.project_close_snapshots IS
  'Zamrznuto stanje pri zatvaranju (spec 06 §1.8.31): trošak po kategoriji, marža, količine i % '
  'završenosti. Poslije zatvaranja izvještaj čita OVO, a ne žive tabele, jer se dodjele i zadaci '
  'mogu mijenjati i poslije.';

-- ---------------------------------------------------------------- 9. Faza na izvorima

ALTER TABLE public.workdays
  ADD COLUMN IF NOT EXISTS phase_id TEXT,
  ADD CONSTRAINT workdays_phase_fk
    FOREIGN KEY (company_id, phase_id) REFERENCES public.project_phases(company_id, id) ON DELETE RESTRICT;

ALTER TABLE public.machine_work_logs
  ADD COLUMN IF NOT EXISTS phase_id TEXT,
  ADD CONSTRAINT machine_work_logs_phase_fk
    FOREIGN KEY (company_id, phase_id) REFERENCES public.project_phases(company_id, id) ON DELETE RESTRICT;

ALTER TABLE public.hauls
  ADD COLUMN IF NOT EXISTS phase_id TEXT,
  ADD CONSTRAINT hauls_phase_fk
    FOREIGN KEY (company_id, phase_id) REFERENCES public.project_phases(company_id, id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------- 10. RLS

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project_phases', 'phase_dependencies', 'cost_categories', 'cost_entries',
    'project_budget_lines', 'project_boq_items', 'project_amendments',
    'project_tasks', 'task_comments', 'budget_alert_events', 'project_close_snapshots'
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

-- Nova firma dobija zadane kategorije troška bez posebnog koraka (spec 06 §1.2.6).
CREATE OR REPLACE FUNCTION public.companies_seed_cost_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $companies_seed_cost_categories$
BEGIN
  PERFORM public.seed_cost_categories(NEW.id);
  RETURN NEW;
END;
$companies_seed_cost_categories$;

CREATE TRIGGER companies_seed_cost_categories
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_seed_cost_categories();

INSERT INTO public.schema_migrations (name)
VALUES ('20261124170100_f5_2_ledger_budzet')
ON CONFLICT DO NOTHING;

COMMIT;
