-- =============================================================================
-- FAZA 4 (Modul 5, `05-mehanizacija.md`) — razložen trošak mašine, gorivo, stacionaža,
-- šabloni pregleda, najam i zabrana dvostruke dodjele mašine.
--
-- Polazi od postojećeg stanja (R5/R6): `machine_cost_rates` je RAVNA stopa, `fuel_entries`
-- postoji sa nullable iznosom, `route_segments` je šifarnik bez kilometraže, `machine_daily_checks`
-- ima slobodan `checklist_json`, `machines.ownership` je `OWN|RENT`.
--
-- Šta ova migracija NE dira: niti jedan postojeći red i niti jednu postojeću semantiku. Sve je
-- aditivno; `machine_cost_rates` ostaje izvor istine za RUČNU stopu i dobija samo oznake
-- `is_manual`/`reason`, pa stari obračuni ostaju objašnjivi.
--
-- Odluke koje se ne smiju izgubiti (spec 05 §1):
--   * trošak je RAZLOŽEN po komponentama; mjesečna komponenta se dijeli sa `planned_hours_per_month`;
--   * stopa se ZAMRZAVA u `project_cost_entries.rate_snapshot` — promjena komponente ne mijenja
--     već proknjižen trošak;
--   * odstupanje goriva > praga traži OBJAŠNJENJE, ne tiho zatvaranje;
--   * cisterna i pumpa se NIKAD ne vode paralelno;
--   * ista mašina ne može biti na dva gradilišta u istom periodu, osim uz odobrenu iznimku.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. Postavke firme

ALTER TABLE public.companies
  -- Nazivnik za PER_MONTH komponente. Zašto po firmi, a ne konstanta 160: firma sa dvije smjene
  -- ima 320 sati mjesečno i ista mjesečna rata depresijacije daje DUPLO manji trošak po satu —
  -- to nije „podešavanje ukusa", to je novac. Zato je parametar, a ne broj u kodu.
  ADD COLUMN IF NOT EXISTS planned_hours_per_month SMALLINT NOT NULL DEFAULT 160,
  -- Prag odstupanja potrošnje goriva u procentima (spec 05 §1.3.13).
  ADD COLUMN IF NOT EXISTS fuel_deviation_threshold_pct SMALLINT NOT NULL DEFAULT 20,
  -- Cisterna se uključuje po firmi; uključena mijenja tok točenja (skida stanje), isključena ne.
  ADD COLUMN IF NOT EXISTS fuel_tank_enabled BOOLEAN NOT NULL DEFAULT false,
  -- Prag odobrenja troška kvara (spec 05 §1.6.24). Default 500 KM = 50000 centi.
  ADD COLUMN IF NOT EXISTS fault_approval_threshold_cents BIGINT NOT NULL DEFAULT 50000;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_planned_hours_check
    CHECK (planned_hours_per_month BETWEEN 40 AND 744),
  -- 744 = 31 dan × 24 h. Više od toga nije nazivnik, nego greška u unosu.
  ADD CONSTRAINT companies_fuel_threshold_check
    CHECK (fuel_deviation_threshold_pct BETWEEN 1 AND 200),
  ADD CONSTRAINT companies_fault_threshold_check
    CHECK (fault_approval_threshold_cents >= 0);

-- ---------------------------------------------------------------- 2. Trošak: komponente

CREATE TABLE public.machine_cost_components (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  machine_id     TEXT NOT NULL,
  component      TEXT NOT NULL,
  amount_cents   BIGINT NOT NULL,
  currency_code  TEXT NOT NULL,
  basis          TEXT NOT NULL,
  valid_from     DATE NOT NULL,
  valid_to       DATE,
  note           TEXT,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT machine_cost_components_component_check
    CHECK (component IN ('DEPRECIATION', 'FUEL', 'SERVICE', 'OPERATOR', 'INSURANCE', 'OTHER', 'RENTAL')),
  CONSTRAINT machine_cost_components_basis_check
    CHECK (basis IN ('PER_HOUR', 'PER_MONTH', 'PER_KM')),
  CONSTRAINT machine_cost_components_amount_check CHECK (amount_cents >= 0),
  CONSTRAINT machine_cost_components_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT machine_cost_components_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT machine_cost_components_note_check CHECK (note IS NULL OR length(note) <= 500),
  CONSTRAINT machine_cost_components_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT machine_cost_components_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_cost_components_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_cost_components_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_cost_components_machine_idx
  ON public.machine_cost_components (company_id, machine_id, valid_from DESC);

/*
 * Dvije važeće komponente ISTOG tipa za isti period nemaju značenje — zbir bi bio proizvoljan.
 * Isti obrazac kao dodjele i satnice: `EXCLUDE` kad je `btree_gist` dostupan, inače triger sa
 * savjetodavnom bravom. NIKAD oba, NIKAD nijedan (vidi F3 lekciju: bezuslovni EXCLUDE ruši
 * migraciju na serveru bez contrib-a).
 */
DO $$
DECLARE
  ima_gist BOOLEAN := false;
BEGIN
  IF current_setting('gradix.bez_btree_gist', true) = 'on' THEN
    RAISE NOTICE 'machine_cost_components: btree_gist preskočen prekidačem, ide triger.';
  ELSE
    BEGIN
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      ima_gist := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'machine_cost_components: btree_gist nije dostupan (%): ide triger.', SQLERRM;
      ima_gist := false;
    END;
  END IF;

  IF ima_gist THEN
    ALTER TABLE public.machine_cost_components
      ADD CONSTRAINT machine_cost_components_no_overlap
      EXCLUDE USING gist (
        company_id WITH =,
        machine_id WITH =,
        component WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
      ) DEFERRABLE INITIALLY IMMEDIATE;
  ELSE
    CREATE OR REPLACE FUNCTION public.machine_cost_component_no_overlap()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
    AS $mcc_no_overlap$
    DECLARE
      sukobi INTEGER;
    BEGIN
      PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.company_id || ':' || NEW.machine_id || ':' || NEW.component, 0)
      );
      SELECT count(*) INTO sukobi
        FROM public.machine_cost_components c
       WHERE c.company_id = NEW.company_id
         AND c.machine_id = NEW.machine_id
         AND c.component = NEW.component
         AND c.id <> NEW.id
         AND c.valid_from <= COALESCE(NEW.valid_to, 'infinity'::date)
         AND NEW.valid_from <= COALESCE(c.valid_to, 'infinity'::date);
      IF sukobi > 0 THEN
        RAISE EXCEPTION 'COST_COMPONENT_OVERLAP'
          USING DETAIL = 'Ista komponenta stope već važi u periodu koji se preklapa.';
      END IF;
      RETURN NEW;
    END;
    $mcc_no_overlap$;

    CREATE TRIGGER machine_cost_components_no_overlap
      BEFORE INSERT OR UPDATE ON public.machine_cost_components
      FOR EACH ROW EXECUTE FUNCTION public.machine_cost_component_no_overlap();
  END IF;
END $$;

COMMENT ON TABLE public.machine_cost_components IS
  'Razložen trošak mašine (spec 05 §1.1): DEPRECIATION/FUEL/SERVICE/OPERATOR/INSURANCE/OTHER/RENTAL, '
  'svaka sa osnovom PER_HOUR|PER_MONTH|PER_KM i periodom važenja. Nova vrijednost je NOVI RED — '
  'stari dobija valid_to. Iznos se nikad ne prepisuje, jer bi to promijenilo već proknjižene troškove.';

-- ---------------------------------------------------------------- 3. Trošak: snapshot

CREATE TABLE public.machine_cost_rate_snapshots (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  machine_id     TEXT NOT NULL,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Stanje komponenti u trenutku računanja: tip, osnova, iznos, period. Bez ovoga se poslije
  -- promjene komponente ne može objasniti zašto je trošak bio taj broj.
  components     JSONB NOT NULL,
  rate_cents     BIGINT NOT NULL,
  currency_code  TEXT NOT NULL,
  source         TEXT NOT NULL,
  planned_hours  SMALLINT NOT NULL,
  created_by     TEXT,
  CONSTRAINT machine_cost_rate_snapshots_source_check
    CHECK (source IN ('CALCULATED', 'MANUAL')),
  CONSTRAINT machine_cost_rate_snapshots_rate_check CHECK (rate_cents >= 0),
  CONSTRAINT machine_cost_rate_snapshots_hours_check CHECK (planned_hours > 0),
  CONSTRAINT machine_cost_rate_snapshots_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT machine_cost_rate_snapshots_components_check
    CHECK (jsonb_typeof(components) = 'array'),
  CONSTRAINT machine_cost_rate_snapshots_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT machine_cost_rate_snapshots_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_cost_rate_snapshots_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_cost_rate_snapshots_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_cost_rate_snapshots_machine_idx
  ON public.machine_cost_rate_snapshots (company_id, machine_id, computed_at DESC);

COMMENT ON TABLE public.machine_cost_rate_snapshots IS
  'Zamrznuta stopa (spec 05 §1.1.5): komponente + izračunata vrijednost u trenutku knjiženja. '
  'Promjena komponente NIKAD ne mijenja stari trošak — zato snapshot, a ne izračun pri čitanju.';

-- `project_cost_entries`: snapshot uz svaki proknjižen trošak + razlaganje po komponentama.
ALTER TABLE public.project_cost_entries
  ADD COLUMN IF NOT EXISTS rate_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS component_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS snapshot_id TEXT;

-- `source_type` se proširuje (spec 05 §1.1.6). Unikatnost ostaje jedna: jedan događaj, jedan trošak.
ALTER TABLE public.project_cost_entries
  DROP CONSTRAINT project_cost_entries_source_type_check;
ALTER TABLE public.project_cost_entries
  ADD CONSTRAINT project_cost_entries_source_type_check
    CHECK (source_type IN ('MACHINE_WORK_LOG', 'HAUL', 'FUEL_ENTRY', 'SERVICE_ORDER', 'MANUAL'));

/*
 * Zamrznuti snapshot se NE SMIJE prepisati: to je dokaz po kojem je trošak izračunat. Dozvoljen je
 * samo prvi upis (NULL → vrijednost); svaka kasnija izmjena je greška, ne „ispravka".
 */
CREATE OR REPLACE FUNCTION public.project_cost_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $cost_snapshot_immutable$
BEGIN
  IF OLD.rate_snapshot IS NOT NULL
     AND NEW.rate_snapshot IS DISTINCT FROM OLD.rate_snapshot THEN
    RAISE EXCEPTION 'COST_SNAPSHOT_IMMUTABLE'
      USING DETAIL = 'Zamrznuta stopa troška se ne može prepisati — ona je dokaz obračuna.';
  END IF;
  RETURN NEW;
END;
$cost_snapshot_immutable$;

CREATE TRIGGER project_cost_entries_snapshot_immutable
  BEFORE UPDATE ON public.project_cost_entries
  FOR EACH ROW EXECUTE FUNCTION public.project_cost_snapshot_immutable();

-- `machine_cost_rates` postaje RUČNA stopa (ostaje kao nadjačavanje, spec 05 §2).
ALTER TABLE public.machine_cost_rates
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reason TEXT;

/*
 * Backfill razloga za postojeće redove: R6.1 ravna stopa je UVIJEK bila ručni unos (nije bilo
 * komponenti iz kojih bi se izračunala), pa je `is_manual = true` tačan. Bez razloga bi novi CHECK
 * oborio migraciju na svakoj bazi koja već ima stopu — a to je svaka produkcijska.
 */
UPDATE public.machine_cost_rates
   SET reason = 'Migrirano iz R6.1 ravne stope; izvor je bio ručni unos.'
 WHERE reason IS NULL;

ALTER TABLE public.machine_cost_rates
  ADD CONSTRAINT machine_cost_rates_reason_check
    CHECK (NOT is_manual OR (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 10 AND 500));

COMMENT ON COLUMN public.machine_cost_rates.is_manual IS
  'Ručna stopa nadjačava izračunatu (spec 05 §1.1.4). Promjena ide u audit sa razlogom; ekran nudi '
  '„vrati na izračunato" (tada se red zatvara, ne briše).';

-- ---------------------------------------------------------------- 4. Gorivo: šifarnik cijena

CREATE TABLE public.fuel_prices (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,
  fuel_kind           TEXT NOT NULL,
  supplier_partner_id TEXT,
  price_cents         BIGINT NOT NULL,
  currency_code       TEXT NOT NULL,
  valid_from          DATE NOT NULL,
  note                TEXT,
  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fuel_prices_kind_check CHECK (fuel_kind IN ('DIESEL', 'PETROL', 'ADBLUE', 'LPG', 'OTHER')),
  CONSTRAINT fuel_prices_price_check CHECK (price_cents > 0),
  CONSTRAINT fuel_prices_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT fuel_prices_note_check CHECK (note IS NULL OR length(note) <= 500),
  CONSTRAINT fuel_prices_company_id_unique UNIQUE (company_id, id),
  -- Jedna cijena po vrsti goriva i datumu: dvije cijene istog dana nemaju značenje.
  CONSTRAINT fuel_prices_kind_date_unique UNIQUE (company_id, fuel_kind, valid_from),
  CONSTRAINT fuel_prices_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT fuel_prices_supplier_fk
    FOREIGN KEY (company_id, supplier_partner_id) REFERENCES public.partners(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fuel_prices_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX fuel_prices_lookup_idx
  ON public.fuel_prices (company_id, fuel_kind, valid_from DESC);

COMMENT ON TABLE public.fuel_prices IS
  'Šifarnik cijena goriva (spec 05 §1.3.10). Točenje PREDLAŽE cijenu po datumu; ured je može '
  'prepisati i tada zapis nosi price_source = MANUAL. Bez ovoga se cijena po litru pogađa.';

-- Cisterna (opciono po firmi, spec 05 §1.3.14). Spremno za Modul 10 (`warehouses` tipa `TANK`).
CREATE TABLE public.fuel_tanks (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  capacity_l      NUMERIC(12,2) NOT NULL,
  -- Očitano stanje, ne izvedeno: izvedeno stanje bi zahtijevalo sabiranje svih ulaza i izlaza pri
  -- svakom čitanju, a razlika između očitanog i izvedenog je upravo ono što treba vidjeti.
  current_l       NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_count_at   TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fuel_tanks_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT fuel_tanks_capacity_check CHECK (capacity_l > 0),
  CONSTRAINT fuel_tanks_current_check CHECK (current_l >= 0 AND current_l <= capacity_l),
  CONSTRAINT fuel_tanks_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT fuel_tanks_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT
);

CREATE INDEX fuel_tanks_company_idx ON public.fuel_tanks (company_id, name);

-- Točenje: izvor cijene, cisterna i oznaka odstupanja.
ALTER TABLE public.fuel_entries
  ADD COLUMN IF NOT EXISTS price_source TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS tank_id TEXT,
  -- Zašto `deviation_pct` a ne samo flag: upozorenje mora reći KOLIKO je odstupanje, inače
  -- „crveno" ne pomaže nikome da procijeni je li 25% ili 300%.
  ADD COLUMN IF NOT EXISTS deviation_pct NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS deviation_status TEXT,
  ADD COLUMN IF NOT EXISTS deviation_reason TEXT,
  ADD COLUMN IF NOT EXISTS deviation_note TEXT,
  ADD COLUMN IF NOT EXISTS deviation_reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS deviation_reviewed_at TIMESTAMPTZ;

ALTER TABLE public.fuel_entries
  ADD CONSTRAINT fuel_entries_price_source_check
    CHECK (price_source IN ('PRICE_LIST', 'MANUAL')),
  ADD CONSTRAINT fuel_entries_tank_fk
    FOREIGN KEY (company_id, tank_id) REFERENCES public.fuel_tanks(company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fuel_entries_deviation_status_check
    CHECK (deviation_status IS NULL OR deviation_status IN ('OPEN', 'EXPLAINED', 'DISMISSED')),
  /*
   * Objašnjenje je OBAVEZNO prije zatvaranja upozorenja (spec 05 §1.3.13): `OPEN` nema razlog,
   * `EXPLAINED`/`DISMISSED` ga imaju — šifrom i napomenom. Tako se upozorenje ne može „skloniti"
   * bez ijednog zapisanog razloga.
   */
  ADD CONSTRAINT fuel_entries_deviation_reason_check
    CHECK (
      (deviation_status IS NULL AND deviation_reason IS NULL)
      OR (deviation_status = 'OPEN' AND deviation_reason IS NULL)
      OR (deviation_status IN ('EXPLAINED', 'DISMISSED')
          AND deviation_reason IN ('BREAKDOWN', 'THEFT', 'MISREAD', 'OTHER')
          AND length(btrim(COALESCE(deviation_note, ''))) >= 10)
    ),
  -- Ko je pregledao i kada — samo za zatvorena upozorenja; `OPEN` nema pregleda.
  ADD CONSTRAINT fuel_entries_deviation_review_check
    CHECK (
      (deviation_status IS NULL AND deviation_reviewed_at IS NULL AND deviation_reviewed_by IS NULL)
      OR (deviation_status = 'OPEN' AND deviation_reviewed_at IS NULL AND deviation_reviewed_by IS NULL)
      OR (deviation_status IN ('EXPLAINED', 'DISMISSED')
          AND deviation_reviewed_at IS NOT NULL AND deviation_reviewed_by IS NOT NULL)
    );

CREATE INDEX fuel_entries_deviation_idx
  ON public.fuel_entries (company_id, deviation_status)
  WHERE deviation_status IS NOT NULL;

COMMENT ON COLUMN public.fuel_entries.deviation_status IS
  'Odstupanje potrošnje (spec 05 §1.3.13) se ne zatvara tiho: OPEN → EXPLAINED (razlog + napomena '
  '≥ 10 znakova) ili DISMISSED. Razlog je šifra, ne slobodan tekst.';

-- ---------------------------------------------------------------- 5. Stacionaža

ALTER TABLE public.route_segments
  -- Numerička kilometraža (spec 05 §1.4.16): zbir po dionici je izvedena količina koja ulazi u
  -- Modul 6; iz slobodnog teksta se ne sabira.
  ADD COLUMN IF NOT EXISTS from_km INTEGER,
  ADD COLUMN IF NOT EXISTS from_m  SMALLINT,
  ADD COLUMN IF NOT EXISTS to_km   INTEGER,
  ADD COLUMN IF NOT EXISTS to_m    SMALLINT;

ALTER TABLE public.route_segments
  ADD CONSTRAINT route_segments_from_km_check CHECK (from_km IS NULL OR from_km >= 0),
  ADD CONSTRAINT route_segments_to_km_check CHECK (to_km IS NULL OR to_km >= 0),
  ADD CONSTRAINT route_segments_from_m_check CHECK (from_m IS NULL OR from_m BETWEEN 0 AND 999),
  ADD CONSTRAINT route_segments_to_m_check CHECK (to_m IS NULL OR to_m BETWEEN 0 AND 999),
  -- Ili su OBA kraja numerička, ili nijedan: pola kilometraže je gore od nikakve, jer bi zbir
  -- dionica tiho izostavio tu dionicu.
  ADD CONSTRAINT route_segments_stationing_pair_check
    CHECK ((from_km IS NULL) = (to_km IS NULL)),
  ADD CONSTRAINT route_segments_stationing_meter_check
    CHECK ((from_km IS NULL) = (from_m IS NULL) AND (to_km IS NULL) = (to_m IS NULL)),
  -- Dionica ima smjer: kraj mora biti STROGO poslije početka.
  ADD CONSTRAINT route_segments_stationing_order_check
    CHECK (
      from_km IS NULL
      OR (to_km * 1000 + to_m) > (from_km * 1000 + from_m)
    );

-- ---------------------------------------------------------------- 6. Šabloni dnevnog pregleda

CREATE TABLE public.check_templates (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  category_id  TEXT,
  name         TEXT NOT NULL,
  -- Stavke: [{key, label, required, critical}]. Validacija je u trigeru jer Postgres ne dopušta
  -- podupit u CHECK-u (isti obrazac kao `ppe_templates` u F3).
  items        JSONB NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT check_templates_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT check_templates_items_check
    CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
  CONSTRAINT check_templates_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT check_templates_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT check_templates_category_fk
    FOREIGN KEY (company_id, category_id)
    REFERENCES public.equipment_categories(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT check_templates_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

/*
 * Jedan AKTIVAN šablon po kategoriji: dva šablona za istu kategoriju znače da radnik na terenu
 * ne zna koji je „pravi". Firma može imati više neaktivnih (istorija), ali jedan aktivan.
 */
CREATE UNIQUE INDEX check_templates_active_category_idx
  ON public.check_templates (company_id, category_id)
  WHERE is_active AND category_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.check_templates_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $check_templates_items$
DECLARE
  stavka JSONB;
BEGIN
  IF jsonb_array_length(NEW.items) > 60 THEN
    RAISE EXCEPTION 'CHECK_TEMPLATE_ITEMS_INVALID'
      USING DETAIL = 'Šablon može imati najviše 60 stavki.';
  END IF;
  FOR stavka IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    IF jsonb_typeof(stavka) <> 'object'
       OR NOT (stavka ? 'key') OR NOT (stavka ? 'label')
       OR length(btrim(COALESCE(stavka->>'key', ''))) = 0
       OR length(btrim(COALESCE(stavka->>'label', ''))) = 0
       OR jsonb_typeof(stavka->'required') <> 'boolean'
       OR jsonb_typeof(stavka->'critical') <> 'boolean' THEN
      RAISE EXCEPTION 'CHECK_TEMPLATE_ITEMS_INVALID'
        USING DETAIL = 'Svaka stavka ima key, label, required (bool) i critical (bool).';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$check_templates_items$;

CREATE TRIGGER check_templates_items_guard
  BEFORE INSERT OR UPDATE ON public.check_templates
  FOR EACH ROW EXECUTE FUNCTION public.check_templates_items_guard();

COMMENT ON TABLE public.check_templates IS
  'Šablon dnevnog pregleda po kategoriji mašine (spec 05 §1.5.20). Bez šablona radnik na terenu '
  'popunjava slobodna polja, pa se pregledi između mašina ne mogu porediti.';

ALTER TABLE public.machine_daily_checks
  ADD COLUMN IF NOT EXISTS template_id TEXT,
  ADD CONSTRAINT machine_daily_checks_template_fk
    FOREIGN KEY (company_id, template_id) REFERENCES public.check_templates(company_id, id) ON DELETE RESTRICT;

/*
 * Kritična `FAIL` stavka (spec 05 §1.5.22) traži fotografiju i otvara `machine_fault` — to se
 * provjerava SERVISOM, jer zahtijeva i prilog i novi red u drugoj tabeli. Ovdje je samo ono što
 * baza može sama: `checklist_json` mora imati oblik koji se može provjeriti po stavci.
 */
CREATE OR REPLACE FUNCTION public.machine_daily_checks_checklist_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $daily_checklist$
BEGIN
  IF jsonb_typeof(NEW.checklist_json) <> 'object' THEN
    RAISE EXCEPTION 'CHECKLIST_INVALID' USING DETAIL = 'checklist_json mora biti objekat {key: PASS|FAIL}.';
  END IF;
  RETURN NEW;
END;
$daily_checklist$;

CREATE TRIGGER machine_daily_checks_checklist_guard
  BEFORE INSERT OR UPDATE ON public.machine_daily_checks
  FOR EACH ROW EXECUTE FUNCTION public.machine_daily_checks_checklist_guard();

-- ---------------------------------------------------------------- 7. Kvarovi: prag i veza na pregled

ALTER TABLE public.machine_faults
  ADD COLUMN IF NOT EXISTS daily_check_id TEXT;

ALTER TABLE public.machine_faults
  ADD CONSTRAINT machine_faults_daily_check_fk
    FOREIGN KEY (company_id, daily_check_id)
    REFERENCES public.machine_daily_checks(company_id, id) ON DELETE RESTRICT;

CREATE INDEX machine_faults_daily_check_idx
  ON public.machine_faults (company_id, daily_check_id)
  WHERE daily_check_id IS NOT NULL;

COMMENT ON COLUMN public.machine_faults.daily_check_id IS
  'Kvar otvoren iz kritične FAIL stavke dnevnog pregleda (spec 05 §1.5.22). Veza je obavezna u tom '
  'toku: bez nje se ne zna koji pregled je kvar otkrio, a odluka o radu ostaje bez dokaza.';

-- ---------------------------------------------------------------- 8. Najam mašine

ALTER TABLE public.machines
  DROP CONSTRAINT machines_ownership_check;
ALTER TABLE public.machines
  ADD CONSTRAINT machines_ownership_check CHECK (ownership IN ('OWN', 'RENT', 'RENTED')),
  ADD COLUMN IF NOT EXISTS rental_partner_id TEXT,
  ADD COLUMN IF NOT EXISTS rental_rate_cents BIGINT,
  ADD COLUMN IF NOT EXISTS rental_basis TEXT,
  ADD COLUMN IF NOT EXISTS rental_from DATE,
  ADD COLUMN IF NOT EXISTS rental_to DATE;

ALTER TABLE public.machines
  ADD CONSTRAINT machines_rental_partner_fk
    FOREIGN KEY (company_id, rental_partner_id) REFERENCES public.partners(company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT machines_rental_basis_check
    CHECK (rental_basis IS NULL OR rental_basis IN ('PER_HOUR', 'PER_DAY', 'PER_MONTH')),
  ADD CONSTRAINT machines_rental_rate_check
    CHECK (rental_rate_cents IS NULL OR rental_rate_cents >= 0),
  ADD CONSTRAINT machines_rental_period_check
    CHECK (rental_to IS NULL OR rental_from IS NULL OR rental_to >= rental_from),
  /*
   * Unajmljena mašina MORA imati dobavljača i osnovu: bez toga trošak najma nema odakle da uđe u
   * stopu, pa bi mašina izgledala besplatna — a to je najgora vrsta greške u obračunu.
   */
  ADD CONSTRAINT machines_rental_fields_check
    CHECK (
      (ownership <> 'RENTED' AND rental_partner_id IS NULL AND rental_rate_cents IS NULL AND rental_basis IS NULL)
      OR (ownership = 'RENTED' AND rental_partner_id IS NOT NULL AND rental_rate_cents IS NOT NULL AND rental_basis IS NOT NULL)
    );

-- ---------------------------------------------------------------- 9. Dvostruka dodjela mašine

/*
 * R3 je već uvela preklapanje za `machine_id` (`project_assignments_machine_no_overlap`), ali
 * SAMO unutar istog projekta (indeks je po `project_id`). Modul 5 §1.7.27 traži GLOBALNU
 * zabranu: ista mašina ne može biti na DVA projekta u istom periodu. Zato nova, odvojena
 * provjera — postojeća ostaje kakva jeste (ne diramo je, jer je dio R3 ugovora).
 *
 * Iznimka ide kroz `usage_overrides` (Modul 2), a ne kroz „labaviji" indeks: iznimka mora biti
 * zapisana, sa razlogom i rokom.
 */
/*
 * `usage_overrides` je do sada imao samo `id` kao primarni ključ. Iznimka se veže po (firma, id),
 * pa taj par mora biti unikatan — inače FK može pokazati na iznimku DRUGE firme.
 */
ALTER TABLE public.usage_overrides
  ADD CONSTRAINT usage_overrides_company_id_unique UNIQUE (company_id, id);

ALTER TABLE public.project_assignments
  ADD COLUMN IF NOT EXISTS double_booking_override_id TEXT;

ALTER TABLE public.project_assignments
  ADD CONSTRAINT project_assignments_double_booking_override_fk
    FOREIGN KEY (company_id, double_booking_override_id)
    REFERENCES public.usage_overrides(company_id, id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.project_assignment_machine_global_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $machine_global$
DECLARE
  sukobi INTEGER;
BEGIN
  IF NEW.machine_id IS NULL OR NEW.voided_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Odobrena iznimka pušta preklapanje; ona je dokaz, ne prečica.
  IF NEW.double_booking_override_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.company_id || ':machine:' || NEW.machine_id, 0)
  );

  SELECT count(*) INTO sukobi
    FROM public.project_assignments a
   WHERE a.company_id = NEW.company_id
     AND a.machine_id = NEW.machine_id
     AND a.project_id <> NEW.project_id
     AND a.voided_at IS NULL
     AND a.from_date <= COALESCE(NEW.to_date, 'infinity'::date)
     AND NEW.from_date <= COALESCE(a.to_date, 'infinity'::date);

  IF sukobi > 0 THEN
    RAISE EXCEPTION 'MACHINE_DOUBLE_BOOKED'
      USING DETAIL = 'Ista mašina je već dodijeljena drugom projektu u periodu koji se preklapa.';
  END IF;
  RETURN NEW;
END;
$machine_global$;

CREATE TRIGGER project_assignments_machine_global_guard
  BEFORE INSERT OR UPDATE ON public.project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.project_assignment_machine_global_guard();

-- ---------------------------------------------------------------- 10. RLS na novim tabelama

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'machine_cost_components', 'machine_cost_rate_snapshots', 'fuel_prices', 'fuel_tanks', 'check_templates'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (company_id = current_setting(''app.company_id''::text, true)) WITH CHECK (company_id = current_setting(''app.company_id''::text, true))',
      t
    );
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (name)
VALUES ('20261124160000_f4_1_mehanizacija')
ON CONFLICT DO NOTHING;

COMMIT;
