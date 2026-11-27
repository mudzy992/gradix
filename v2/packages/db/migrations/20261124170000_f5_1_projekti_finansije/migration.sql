-- =============================================================================
-- FAZA 5 (Modul 6, `06-projekti-budzet-troskovi.md`) — projekat kao FINANSIJSKI kontejner:
-- faze sa težinama, budžet sa revizijama, JEDAN ledger troška, predmjer, aneksi, zadaci,
-- pragovi upozorenja i zatvaranje projekta.
--
-- Polazi od stanja poslije F4: `projects` je kartica gradilišta, `project_cost_entries` poznaje
-- SAMO `MACHINE_WORK_LOG` i puni se RUČNIM dugmetom (`bookProjectCosts`). Ovim se taj model
-- zamjenjuje događajnim knjiženjem i jednim ledgerom za sve izvore.
--
-- Odluke koje se ne smiju izgubiti (spec 06 §1):
--   * trošak se knjiži DOGAĐAJEM (promjena statusa izvora), nikad dugmetom;
--   * jedan događaj = jedan trošak — djelimični unikat `(company_id, source_type, source_id)
--     WHERE status <> 'REVERSED'`;
--   * storno, ne brisanje: original `REVERSED`, novi `POSTED` red nosi razlog;
--   * `PENDING` = trošak postoji, cijena još ne — NIJE nula i ne ulazi u zbroj;
--   * budžet se NIKAD ne prepisuje: promjena je nova revizija;
--   * `FINISHED` blokira nova knjiženja; ponovno otvaranje je eksplicitna, auditovana radnja.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. Projekat kao kontejner

ALTER TABLE public.projects
  /* Vrijednost ugovora: osnov za maržu (spec 06 §1.8.29). Bez nje marža nema od čega da se
     računa, a „profitabilnost“ bi bila samo trošak. */
  ADD COLUMN IF NOT EXISTS contract_value_cents BIGINT,
  ADD COLUMN IF NOT EXISTS currency_code TEXT,
  /* Izvor napretka je PODATAK po projektu, ne podešavanje: `MANUAL` i `BOQ` se ne smiju
     miješati u istom projektu (spec 06 §1.4.19), pa se bira jednom i vrijedi do kraja. */
  ADD COLUMN IF NOT EXISTS progress_source TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by TEXT,
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

/* Postojeći `FINISHED` redovi nemaju `closed_at`. Bez backfill-a novi CHECK pada na svakoj bazi
   koja već ima završen projekat — a takva baza je svaka produkcijska. Backfill je OVDJE, prije
   constrainta, jer se constraint provjerava nad postojećim redovima odmah. */
UPDATE public.projects
   SET closed_at = COALESCE(updated_at, now())
 WHERE status = 'FINISHED' AND closed_at IS NULL;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_progress_source_check
    CHECK (progress_source IN ('MANUAL', 'BOQ')),
  ADD CONSTRAINT projects_contract_value_check
    CHECK (contract_value_cents IS NULL OR contract_value_cents >= 0),
  /* Iznos bez valute i valuta bez iznosa su oba nedovršen podatak — isti obrazac kao
     `service_orders_amount_pair_check`. */
  ADD CONSTRAINT projects_currency_pair_check
    CHECK ((contract_value_cents IS NULL) = (currency_code IS NULL)),
  ADD CONSTRAINT projects_currency_check
    CHECK (currency_code IS NULL OR char_length(currency_code) = 3),
  /* `closed_at` je jedini dokaz da je projekat zatvoren; status bez njega bi bio tvrdnja bez
     zapisa, a datum bez statusa bi blokirao knjiženje bez razloga koji se vidi. */
  ADD CONSTRAINT projects_closed_check
    CHECK ((closed_at IS NOT NULL) = (status = 'FINISHED')),
  ADD CONSTRAINT projects_closed_by_fk
    FOREIGN KEY (closed_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT projects_reopen_reason_check
    CHECK (reopen_reason IS NULL OR length(btrim(reopen_reason)) >= 10);

-- ---------------------------------------------------------------- 2. Faze

CREATE TABLE public.project_phases (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  /* Težina je OBAVEZNA i ≥ 1: faza bez težine nema uticaj na ukupni % (spec 06 §1.1.2), pa bi
     tiho ispala iz izračuna i projekat bi izgledao završeniji nego što jeste. */
  weight        INTEGER NOT NULL DEFAULT 1,
  planned_start DATE,
  planned_end   DATE,
  actual_start  DATE,
  actual_end    DATE,
  progress_pct  SMALLINT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'PLANNED',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by    TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by    TEXT NOT NULL,
  CONSTRAINT project_phases_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT project_phases_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT project_phases_weight_check CHECK (weight BETWEEN 1 AND 1000),
  CONSTRAINT project_phases_progress_check CHECK (progress_pct BETWEEN 0 AND 100),
  CONSTRAINT project_phases_status_check
    CHECK (status IN ('PLANNED', 'ACTIVE', 'DONE', 'CANCELLED')),
  CONSTRAINT project_phases_planned_period_check
    CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
  CONSTRAINT project_phases_actual_period_check
    CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start),
  /* Završena faza je 100 %. Bez ovoga bi `DONE` faza sa 40 % ulazila u ukupni napredak sa 40 %
     i projekat nikad ne bi došao do 100 % iako su sve faze završene. */
  CONSTRAINT project_phases_done_check
    CHECK (status <> 'DONE' OR (progress_pct = 100 AND actual_end IS NOT NULL)),
  CONSTRAINT project_phases_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT project_phases_project_code_unique UNIQUE (company_id, project_id, code),
  CONSTRAINT project_phases_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT project_phases_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT project_phases_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT project_phases_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX project_phases_project_idx
  ON public.project_phases (company_id, project_id, sort_order, code);

COMMENT ON TABLE public.project_phases IS
  'Faze projekta (spec 06 §1.1). Ukupni napredak = Σ(progress_pct × weight)/Σ(weight) — računa '
  'se u domeni, ne čuva se, jer bi čuvan broj mogao odstupiti od faza iz kojih je nastao.';

-- Zavisnosti faza: samo upozorenje, nikad blokada (spec 06 §1.1.4). Zato nema trigera koji
-- zabranjuje pomjeranje — samo zapis o tome šta od čega zavisi.
CREATE TABLE public.phase_dependencies (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  phase_id          TEXT NOT NULL,
  depends_on_phase_id TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'START_AFTER_FINISH',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by        TEXT NOT NULL,
  -- Faza ne može zavisiti od same sebe; ciklusi se provjeravaju u servisu (tabela bi za to
  -- tražila rekurzivni triger, a poruka „ciklus“ je korisnija od „constraint violated“).
  CONSTRAINT phase_dependencies_self_check CHECK (phase_id <> depends_on_phase_id),
  CONSTRAINT phase_dependencies_kind_check
    CHECK (kind IN ('START_AFTER_FINISH', 'START_AFTER_START', 'FINISH_AFTER_FINISH')),
  CONSTRAINT phase_dependencies_unique UNIQUE (company_id, phase_id, depends_on_phase_id),
  CONSTRAINT phase_dependencies_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT phase_dependencies_phase_fk
    FOREIGN KEY (company_id, phase_id) REFERENCES public.project_phases(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT phase_dependencies_depends_fk
    FOREIGN KEY (company_id, depends_on_phase_id) REFERENCES public.project_phases(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT phase_dependencies_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------- 3. Kategorije troška

CREATE TABLE public.cost_categories (
  id                      TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL,
  code                    TEXT NOT NULL,
  name                    TEXT NOT NULL,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  /* Mapiranje izvor → kategorija (spec 06 §1.3.14). Firma ga prepisuje; jedan izvor može imati
     TAČNO jednu zadanu kategoriju, jer dvije „zadane“ nemaju značenje. */
  default_for_source_type TEXT,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  /* `SET NULL`, a ne `RESTRICT`: kategorija je KONFIGURACIJA firme, ne dokaz o korisniku — za
     razliku od ledgera i audita. Brisanje naloga ne smije ostaviti firmu koja ne može ništa
     knjižiti; isti obrazac kao `companies.settings_updated_by`. */
  created_by              TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by              TEXT,
  CONSTRAINT cost_categories_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT cost_categories_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT cost_categories_source_check
    CHECK (default_for_source_type IS NULL OR default_for_source_type IN
      ('WORKDAY', 'MACHINE_WORK_LOG', 'FUEL_ENTRY', 'HAUL', 'SERVICE_ORDER',
       'PURCHASE', 'SUBCONTRACTOR', 'MANUAL')),
  CONSTRAINT cost_categories_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT cost_categories_company_code_unique UNIQUE (company_id, code),
  /* `CASCADE` na firminoj strani: kategorije su KONFIGURACIJA te firme i bez nje ne znače ništa.
     Ledger i audit ostaju `RESTRICT` — finansijski dokaz se ne briše kao posljedica. */
  CONSTRAINT cost_categories_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  CONSTRAINT cost_categories_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT cost_categories_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL
);

/* Djelimični unikat: samo JEDNA aktivna zadana kategorija po izvoru. Dvije bi značile da
   knjiženje zavisi od reda u kojem se čitaju — a to je tihi gubitak tačnosti, ne greška. */
CREATE UNIQUE INDEX cost_categories_default_source_unique
  ON public.cost_categories (company_id, default_for_source_type)
  WHERE default_for_source_type IS NOT NULL;

COMMENT ON TABLE public.cost_categories IS
  'Šifarnik kategorija troška PO FIRMI (spec 06 §1.2.6) — nije enum, jer firma dodaje svoje. '
  '`default_for_source_type` je mapiranje koje knjiženje koristi kad izvor ne nosi kategoriju.';

-- Početni set kategorija za SVAKU novu firmu. Trigger, a ne onboarding: firma se kreira i kroz
-- platformu i kroz seed, a zaboravljen poziv bi ostavio firmu bez ijedne kategorije — pa bi
-- prvo knjiženje troška palo na „nema kategorije“.
CREATE OR REPLACE FUNCTION public.seed_cost_categories(p_company_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $seed_cost_categories$
BEGIN
  /* `created_by`/`updated_by` su NOT NULL, a firma tijekom onboardinga ima vlasnika tek kad
     prihvati pozivnicu. Zato se autor čita JEDNOM (CTE), pa se ili upiše cijeli set, ili nijedan
     red — polovičan set sa izmišljenim nalogom nije opcija. Servis dopunjava set pri prvom
     knjiženju kad vlasnik postoji. */
  WITH first_member AS (
    SELECT m.user_id
      FROM public.memberships m
     WHERE m.company_id = p_company_id
     ORDER BY m.created_at, m.user_id
     LIMIT 1
  )
  INSERT INTO public.cost_categories
    (id, company_id, code, name, sort_order, default_for_source_type, created_by, updated_by)
  SELECT
    'cc_' || replace(gen_random_uuid()::text, '-', ''),
    p_company_id,
    seed.code,
    seed.name,
    seed.sort_order,
    seed.source_type,
    first_member.user_id,
    first_member.user_id
  FROM (VALUES
    ('RAD', 'Rad', 10, 'WORKDAY'),
    ('MEHANIZACIJA', 'Mehanizacija', 20, 'MACHINE_WORK_LOG'),
    ('GORIVO', 'Gorivo', 30, 'FUEL_ENTRY'),
    ('MATERIJAL', 'Materijal', 40, 'PURCHASE'),
    ('PODIZVOĐAČI', 'Podizvođači', 50, 'SUBCONTRACTOR'),
    ('TRANSPORT', 'Transport', 60, 'HAUL'),
    ('OSTALO', 'Ostalo', 99, NULL)
  ) AS seed(code, name, sort_order, source_type)
  CROSS JOIN first_member
  /* Dva unikata: `(company_id, code)` za red, i djelimični za mapiranje izvora. `DO NOTHING`
     bez odrednice hvata oba — pa ponovni poziv ne pada ni na jednom. */
  ON CONFLICT DO NOTHING;
END;
$seed_cost_categories$;

COMMENT ON FUNCTION public.seed_cost_categories(TEXT) IS
  'Zadane kategorije troška (spec 06 §1.2.6). Preskače firmu bez ijednog člana: `created_by` je '
  'NOT NULL i ne izmišljamo nalog. Servis dopunjava set pri prvom knjiženju kad vlasnik postoji.';

INSERT INTO public.schema_migrations (name)
VALUES ('20261124170000_f5_1_projekti_finansije')
ON CONFLICT DO NOTHING;

COMMIT;
