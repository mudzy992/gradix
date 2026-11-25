-- =============================================================================
-- FAZA 8 (Modul 9) — servis i održavanje mašina: rad, ne samo kvar.
--
-- Polazna tačka (F4): `machine_faults` je ZAPIS O DOGAĐAJU, a `service_orders` je nastao
-- trigerom i imao je samo četiri stanja (`OPEN→IN_PROGRESS→DONE|CANCELLED`) i obavezan
-- `fault_id`. To ne može nositi preventivno održavanje (nema kvara) ni rad (nema mehaničara,
-- dijelova, stvarnog trajanja).
--
-- Šta ova migracija mijenja u modelu — i zašto:
--   1. Nalog dobija PORIJEKLO (`FAULT|PREVENTIVE|MANUAL|INSPECTION`) i `fault_id` postaje
--      nullable uz djelimični unikat. Bez toga bi preventivni nalog morao izmišljati kvar.
--   2. Nalog dobija IZVRŠENJE: mehaničar, `started_at`/`finished_at` (stvarni zastoj je
--      razlika, a ne ručni broj), sate rada, tri komponente troška sa IZVEDENIM zbirom.
--   3. Status ide u sedam vrijednosti sa `WAITING_PARTS`; `OPEN` se migrira u `PLANNED`
--      (isto značenje: nalog postoji, rad nije počeo) — bez gubljenja redova.
--   4. Stanje dijelova je `SUM(stock_movements)`, nikad `UPDATE quantity`: zaliha je izvod
--      iz dokumenata, a ne broj koji neko prepisuje.
--   5. `approval_requests.subject_type` dobija `service_order` i `purchase`, a prag servisa je
--      ZASEBAN ključ firme od praga kvara (mijenjaju se nezavisno).
--
-- Zadani šifarnik (`maintenance_templates`) NIJE u migraciji — isti razlog kao `tender_
-- checklist_templates` (F7) i komponente obračuna (F6): `created_by` pokazuje na STVARNOG
-- korisnika, pa bi firme u bazi dobile redove koji drže RESTRICT vezu ka `users`.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. Servisni nalog: porijeklo i rad

/* `fault_id` je bio NOT NULL i obavezan FK. Preventivni nalog nema kvar — zato kolona postaje
   nullable, a jedinstvenost po kvaru ostaje kroz djelimični unikat (dolje). */
ALTER TABLE public.service_orders ALTER COLUMN fault_id DROP NOT NULL;

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'FAULT',
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS project_id TEXT,
  ADD COLUMN IF NOT EXISTS assigned_mechanic_worker_id TEXT,
  ADD COLUMN IF NOT EXISTS planned_for DATE,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS labor_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_cost_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parts_cost_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_cost_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_quote_cents BIGINT,
  ADD COLUMN IF NOT EXISTS external_invoice_ref TEXT,
  ADD COLUMN IF NOT EXISTS maintenance_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS warranty_until DATE,
  ADD COLUMN IF NOT EXISTS warranty_claim BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warranty_source_order_id TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  /* `version` je bila jedina kolona koju je F4 tabela imala a F8 tok traži: svaka promjena
     stanja (start, čekanje, završetak) uvećava je, pa klijent zna da li je nalog u međuvremenu
     promijenjen. Bez nje bi dva mehaničara tiho pregazila jedan drugog. */
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

/* Default mora ići sa novim imenom stanja: trigeri (kvar, preventiva) upisuju red BEZ `status`,
   pa bi stari default `OPEN` oborio `CHECK` tek u produkciji — na prvi kvar koji neko odobri. */
ALTER TABLE public.service_orders ALTER COLUMN status SET DEFAULT 'PLANNED';

/* Staro `OPEN` znači „nalog postoji, rad nije počeo“ — u novom toku to je `PLANNED`.
   `IN_PROGRESS`/`DONE`/`CANCELLED` zadržavaju ime i značenje. */
UPDATE public.service_orders SET status = 'PLANNED' WHERE status = 'OPEN';

/* `amount_cents` je bio jedini iznos naloga (procjena kvara). Novi model ima tri komponente i
   izvedeni zbir; `amount_cents` ostaje kao NESPUTANI vanjski iznos za starije redove i puni se
   iz `external_cost_cents` kad ga nema. Ne brišemo ga: stari ekrani i izvještaji ga čitaju. */
UPDATE public.service_orders
   SET total_cost_cents = COALESCE(amount_cents, 0)
 WHERE amount_cents IS NOT NULL AND total_cost_cents = 0;

ALTER TABLE public.service_orders DROP CONSTRAINT service_orders_status_check;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_status_check CHECK (status IN (
    'PLANNED', 'APPROVED', 'IN_PROGRESS', 'WAITING_PARTS', 'DONE', 'CANCELLED'
  )),
  ADD CONSTRAINT service_orders_origin_check
    CHECK (origin IN ('FAULT', 'PREVENTIVE', 'MANUAL', 'INSPECTION')),
  ADD CONSTRAINT service_orders_kind_check CHECK (kind IN ('INTERNAL', 'EXTERNAL')),
  ADD CONSTRAINT service_orders_priority_check
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  /* Trošak je IZVEDEN: `total` je zbir tri komponente. Ručni upis zbiŕa bio bi broj koji
     ne odgovara dijelovima naloga — a upravo taj broj ide u ledger. */
  ADD CONSTRAINT service_orders_total_check
    CHECK (total_cost_cents = labor_cost_cents + parts_cost_cents + external_cost_cents),
  ADD CONSTRAINT service_orders_costs_check
    CHECK (labor_cost_cents >= 0 AND parts_cost_cents >= 0 AND external_cost_cents >= 0),
  ADD CONSTRAINT service_orders_labor_hours_check CHECK (labor_hours >= 0),
  /* Stvarni zastoj je `finished_at − started_at`; zato `finished` bez `started` ne postoji
     (bila bi to popravka koja nije počela), a `finished` prije `started` je nemoguć. */
  ADD CONSTRAINT service_orders_time_check CHECK (
    finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at)
  ),
  /* `DONE` je terminalan, pa mora imati i početak i kraj — bez toga MTTR nema šta da računa. */
  ADD CONSTRAINT service_orders_done_time_check
    CHECK (status <> 'DONE' OR (started_at IS NOT NULL AND finished_at IS NOT NULL)),
  ADD CONSTRAINT service_orders_cancel_reason_check
    CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 3 AND 500),
  ADD CONSTRAINT service_orders_external_check
    CHECK (kind <> 'EXTERNAL' OR partner_id IS NOT NULL),
  ADD CONSTRAINT service_orders_external_ref_check
    CHECK (external_invoice_ref IS NULL OR length(btrim(external_invoice_ref)) BETWEEN 1 AND 120),
  ADD CONSTRAINT service_orders_mechanic_fk
    FOREIGN KEY (company_id, assigned_mechanic_worker_id)
    REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT service_orders_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT service_orders_warranty_source_fk
    FOREIGN KEY (company_id, warranty_source_order_id)
    REFERENCES public.service_orders(company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT service_orders_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;

/* Jedan kvar = jedan nalog. Puni UNIQUE iz F4 je pokrivao i `fault_id IS NULL`, pa bi drugi
   preventivni nalog iste firme pao na njemu (NULL-ovi su u Postgresu različiti, ali unikat je
   ipak bio deklarisan nad kolonom, ne nad izrazom — djelimični indeks je jasniji i jeftiniji). */
ALTER TABLE public.service_orders DROP CONSTRAINT service_orders_fault_unique;
CREATE UNIQUE INDEX service_orders_fault_unique
  ON public.service_orders (company_id, fault_id)
  WHERE fault_id IS NOT NULL;

CREATE INDEX service_orders_queue_idx
  ON public.service_orders (company_id, status, priority, planned_for);
CREATE INDEX service_orders_mechanic_idx
  ON public.service_orders (company_id, assigned_mechanic_worker_id, status);
CREATE INDEX service_orders_machine_open_idx
  ON public.service_orders (company_id, machine_id)
  WHERE status NOT IN ('DONE', 'CANCELLED');

/* `machine_faults` dobija vezu na nalog za brz prikaz (kvar ↔ rad). Denormalizovano NIJE
   izvor istine — nalog je; kolona se puni trigerom ispod. */
ALTER TABLE public.machine_faults
  ADD COLUMN IF NOT EXISTS service_order_id TEXT;

ALTER TABLE public.machine_faults
  ADD CONSTRAINT machine_faults_service_order_fk
    FOREIGN KEY (company_id, service_order_id)
    REFERENCES public.service_orders(company_id, id) ON DELETE RESTRICT;

/* Triger iz F4 pravi nalog sa četiri stare kolone. Sada mora postaviti i `origin`, projekat i
   prioritet — inače bi nalog iz kvara izgledao kao ručni unos i izgubio vezu na projekat, pa
   bi trošak završio na mašini umjesto na projektu (spec 09 §1.4/20). */
CREATE OR REPLACE FUNCTION public.machine_fault_open_service_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fault_service_order$
DECLARE
  v_currency TEXT;
  v_order_id TEXT;
BEGIN
  IF NEW.status <> 'APPROVED' OR (TG_OP = 'UPDATE' AND OLD.status = 'APPROVED') THEN
    RETURN NEW;
  END IF;

  SELECT currency INTO v_currency FROM public.companies WHERE id = NEW.company_id;

  v_order_id := 'svo_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.service_orders
    (id, company_id, machine_id, fault_id, partner_id, description, amount_cents,
     currency_code, created_by, origin, kind, priority, project_id,
     external_cost_cents, total_cost_cents)
  VALUES (
    v_order_id,
    NEW.company_id,
    NEW.machine_id,
    NEW.id,
    NEW.partner_id,
    left('Servis po kvaru: ' || NEW.title, 2000),
    NEW.estimated_cost_cents,
    CASE WHEN NEW.estimated_cost_cents IS NULL THEN NULL ELSE COALESCE(v_currency, 'BAM') END,
    NEW.updated_by,
    'FAULT',
    CASE WHEN NEW.partner_id IS NULL THEN 'INTERNAL' ELSE 'EXTERNAL' END,
    NEW.priority,
    NEW.project_id,
    COALESCE(NEW.estimated_cost_cents, 0),
    COALESCE(NEW.estimated_cost_cents, 0)
  )
  ON CONFLICT (company_id, fault_id) WHERE fault_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NOT NULL THEN
    UPDATE public.machine_faults SET service_order_id = v_order_id WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$fault_service_order$;

/* Odbijeno odobrenje kvara → nalog se poništava sa razlogom (spec 09 §1.1/5). Kvar ostaje
   vidljiv kao neriješen; nalog je rad koji neće biti izvršen. */
CREATE OR REPLACE FUNCTION public.machine_fault_cancel_service_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fault_cancel$
BEGIN
  IF NEW.status <> 'CANCELLED' OR (TG_OP = 'UPDATE' AND OLD.status = 'CANCELLED') THEN
    RETURN NEW;
  END IF;
  UPDATE public.service_orders
     SET status = 'CANCELLED',
         cancel_reason = COALESCE(cancel_reason, 'Kvar je otkazan.'),
         closed_at = COALESCE(closed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   WHERE company_id = NEW.company_id AND fault_id = NEW.id
     AND status NOT IN ('DONE', 'CANCELLED');
  RETURN NEW;
END;
$fault_cancel$;

CREATE TRIGGER machine_faults_cancel_service_order
  AFTER UPDATE OF status ON public.machine_faults
  FOR EACH ROW EXECUTE FUNCTION public.machine_fault_cancel_service_order();

-- ---------------------------------------------------------------- 2. Tok naloga: događaji

CREATE TABLE public.service_order_events (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  service_order_id TEXT NOT NULL,
  kind          TEXT NOT NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor_id      TEXT,
  note          TEXT,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT service_order_events_kind_check CHECK (kind IN (
    'OPENED', 'APPROVED', 'STARTED', 'PARTS_REQUESTED', 'WAITING', 'FINISHED', 'REOPENED', 'CANCELLED'
  )),
  CONSTRAINT service_order_events_note_check
    CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 1000),
  CONSTRAINT service_order_events_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT service_order_events_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT service_order_events_order_fk
    FOREIGN KEY (company_id, service_order_id)
    REFERENCES public.service_orders(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_order_events_actor_fk
    FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX service_order_events_order_idx
  ON public.service_order_events (company_id, service_order_id, at, id);

COMMENT ON TABLE public.service_order_events IS
  'Tok unutar naloga (spec 09 §1.6/28) — append-only. Nema UPDATE/DELETE granta: istorija '
  'naloga je dokaz ko je kad otvorio, odobrio, počeo i završio rad.';

/* Događaj koji nedostaje čini nalog nedokazivim: nalog u `IN_PROGRESS` bez `STARTED` ne može
   objasniti odakle zastoj. Zato prvih pet prelaza piše događaj TRIGEROM, a ne kod — prelaz se
   postavlja na više mjesta (servis, sync, ručna ispravka), pa bi treće mjesto zaboravilo. */
CREATE OR REPLACE FUNCTION public.service_order_event_on_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $so_event$
DECLARE
  v_kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_kind := CASE NEW.status
    WHEN 'PLANNED' THEN 'OPENED'
    WHEN 'APPROVED' THEN 'APPROVED'
    WHEN 'IN_PROGRESS' THEN CASE WHEN TG_OP = 'UPDATE' AND OLD.status = 'WAITING_PARTS'
                                 THEN 'REOPENED' ELSE 'STARTED' END
    WHEN 'WAITING_PARTS' THEN 'WAITING'
    WHEN 'DONE' THEN 'FINISHED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE NULL
  END;
  IF v_kind IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.service_order_events
    (id, company_id, service_order_id, kind, at, actor_id, note)
  VALUES (
    'soe_' || replace(gen_random_uuid()::text, '-', ''),
    NEW.company_id,
    NEW.id,
    v_kind,
    clock_timestamp(),
    COALESCE(NEW.updated_by, NEW.created_by),
    CASE WHEN NEW.status = 'CANCELLED' THEN NEW.cancel_reason ELSE NULL END
  );

  RETURN NEW;
END;
$so_event$;

CREATE TRIGGER service_orders_event_on_insert
  AFTER INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.service_order_event_on_status();

CREATE TRIGGER service_orders_event_on_status
  AFTER UPDATE OF status ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.service_order_event_on_status();

-- ---------------------------------------------------------------- 3. Preventivno održavanje

CREATE TABLE public.maintenance_templates (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  category_id    TEXT,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  basis          TEXT NOT NULL,
  interval_value NUMERIC(12, 2) NOT NULL,
  tolerance_pct  NUMERIC(6, 2) NOT NULL DEFAULT 10,
  items          JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by     TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by     TEXT NOT NULL,
  CONSTRAINT maintenance_templates_basis_check CHECK (basis IN ('HOURS', 'KM', 'DAYS')),
  CONSTRAINT maintenance_templates_interval_check CHECK (interval_value > 0),
  CONSTRAINT maintenance_templates_tolerance_check
    CHECK (tolerance_pct BETWEEN 0 AND 50),
  CONSTRAINT maintenance_templates_code_check
    CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT maintenance_templates_name_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT maintenance_templates_items_check CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT maintenance_templates_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT maintenance_templates_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT maintenance_templates_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT maintenance_templates_category_fk
    FOREIGN KEY (company_id, category_id)
    REFERENCES public.equipment_categories(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT maintenance_templates_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT maintenance_templates_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX maintenance_templates_category_idx
  ON public.maintenance_templates (company_id, category_id, sort_order)
  WHERE is_active;

CREATE TABLE public.maintenance_plans (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL,
  machine_id       TEXT NOT NULL,
  template_id      TEXT,
  name             TEXT NOT NULL,
  basis            TEXT NOT NULL,
  interval_value   NUMERIC(12, 2) NOT NULL,
  tolerance_pct    NUMERIC(6, 2) NOT NULL DEFAULT 10,
  last_done_at     DATE,
  last_done_meter  NUMERIC(14, 2),
  next_due_at      DATE,
  next_due_meter   NUMERIC(14, 2),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by       TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by       TEXT NOT NULL,
  CONSTRAINT maintenance_plans_basis_check CHECK (basis IN ('HOURS', 'KM', 'DAYS')),
  CONSTRAINT maintenance_plans_interval_check CHECK (interval_value > 0),
  CONSTRAINT maintenance_plans_tolerance_check CHECK (tolerance_pct BETWEEN 0 AND 50),
  CONSTRAINT maintenance_plans_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT maintenance_plans_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT maintenance_plans_plan_unique UNIQUE (company_id, machine_id, template_id),
  CONSTRAINT maintenance_plans_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT maintenance_plans_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT maintenance_plans_template_fk
    FOREIGN KEY (company_id, template_id) REFERENCES public.maintenance_templates(company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT maintenance_plans_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT maintenance_plans_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX maintenance_plans_due_idx
  ON public.maintenance_plans (company_id, next_due_at)
  WHERE is_active;
CREATE INDEX maintenance_plans_machine_idx
  ON public.maintenance_plans (company_id, machine_id)
  WHERE is_active;

ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_maintenance_plan_fk
    FOREIGN KEY (company_id, maintenance_plan_id)
    REFERENCES public.maintenance_plans(company_id, id) ON DELETE RESTRICT;

/* Jedan nalog po planu po ciklusu (spec 09 §1.2/9): `dedupe` je (plan, ciljni metar/datum).
   Bez toga bi posao koji ide svakih 15 minuta pravio nalog svakih 15 minuta. */
CREATE UNIQUE INDEX service_orders_preventive_cycle_unique
  ON public.service_orders (company_id, maintenance_plan_id, planned_for)
  WHERE maintenance_plan_id IS NOT NULL AND status <> 'CANCELLED';

-- ---------------------------------------------------------------- 4. Skladište (minimalno)

CREATE TABLE public.stock_items (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'kom',
  category_id   TEXT,
  min_quantity  NUMERIC(14, 3) NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by    TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by    TEXT NOT NULL,
  CONSTRAINT stock_items_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 64),
  CONSTRAINT stock_items_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT stock_items_unit_check CHECK (char_length(btrim(unit)) BETWEEN 1 AND 16),
  CONSTRAINT stock_items_min_check CHECK (min_quantity >= 0),
  CONSTRAINT stock_items_note_check CHECK (note IS NULL OR length(note) <= 1000),
  CONSTRAINT stock_items_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT stock_items_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT stock_items_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT stock_items_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT stock_items_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX stock_items_active_idx
  ON public.stock_items (company_id, code) WHERE is_active;

/*
 * Kretanje je DOKUMENT, stanje je IZVOD. Zato nema kolone `quantity` na artiklu: zaliha je
 * `SUM(stock_movements.quantity × smjer)`, a ne broj koji neko prepisuje.
 *
 * `warehouse_id` je NULLABLE namjerno (spec 09 §1.3/16): MVP ima jedno implicitno skladište po
 * firmi, a Modul 10 dodaje više skladišta BEZ promjene modela kretnji — samo puni kolonu.
 */
CREATE TABLE public.stock_movements (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  item_id         TEXT NOT NULL,
  warehouse_id    TEXT,
  kind            TEXT NOT NULL,
  quantity        NUMERIC(14, 3) NOT NULL,
  unit_cost_cents BIGINT,
  occurred_on     DATE NOT NULL,
  source_type     TEXT,
  source_id       TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by      TEXT NOT NULL,
  CONSTRAINT stock_movements_kind_check CHECK (kind IN ('IN', 'OUT', 'TRANSFER', 'COUNT')),
  CONSTRAINT stock_movements_quantity_check
    CHECK ((kind = 'TRANSFER' AND quantity <> 0) OR (kind <> 'TRANSFER' AND quantity > 0)),
  CONSTRAINT stock_movements_cost_check CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  CONSTRAINT stock_movements_source_check
    CHECK (source_type IS NULL OR source_type IN ('SERVICE_ORDER', 'MANUAL', 'PURCHASE', 'COUNT')),
  CONSTRAINT stock_movements_source_pair_check
    CHECK ((source_type IS NULL) = (source_id IS NULL)),
  CONSTRAINT stock_movements_note_check
    CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 1000),
  CONSTRAINT stock_movements_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT stock_movements_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_item_fk
    FOREIGN KEY (company_id, item_id) REFERENCES public.stock_items(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

/* Automatska kretnja je idempotentna po izvoru (spec 09 §1.3/14): utrošak istog naloga ne smije
   skinuti zalihu dvaput. Djelimični unikat — ručne kretnje (`source_id NULL`) nijesu vezane. */
CREATE UNIQUE INDEX stock_movements_source_unique
  ON public.stock_movements (company_id, source_type, source_id, item_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX stock_movements_item_idx
  ON public.stock_movements (company_id, item_id, occurred_on DESC);
CREATE INDEX stock_movements_date_idx
  ON public.stock_movements (company_id, occurred_on DESC);

CREATE TABLE public.service_order_parts (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL,
  service_order_id TEXT NOT NULL,
  item_id          TEXT NOT NULL,
  quantity         NUMERIC(14, 3) NOT NULL,
  unit_cost_cents  BIGINT NOT NULL,
  currency_code    TEXT NOT NULL,
  stock_movement_id TEXT,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by       TEXT NOT NULL,
  CONSTRAINT service_order_parts_quantity_check CHECK (quantity > 0),
  CONSTRAINT service_order_parts_cost_check CHECK (unit_cost_cents >= 0),
  CONSTRAINT service_order_parts_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT service_order_parts_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT service_order_parts_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT service_order_parts_order_fk
    FOREIGN KEY (company_id, service_order_id)
    REFERENCES public.service_orders(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_order_parts_item_fk
    FOREIGN KEY (company_id, item_id) REFERENCES public.stock_items(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_order_parts_movement_fk
    FOREIGN KEY (company_id, stock_movement_id)
    REFERENCES public.stock_movements(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_order_parts_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX service_order_parts_order_idx
  ON public.service_order_parts (company_id, service_order_id);

-- ---------------------------------------------------------------- 5. Firma: prag servisa i blokada

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS service_approval_threshold_cents BIGINT NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS block_on_overdue_maintenance BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_service_approval_threshold_check,
  ADD CONSTRAINT companies_service_approval_threshold_check
    CHECK (service_approval_threshold_cents >= 0);

COMMENT ON COLUMN public.companies.service_approval_threshold_cents IS
  'Prag odobrenja servisnog naloga (spec 09 §1.5/24), default 500 KM. ZASEBAN od praga kvara: '
  'mijenjaju se nezavisno i ne smiju se vezivati jedan na drugi.';
COMMENT ON COLUMN public.companies.block_on_overdue_maintenance IS
  'Stroga blokada dodjele/radnih sati zbog isteklog preventivnog servisa (spec 09 §1.2/10). '
  'Default false: istek je UPOZORENJE; gorivo nije blokirano ni kad je blokada uključena.';

-- ---------------------------------------------------------------- 6. Trošak: mašina ILI projekat

/*
 * `cost_entries.project_id` je bio `NOT NULL` (F5) jer je svaki izvor troška tada imao projekat.
 * Servis ga nema uvijek: spec 09 §1.4/20 traži da trošak ide na projekat SAMO kad je mašina u
 * periodu zastoja bila dodijeljena projektu i kvar nastao u radu; inače ide SAMO na mašinu.
 *
 * Zašto izmjena šeme, a ne „red bez projekta se ne knjiži“: trošak popravke postoji i kad mašina
 * nije na projektu — ako ga ledger ne primi, popravka nestaje iz svakog obračuna, a mašina izgleda
 * besplatna. Zato `project_id` postaje nullable uz uslov da red ima BAR jedan nosilac: trošak bez
 * ijednog nosioca nije trošak nego gubitak iz vida.
 *
 * „Nikad oboje“ (§1.4/21) nije CHECK nego postojeći djelimični unikat
 * `cost_entries_source_unique (company_id, source_type, source_id) WHERE status <> 'REVERSED'`:
 * jedan izvor = jedan red, pa ne može biti ni dva reda (projekat + mašina) ni dupli red.
 */
ALTER TABLE public.cost_entries ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.cost_entries
  ADD CONSTRAINT cost_entries_subject_check
    CHECK (project_id IS NOT NULL OR machine_id IS NOT NULL);

/* Upiti po mašini (trošak održavanja po satu rada, top 3 mašine) idu bez projekta — bez ovog
   indeksa svaki takav upit prolazi kroz cijeli ledger firme. */
CREATE INDEX cost_entries_machine_idx
  ON public.cost_entries (company_id, machine_id, occurred_on DESC)
  WHERE machine_id IS NOT NULL;

COMMENT ON COLUMN public.cost_entries.project_id IS
  'Projekat nosilac troška; NULL znači trošak SAMO na mašini (servis van projekta, spec 09 §1.4/20). '
  'Nikad oboje: jedan (source_type, source_id) = jedan red, pa nema duplog troška.';

-- ---------------------------------------------------------------- 7. Odobrenja: novi predmeti

ALTER TABLE public.approval_requests DROP CONSTRAINT approval_requests_subject_type_check;
ALTER TABLE public.approval_requests
  ADD CONSTRAINT approval_requests_subject_type_check
    CHECK (subject_type IN ('machine_fault', 'service_order', 'purchase'));

-- ---------------------------------------------------------------- 8. RLS + grantovi

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'service_order_events', 'service_order_parts', 'maintenance_templates',
    'maintenance_plans', 'stock_items', 'stock_movements'
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

/*
 * Grantovi NIJESU ovdje — oni su u `bootstrap/grants.sql`.
 *
 * Zašto: taj fajl počinje sa `REVOKE ALL PRIVILEGES ... FROM gradix_app`, pa bi grant upisan u
 * migraciji bio poništen pri svakom bootstrapu baze. Greška se ne vidi u testovima koji rade nad
 * već migriranom bazom, nego tek tamo gdje se baza podigne iznova. Pravilo je zato jedno: ŠEMA u
 * migraciji, PRAVA u `grants.sql`, i `privilege-matrix.tsv` kao treća provjera.
 */

INSERT INTO public.schema_migrations (name)
VALUES ('20261125140000_f8_1_servis_odrzavanje')
ON CONFLICT DO NOTHING;

COMMIT;
