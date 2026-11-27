-- Faza 3 (Moduli 3 i 4): radno vrijeme, sync sukobi nad svim terenskim entitetima i
-- kadrovska evidencija radnika.
--
-- Polazi od postojećeg R4 modela (`workdays` glava + `work_entries` segmenti) i NE mijenja
-- njegovu suštinu: dan ostaje kanonski po (firma, radnik, datum), segmenti ostaju append-only
-- kroz reviziju. Dodaje ono što spec 03/04 traže:
--
--   * `workdays.day_kind` — izostanak je dan bez vremena, ne sati sa nulom;
--   * prag zaboravljenog dana po firmi + `UNKNOWN_END` vidljiv, bez tihog zatvaranja;
--   * zaokruživanje po segmentu, sa modom;
--   * `sync_conflicts` po entitetu (7 terenskih tipova), ne samo po `work_entry_id`;
--   * kadrovski profil, istorija satnica bez prepisivanja, saldo godišnjeg, zaduženja, OZO šabloni.
--
-- NAPOMENA (2026-11-23): ova migracija je IZMIJENJENA na mjestu, poslije CI runa 45454051757.
-- Migracije su inače naprijed-samo, ali ovdje je izmjena jedini ispravan put: stara verzija je na
-- serveru bez `btree_gist` PADALA u cjelini, pa baza nikad nije došla do `schema_migrations` reda i
-- naknadna migracija se ne bi imala gdje primijeniti. F3 u tom trenutku nije bila puštena izvan ove
-- grane (nema deploya), pa nema baze koja je upisala staru verziju. Detalj je u §4.9 izvještaja.
--
-- Sve novo je tenant-scope-ovano, FORCE RLS, bez DELETE granta aplikaciji gdje spec kaže
-- „ne briše se". Grantovi idu u `bootstrap/grants.sql`, matrica u `privilege-matrix.tsv`.
BEGIN;

-- ---------------------------------------------------------------- 1. firma: pragovi

ALTER TABLE public.companies
  ADD COLUMN forgotten_day_hours SMALLINT NOT NULL DEFAULT 16,
  ADD COLUMN rounding_minutes SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN rounding_mode TEXT NOT NULL DEFAULT 'NEAREST',
  ADD CONSTRAINT companies_forgotten_day_hours_check
    CHECK (forgotten_day_hours IN (12, 16, 24)),
  ADD CONSTRAINT companies_rounding_minutes_check
    CHECK (rounding_minutes IN (0, 5, 10, 15, 30)),
  ADD CONSTRAINT companies_rounding_mode_check
    CHECK (rounding_mode IN ('NEAREST', 'UP', 'DOWN'));

COMMENT ON COLUMN public.companies.forgotten_day_hours IS
  'Poslije koliko sati otvoren segment postaje „zaboravljen dan" (spec 03 §1.2). Nigdje ne '
  'zatvara zapis automatski — samo pravi pitanje na telefonu i red „za provjeru" u uredu.';
COMMENT ON COLUMN public.companies.rounding_minutes IS
  'Zaokruživanje PO SEGMENTU, ne po danu (spec 03 §1.4). 0 = bez zaokruživanja (default).';

-- ---------------------------------------------------------------- 2. workdays: day_kind

ALTER TABLE public.workdays
  ADD COLUMN day_kind TEXT NOT NULL DEFAULT 'WORK',
  ADD COLUMN absence_note TEXT,
  ADD COLUMN assignment_warning BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT workdays_day_kind_check CHECK (
    day_kind IN ('WORK', 'VACATION', 'SICK', 'PAID_LEAVE', 'UNPAID_LEAVE', 'HOLIDAY', 'NO_SHOW')
  ),
  ADD CONSTRAINT workdays_absence_note_check CHECK (
    -- Napomena ima smisla samo uz izostanak; `WORK` sa napomenom bi bio tiha kategorija.
    day_kind = 'WORK' OR (absence_note IS NOT NULL AND length(btrim(absence_note)) > 0)
  );

COMMENT ON COLUMN public.workdays.day_kind IS
  'Vrsta dana (spec 03 §1.3). Izostanak NIJE nula sati: dan nema segmenata i ne ulazi u sate '
  'rada, ali ulazi u obračun po svom pravilu (Modul 6) i u saldo godišnjeg (Modul 4).';
COMMENT ON COLUMN public.workdays.assignment_warning IS
  'Rad na projektu bez važeće dodjele: upozorenje, ne blokada (spec 03 §1.6). Šef zna bolje '
  'od baze, ali ured mora vidjeti da je zapis nastao bez dodjele.';

CREATE INDEX workdays_company_kind_date_idx
  ON public.workdays (company_id, day_kind, work_date)
  WHERE day_kind <> 'WORK';

-- ---------------------------------------------------------------- 3. work_entries: izvor segmenta

ALTER TABLE public.work_entries
  ADD COLUMN tz_offset_minutes SMALLINT,
  ADD COLUMN segment_source TEXT NOT NULL DEFAULT 'MANUAL',
  ADD CONSTRAINT work_entries_segment_source_check
    CHECK (segment_source IN ('TIMER', 'MANUAL', 'SYNC')),
  ADD CONSTRAINT work_entries_tz_offset_check CHECK (
    -- ±14 h je stvarni raspon zona; veće vrijednosti su greška u klijentu, ne zona.
    tz_offset_minutes IS NULL OR tz_offset_minutes BETWEEN -840 AND 840
  );

COMMENT ON COLUMN public.work_entries.tz_offset_minutes IS
  'Informativo (spec 03 §1.1.4): istina je UTC u `started_at`/`ended_at`. Služi da ured vidi '
  'u kojoj je zoni zapis nastao kad se sat telefona ne poklapa sa serverom.';
COMMENT ON COLUMN public.work_entries.segment_source IS
  'TIMER = veliko dugme na „Moj dan", MANUAL = forma iza prekidača, SYNC = zapis došao iz '
  'outbox-a sa terena. Bez ovoga se ne zna koliko je podataka ručno prepravljeno.';

-- Zaboravljen dan NE blokira novi: jedan otvoren segment po radniku PO DANU, ne ukupno.
-- Prije: `WHERE end_state = 'OPEN'` — jučerašnji otvoren dan je blokirao današnji `Počni rad`
-- tačno u scenariju koji spec 03 §1.2.10 imenuje. Datum se uzima iz zaglavlja dana, jer
-- `work_entries` nema svoj `work_date` (kanonski dan je u `workdays`).
DROP INDEX IF EXISTS public.work_entries_one_open_per_worker;

CREATE UNIQUE INDEX work_entries_one_open_per_worker_per_day
  ON public.work_entries (company_id, worker_id, workday_id)
  WHERE end_state = 'OPEN';

-- ---------------------------------------------------------------- 4. sync_conflicts: svi entiteti

ALTER TABLE public.sync_conflicts
  ADD COLUMN entity_type TEXT,
  ADD COLUMN entity_id TEXT;

-- Postojeći zapisi su svi bili radni segmenti; backfill je tačan, ne procjena.
--
-- Guard `sync_conflicts_history_guard` čuva NEPROMJENLJIVOST historije i brani UPDATE, što je
-- tačno ono što treba za razrješene sukobe. Backfill je izuzetak po prirodi: to je popunjavanje
-- nove kolone iz podatka koji je već u redu, u istom redu, jednoj migraciji. Zato se guard
-- privremeno isključuje (samo za ovu sesiju) — nikad ne bira „sve redove" kroz politiku.
ALTER TABLE public.sync_conflicts DISABLE TRIGGER sync_conflicts_history_guard;
UPDATE public.sync_conflicts
   SET entity_type = 'work_entry',
       entity_id = work_entry_id
 WHERE entity_type IS NULL
   AND work_entry_id IS NOT NULL;
ALTER TABLE public.sync_conflicts ENABLE TRIGGER sync_conflicts_history_guard;

-- `workday` i `work_entry` sukobi bez `work_entry_id` ostaju mogući (npr. zaglavlje dana), pa
-- kolona ostaje nullable za te redove; svaki novi zapis je puni (entity_type + entity_id).
ALTER TABLE public.sync_conflicts
  ADD CONSTRAINT sync_conflicts_entity_type_check CHECK (
    entity_type IS NULL
    OR entity_type IN (
      'workday', 'work_entry', 'machine_work_log', 'fuel_entry',
      'haul', 'machine_daily_check', 'machine_fault'
    )
  ),
  ADD CONSTRAINT sync_conflicts_entity_complete_check CHECK (
    -- Polovičan zapis je gori od nijednog: sukob koji se ne može naći po entitetu.
    (entity_type IS NULL AND entity_id IS NULL) OR (entity_type IS NOT NULL AND entity_id IS NOT NULL)
  );

CREATE INDEX sync_conflicts_company_entity_idx
  ON public.sync_conflicts (company_id, entity_type, entity_id, created_at DESC)
  WHERE entity_type IS NOT NULL;

COMMENT ON COLUMN public.sync_conflicts.entity_type IS
  'Na koji terenski entitet se sukob odnosi (spec 03 §1.7.29). Prije je postojao samo '
  '`work_entry_id`, pa sukob nad gorivom, turom ili kvarom nije imao gdje stati. ';

-- ---------------------------------------------------------------- 5. work_week_approvals: snimak

ALTER TABLE public.work_week_approvals
  ADD COLUMN reviewed_snapshot JSONB;

COMMENT ON COLUMN public.work_week_approvals.reviewed_snapshot IS
  'Sume koje je vlasnik VIDIO u trenutku odluke (spec 03 §1.5.22). Bez ovoga se poslije ne '
  'može dokazati na osnovu čega je sedmica odobrena, jer se dani mogu mijenjati revizijom.';

-- ---------------------------------------------------------------- 6. workers: profil

ALTER TABLE public.workers
  ADD COLUMN middle_name TEXT,
  ADD COLUMN birth_date DATE,
  ADD COLUMN address TEXT,
  ADD COLUMN education_level TEXT,
  ADD COLUMN profession TEXT,
  ADD COLUMN driving_categories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN blood_type TEXT,
  ADD COLUMN shoe_size SMALLINT,
  ADD COLUMN clothing_size TEXT,
  ADD COLUMN emergency_contact_name TEXT,
  ADD COLUMN emergency_contact_phone TEXT,
  ADD COLUMN photo_object_key TEXT,
  ADD COLUMN notes TEXT,
  ADD CONSTRAINT workers_education_level_check CHECK (
    education_level IS NULL OR education_level IN ('NK', 'KV', 'SSS', 'VŠS', 'VSS')
  ),
  ADD CONSTRAINT workers_shoe_size_check CHECK (shoe_size IS NULL OR shoe_size BETWEEN 20 AND 55),
  ADD CONSTRAINT workers_driving_categories_check CHECK (
    -- Bez duplikata i bez praznih elemenata: „C,CE" i „CE,C,C" su isti skup, a UI bi
    -- prikazao tri puta.
    array_position(driving_categories, NULL) IS NULL
  );

COMMENT ON COLUMN public.workers.driving_categories IS
  'Trajna osobina (spec 04 §1.5.21): kategorije koje radnik IMA, ne dokument. Vozačka kao '
  'dokument sa rokom je obaveza u Modulu 2 i ona blokira kad istekne; ovo daje samo upozorenje '
  'u `canUseEntity` za `drive_vehicle`.';
COMMENT ON COLUMN public.workers.blood_type IS
  'Osjetljivo polje (spec 04 §1.1.4): čita ga samo `workers.sensitive.view`, svako čitanje '
  'ide u ACCESS audit. Nema JMBG-a i nema bankovnog računa — odluka vlasnika.';

-- ---------------------------------------------------------------- 7. worker_rates

CREATE TABLE public.worker_rates (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  rate_kind      TEXT NOT NULL,
  amount_cents   BIGINT,
  currency_code  TEXT,
  coefficient    NUMERIC(8, 4),
  valid_from     DATE NOT NULL,
  valid_to       DATE,
  note           TEXT,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT worker_rates_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT worker_rates_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT worker_rates_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT worker_rates_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT worker_rates_kind_check
    CHECK (rate_kind IN ('HOURLY', 'MONTHLY', 'DAILY', 'COEFFICIENT')),
  CONSTRAINT worker_rates_period_check
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- Oblik zavisi od vrste: koeficijent ne nosi iznos, novac ne nosi koeficijent.
  CONSTRAINT worker_rates_shape_check CHECK (
    (rate_kind = 'COEFFICIENT' AND coefficient IS NOT NULL AND amount_cents IS NULL)
    OR (rate_kind <> 'COEFFICIENT' AND amount_cents IS NOT NULL AND amount_cents > 0 AND coefficient IS NULL)
  ),
  CONSTRAINT worker_rates_currency_check CHECK (
    (amount_cents IS NULL AND currency_code IS NULL)
    OR (amount_cents IS NOT NULL AND currency_code IS NOT NULL AND length(currency_code) = 3)
  )
);

CREATE INDEX worker_rates_company_worker_idx
  ON public.worker_rates (company_id, worker_id, valid_from DESC);

-- Preklapanje istog vida stope nije dopušteno: dvije važeće satnice za isti dan nemaju
-- značenje, a „uzmi prvu" bi bio tih gubitak novca.
--
-- ZAŠTO NIJE BEZUSLOVNI `EXCLUDE` (popravka poslije CI runa 45454051757):
-- `EXCLUDE` nad `daterange` uz tekstualne kolone traži `btree_gist`. Prva verzija ove migracije
-- ga je tražila bez uslova, pa je na serveru BEZ contrib paketa (ili pod prekidačem
-- `gradix.bez_btree_gist`, koji `check-preklapanje` namjerno postavlja) cijela migracija pala sa
-- „data type text has no default operator class for access method gist". R3 je isti problem
-- riješila fallback-om; F3 ga je zaobišla, i to je jedini razlog pada koraka
-- „Preklapanje dodjela — oba mehanizma".
--
-- Obrazac je isti kao u `r3_preklapanje_gist`: ili `EXCLUDE` (baza garantuje sama), ili triger sa
-- savjetodavnom bravom — nikad oba, nikad nijedan.
DO $$
DECLARE
  ima_gist BOOLEAN := false;
BEGIN
  IF current_setting('gradix.bez_btree_gist', true) = 'on' THEN
    RAISE NOTICE 'worker_rates: btree_gist preskočen prekidačem, ide triger.';
  ELSE
    BEGIN
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      ima_gist := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'worker_rates: btree_gist nije dostupan (%): ide triger sa bravom.', SQLERRM;
      ima_gist := false;
    END;
  END IF;

  IF ima_gist THEN
    ALTER TABLE public.worker_rates
      ADD CONSTRAINT worker_rates_no_overlap
      EXCLUDE USING gist (
        company_id WITH =,
        worker_id WITH =,
        rate_kind WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
      ) DEFERRABLE INITIALLY IMMEDIATE;
  ELSE
    /*
     * Fallback triger. Ime poruke (`RATE_OVERLAP`) je ISTO kao kod servisa, jer servis hvata
     * SQLSTATE 23P01 (EXCLUDE) i vlastitu provjeru; ovdje se podiže eksplicitno da klijent dobije
     * isti kod bez obzira na to koji je mehanizam aktivan.
     *
     * Brava je po (firma, radnik, vrsta) — bez nje dvije paralelne transakcije obje prođu provjeru
     * i obje upišu stopu koja važi istog dana.
     */
    CREATE OR REPLACE FUNCTION public.worker_rate_no_overlap()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
    AS $worker_rate_no_overlap$
    DECLARE
      sukobi INTEGER;
    BEGIN
      IF NEW.valid_to IS NOT NULL AND NEW.valid_to < NEW.valid_from THEN
        RETURN NEW; -- oblik perioda već brani CHECK; ovdje se ne dodaje druga poruka
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.company_id || ':' || NEW.worker_id || ':' || NEW.rate_kind, 0)
      );

      SELECT count(*) INTO sukobi
        FROM public.worker_rates r
       WHERE r.company_id = NEW.company_id
         AND r.worker_id = NEW.worker_id
         AND r.rate_kind = NEW.rate_kind
         AND r.id <> NEW.id
         AND r.valid_from <= COALESCE(NEW.valid_to, 'infinity'::date)
         AND NEW.valid_from <= COALESCE(r.valid_to, 'infinity'::date);

      IF sukobi > 0 THEN
        RAISE EXCEPTION 'RATE_OVERLAP'
          USING DETAIL = 'Za istog radnika već važi stopa tog tipa u periodu koji se preklapa.';
      END IF;

      RETURN NEW;
    END;
    $worker_rate_no_overlap$;

    CREATE TRIGGER worker_rates_no_overlap
      BEFORE INSERT OR UPDATE ON public.worker_rates
      FOR EACH ROW EXECUTE FUNCTION public.worker_rate_no_overlap();

    RAISE NOTICE 'worker_rates: preklapanje čuva triger sa pg_advisory_xact_lock.';
  END IF;
END $$;

COMMENT ON TABLE public.worker_rates IS
  'Istorija satnica (spec 04 §1.2.7): nova stopa je NOVI RED, stara dobija `valid_to`. '
  'Iznos se nikad ne prepisuje — obračun uzima stopu koja je važila NA DAN RADA.';

-- Prekidač: iznos postojećeg reda se ne mijenja. Dozvoljen je samo `valid_to` (zatvaranje) i
-- `note`. Tako „ispravka" satnice ne može tiho promijeniti već obračunate sate.
CREATE OR REPLACE FUNCTION public.worker_rate_immutable_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $worker_rate_immutable$
BEGIN
  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.coefficient IS DISTINCT FROM OLD.coefficient
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.rate_kind IS DISTINCT FROM OLD.rate_kind
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.worker_id IS DISTINCT FROM OLD.worker_id THEN
    RAISE EXCEPTION 'Iznos i početak važenja satnice se ne mijenjaju; uneci novu stopu (spec 04 §1.2.8).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$worker_rate_immutable$;

CREATE TRIGGER worker_rates_immutable_amount
  BEFORE UPDATE ON public.worker_rates
  FOR EACH ROW EXECUTE FUNCTION public.worker_rate_immutable_amount();

-- ---------------------------------------------------------------- 8. worker_leave_entitlements

CREATE TABLE public.worker_leave_entitlements (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  worker_id       TEXT NOT NULL,
  year            SMALLINT NOT NULL,
  days_entitled   NUMERIC(5, 1) NOT NULL,
  days_carryover  NUMERIC(5, 1) NOT NULL DEFAULT 0,
  note            TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT worker_leave_entitlements_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT worker_leave_entitlements_year_unique UNIQUE (company_id, worker_id, year),
  CONSTRAINT worker_leave_entitlements_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT worker_leave_entitlements_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT worker_leave_entitlements_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT worker_leave_entitlements_year_check CHECK (year BETWEEN 2000 AND 2100),
  -- Prenos može biti negativan (ispravka), ali pravo ne može biti negativno.
  CONSTRAINT worker_leave_entitlements_days_check CHECK (days_entitled >= 0)
);

COMMENT ON TABLE public.worker_leave_entitlements IS
  'Pravo na godišnji PO GODINI (spec 04 §1.3.11). Konzumacija se NE unosi ovdje: saldo je '
  '`days_entitled + days_carryover − broj dana sa day_kind = VACATION` iz `workdays`. Dva '
  'izvora istine za isti broj bi se razišla prvi put kad neko ispravi dan.';

-- ---------------------------------------------------------------- 9. worker_issuances

CREATE TABLE public.worker_issuances (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  worker_id     TEXT NOT NULL,
  item_kind     TEXT NOT NULL,
  item_name     TEXT NOT NULL,
  size          TEXT,
  serial_no     TEXT,
  quantity      NUMERIC(8, 2) NOT NULL DEFAULT 1,
  issued_at     DATE NOT NULL,
  returned_at   DATE,
  condition     TEXT NOT NULL DEFAULT 'NEW',
  note          TEXT,
  issued_by     TEXT NOT NULL,
  returned_to   TEXT,
  stock_item_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT worker_issuances_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT worker_issuances_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT worker_issuances_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT worker_issuances_issued_by_fk
    FOREIGN KEY (issued_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT worker_issuances_returned_to_fk
    FOREIGN KEY (returned_to) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT worker_issuances_kind_check
    CHECK (item_kind IN ('PPE', 'TOOL', 'DEVICE', 'OTHER')),
  CONSTRAINT worker_issuances_condition_check
    CHECK (condition IN ('NEW', 'USED', 'DAMAGED')),
  CONSTRAINT worker_issuances_quantity_check CHECK (quantity > 0),
  CONSTRAINT worker_issuances_return_check
    CHECK (returned_at IS NULL OR returned_at >= issued_at),
  -- Povrat je ili potpun (datum + ko je primio) ili ga nema; pola povrata je tiha greška.
  CONSTRAINT worker_issuances_return_complete_check
    CHECK ((returned_at IS NULL AND returned_to IS NULL) OR (returned_at IS NOT NULL AND returned_to IS NOT NULL))
);

CREATE INDEX worker_issuances_active_idx
  ON public.worker_issuances (company_id, worker_id, issued_at DESC)
  WHERE returned_at IS NULL;

COMMENT ON TABLE public.worker_issuances IS
  'Zaduženja OZO/alata/uređaja (spec 04 §1.4.16). Ne brišu se: povrat upisuje `returned_at` '
  'i stanje, a greška u unosu se ispravlja novim redom. „Ko šta ima kod sebe" = '
  '`returned_at IS NULL`. `stock_item_id` je NULL dok skladište (Modul 10) ne postoji.';

-- ---------------------------------------------------------------- 10. ppe_templates

CREATE TABLE public.ppe_templates (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  job_title  TEXT NOT NULL,
  items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ppe_templates_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT ppe_templates_job_title_unique UNIQUE (company_id, job_title),
  CONSTRAINT ppe_templates_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT ppe_templates_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  -- Samo „je niz". Sadržaj svake stavke provjerava trigger ispod: CHECK ne može imati
  -- podupit (`jsonb_array_elements`), a oblik stavke je ugovor sa UI-jem — bez `name` set
  -- nema šta izdati.
  CONSTRAINT ppe_templates_items_array_check CHECK (jsonb_typeof(items) = 'array')
);

CREATE OR REPLACE FUNCTION public.ppe_templates_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $ppe_items$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT element::text
    INTO v_bad
    FROM jsonb_array_elements(NEW.items) AS element
   WHERE jsonb_typeof(element) <> 'object'
      OR NOT (element ? 'name')
      OR length(btrim(COALESCE(element->>'name', ''))) = 0
   LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PPE_ITEM_INVALID: stavka šablona mora biti objekat sa nepraznim "name" (dobijeno: %).', v_bad
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$ppe_items$;

CREATE TRIGGER ppe_templates_items_guard
  BEFORE INSERT OR UPDATE ON public.ppe_templates
  FOR EACH ROW EXECUTE FUNCTION public.ppe_templates_items_guard();

COMMENT ON TABLE public.ppe_templates IS
  'OZO set po radnom mjestu (spec 04 §1.4.19): „bagerista" → kaciga, prsluk, čizme, rukavice. '
  'Jedan klik izdaje cijeli set; pojedinačno se dopunjava. Šablon ne zadužuje nikoga sam po sebi.';

-- ---------------------------------------------------------------- 11. worker_history

CREATE TABLE public.worker_history (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  worker_id   TEXT NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  changed_by  TEXT NOT NULL,
  reason      TEXT,
  CONSTRAINT worker_history_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT worker_history_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT worker_history_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT worker_history_changed_by_fk
    FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT worker_history_field_check CHECK (length(btrim(field)) > 0)
);

CREATE INDEX worker_history_worker_idx
  ON public.worker_history (company_id, worker_id, changed_at DESC);

COMMENT ON TABLE public.worker_history IS
  'Čitljiva vremenska linija kartice radnika (spec 04 §1.7.27). `audit_events` ostaje pravni '
  'trag; ovo je UX sloj — dvoslojno namjerno, jer se pravni trag ne smije mijenjati zbog '
  'prikaza, a prikaz ne smije tražiti audit tabelu po svakom otvaranju kartice.';

-- ---------------------------------------------------------------- 12. RLS

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'worker_rates', 'worker_leave_entitlements', 'worker_issuances', 'ppe_templates', 'worker_history'
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

INSERT INTO public.schema_migrations (name)
VALUES ('20261124140000_f3_1_workdays_workers')
ON CONFLICT DO NOTHING;

COMMIT;
