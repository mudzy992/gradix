-- =============================================================================
-- R3 — projekti i dodjele
--
-- Zašto projekat dolazi POSLIJE obaveza (R2b), a ne prije: obaveza je već generička preko
-- `entity_kind`, pa projekat samo dobija svoj red u `projects` i svoj `entity_kind`. Da je
-- projekat došao prvi, obaveza bi morala biti pisana dvaput.
--
-- Jedna odluka je ovdje namjerno DRUGAČIJA od skice u docs/PLAN-R3.md: dodjela NE ide u
-- `memberships.project_ids` (niz), nego u tabelu `project_assignments`. Niz ne može nositi FK,
-- period važenja ni historiju, a dodjela mašine se u njega ne može upisati nikako.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Blokada dodjele po tipu obaveze (B5.4)
-- ---------------------------------------------------------------------------
-- „Radnik s isteklim ovlaštenjem ne može biti dodijeljen toj mašini." Koji tipovi blokiraju je
-- PODATAK, ne enum: firma može ukinuti blokadu za vozačku dozvolu i uključiti je za nešto svoje.
ALTER TABLE obligation_types
  ADD COLUMN blocks_assignment BOOLEAN NOT NULL DEFAULT false;

-- Podrazumijevano blokiraju oni koji su u praksi i blokada: bez ljekarskog se ne izlazi na
-- gradilište, bez registracije vozilo ne ide na put.
UPDATE obligation_types
   SET blocks_assignment = true
 WHERE code IN ('MEDICAL', 'SAFETY_TRAINING', 'WORK_AT_HEIGHT', 'MACHINE_LICENCE',
                'REGISTRATION', 'TECH_INSPECTION', 'INSURANCE', 'LICENCE', 'COMPANY_REGISTRATION');

-- ---------------------------------------------------------------------------
-- 1. Projekti
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Šifra je ono što ljudi izgovaraju na terenu („P-24/2026"), pa je jedinstvena po firmi.
  code             TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  -- Status je podatak u koloni, a ne PG enum: firma će prije dodati „NA ČEKANJU" nego što će
  -- se raditi migracija zbog jedne riječi. Skup je ipak zatvoren — CHECK brani preljev.
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('PLANNED', 'ACTIVE', 'PAUSED', 'FINISHED', 'CANCELLED')),
  site_address     TEXT CHECK (site_address IS NULL OR length(site_address) <= 300),
  site_place       TEXT CHECK (site_place IS NULL OR length(site_place) <= 120),
  starts_on        DATE,
  ends_on          DATE CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  manager_worker_id TEXT,
  note             TEXT CHECK (note IS NULL OR length(note) <= 2000),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT,

  CONSTRAINT projects_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT projects_company_code_unique UNIQUE (company_id, code),
  -- Rukovodilac projekta je RADNIK iz iste firme (ne nalog): projekat vodi čovjek, a nalog je
  -- stvar pristupa. Ako dobije nalog kasnije, veza se ne mijenja.
  CONSTRAINT projects_manager_fk FOREIGN KEY (company_id, manager_worker_id)
    REFERENCES workers (company_id, id) ON DELETE SET NULL
);

CREATE INDEX projects_company_status_idx ON projects (company_id, status, code);
-- Pretraga po nazivu i lokaciji na listi (bez `lower()` indeksa — lista je mala i filtrira se u
-- aplikaciji; ovaj indeks služi sortiranju, ne pretrazi).
CREATE INDEX projects_company_active_idx ON projects (company_id, is_active) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. Dodjele — radnik ILI mašina, sa periodom
-- ---------------------------------------------------------------------------
-- Jedna tabela za oboje: upit „ko je na projektu" i „gdje je mašina" tada ide istim putem, a
-- izvještaji ne moraju spajati dvije tabele istog oblika.
CREATE TABLE project_assignments (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL,
  worker_id   TEXT,
  machine_id  TEXT,
  from_date   DATE NOT NULL,
  to_date     DATE,
  note        TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,

  CONSTRAINT project_assignments_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT project_assignments_project_fk FOREIGN KEY (company_id, project_id)
    REFERENCES projects (company_id, id) ON DELETE CASCADE,
  CONSTRAINT project_assignments_worker_fk FOREIGN KEY (company_id, worker_id)
    REFERENCES workers (company_id, id) ON DELETE CASCADE,
  CONSTRAINT project_assignments_machine_fk FOREIGN KEY (company_id, machine_id)
    REFERENCES machines (company_id, id) ON DELETE CASCADE,

  -- Dodjela visi na TAČNO JEDNOM entitetu. Bez ovoga bi red mogao biti i radnikov i mašinin.
  CONSTRAINT project_assignments_one_target CHECK (
    (worker_id IS NOT NULL)::int + (machine_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT project_assignments_period_check CHECK (to_date IS NULL OR to_date >= from_date)
);

-- Preklapanje istog radnika na istom projektu je greška, ne duplikat: dva reda za isti period
-- izgledaju kao dva čovjeka u izvještaju.
--
-- Zašto TRIGER, a ne `EXCLUDE USING gist`: isključujući indeks nad `daterange` uz `project_id`
-- traži `btree_gist`, a to je ekstenzija koju mora da instalira nadzornik baze. Firma koja radi na
-- Coolifyju nema tu mogućnost, pa bi migracija pala na produkcionoj bazi — a ne u testu. Triger
-- radi na svakoj PostgreSQL 16 bazi bez ijedne ekstenzije.
--
-- Uzimanje savjetodavne brave po (projekat, entitet) je ono što triger čini tačnim i pod
-- paralelnim zahtjevima: bez `pg_advisory_xact_lock` dva istovremena upisa mogu oba proći provjeru
-- i tek onda se upisati. Brava se drži do kraja transakcije, pa je drugi upis čeka i vidi prvi.
CREATE OR REPLACE FUNCTION project_assignment_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sukobi INTEGER;  -- NE `overlaps`: to je rezervisana riječ u PostgreSQL-u
BEGIN
  IF NEW.worker_id IS NULL AND NEW.machine_id IS NULL THEN
    RETURN NEW;  -- oblik reda brani `project_assignments_one_target`
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.company_id || ':' || NEW.project_id || ':' ||
                     COALESCE(NEW.worker_id, NEW.machine_id), 0)
  );

  SELECT count(*) INTO sukobi
    FROM project_assignments a
   WHERE a.company_id = NEW.company_id
     AND a.project_id = NEW.project_id
     AND a.id <> NEW.id
     AND (
       (NEW.worker_id IS NOT NULL AND a.worker_id = NEW.worker_id) OR
       (NEW.machine_id IS NOT NULL AND a.machine_id = NEW.machine_id)
     )
     -- Dva perioda se sijeku ako jedan počinje prije nego drugi završi (i obrnuto). `to_date`
     -- koji nije upisan znači „još traje", pa se računa kao beskonačno.
     AND a.from_date <= COALESCE(NEW.to_date, 'infinity'::date)
     AND NEW.from_date <= COALESCE(a.to_date, 'infinity'::date);

  IF sukobi > 0 THEN
    RAISE EXCEPTION 'ASSIGNMENT_OVERLAP'
      USING DETAIL = 'Isti entitet je već dodijeljen ovom projektu u periodu koji se preklapa.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_assignments_no_overlap
  BEFORE INSERT OR UPDATE ON project_assignments
  FOR EACH ROW EXECUTE FUNCTION project_assignment_no_overlap();

CREATE INDEX project_assignments_project_idx ON project_assignments (company_id, project_id);
CREATE INDEX project_assignments_worker_idx ON project_assignments (company_id, worker_id)
  WHERE worker_id IS NOT NULL;
CREATE INDEX project_assignments_machine_idx ON project_assignments (company_id, machine_id)
  WHERE machine_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Iznimka od blokade — evidentirana, sa razlogom i rokom
-- ---------------------------------------------------------------------------
-- Bez ovoga bi firma zaobišla blokadu tako što uopšte ne unese obavezu. Iznimka je čin koji se
-- odobrava, pa nosi ko je odobrio, zašto i dokle važi — i ide u audit trag.
CREATE TABLE project_assignment_overrides (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  assignment_id   TEXT NOT NULL,
  obligation_id   TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  valid_until     DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT,

  CONSTRAINT project_assignment_overrides_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT project_assignment_overrides_assignment_fk
    FOREIGN KEY (company_id, assignment_id) REFERENCES project_assignments (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT project_assignment_overrides_obligation_fk
    FOREIGN KEY (company_id, obligation_id) REFERENCES obligations (company_id, id)
    ON DELETE CASCADE,
  -- Iznimka bez roka je trajno gašenje pravila pod imenom „iznimka".
  CONSTRAINT project_assignment_overrides_valid CHECK (valid_until >= created_at::date)
);

CREATE INDEX project_assignment_overrides_assignment_idx
  ON project_assignment_overrides (company_id, assignment_id);

-- ---------------------------------------------------------------------------
-- 4. Obaveze dobijaju projekat (B5.4: dozvole, saglasnosti, HSE elaborat)
-- ---------------------------------------------------------------------------
-- R2b je namjerno ostavio `project_id IS NULL` jer tabela nije postojala. Sada postoji, pa se
-- zabrana skida i dobija pravi FK — isti obrazac kao za radnika i mašinu.
ALTER TABLE obligations DROP CONSTRAINT obligations_project_not_before_r3;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_project_fk FOREIGN KEY (company_id, project_id)
    REFERENCES projects (company_id, id) ON DELETE RESTRICT;

CREATE INDEX obligations_project_idx ON obligations (company_id, project_id)
  WHERE project_id IS NOT NULL;

-- Jedan aktivan tip po projektu — kao za radnika i mašinu, da dva „građevinska dozvola" ne
-- postoje istovremeno sa dva različita roka.
CREATE UNIQUE INDEX obligations_active_project_type_unique
  ON obligations (company_id, project_id, type_id)
  WHERE project_id IS NOT NULL AND superseded_by IS NULL;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE projects                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects                      FORCE  ROW LEVEL SECURITY;
ALTER TABLE project_assignments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_assignments           FORCE  ROW LEVEL SECURITY;
ALTER TABLE project_assignment_overrides  ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_assignment_overrides  FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON projects
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));
CREATE POLICY tenant_isolation ON project_assignments
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));
CREATE POLICY tenant_isolation ON project_assignment_overrides
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- ---------------------------------------------------------------------------
-- 6. Ponovni opseg „dodijeljeni projekti" (R1b ga je skinuo jer ništa nije mijenjao)
-- ---------------------------------------------------------------------------
ALTER TABLE memberships DROP CONSTRAINT memberships_scope_check;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_scope_check CHECK (scope IN ('COMPANY', 'PROJECTS', 'SELF'));

-- ---------------------------------------------------------------------------
-- 7. Zadani tipovi obaveza za projekat
-- ---------------------------------------------------------------------------
-- Ista funkcija kao u R2b, proširena — firma koja je već seedovana dobija nove redove kroz
-- `ON CONFLICT DO NOTHING`, a nova firma dobija sve. Bez ponovnog seedovanja cijele baze.
CREATE OR REPLACE FUNCTION seed_obligation_types(target_company TEXT)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO obligation_types (id, company_id, code, label, entity_kind, default_reminder_days,
                                requires_attachment, sort_order, blocks_assignment)
  VALUES
    -- Radnik
    (target_company || '_obt_medical',        target_company, 'MEDICAL',          'Ljekarski pregled',           'WORKER',  '{60,30,15,7}', true,  10, true),
    (target_company || '_obt_safety',         target_company, 'SAFETY_TRAINING',  'Obuka iz zaštite na radu',    'WORKER',  '{60,30,15,7}', true,  20, true),
    (target_company || '_obt_height',         target_company, 'WORK_AT_HEIGHT',   'Rad na visini',               'WORKER',  '{60,30,15,7}', true,  30, true),
    (target_company || '_obt_excavation',     target_company, 'EXCAVATION',       'Radovi iskopa',               'WORKER',  '{30,15,7}',    false, 40, false),
    (target_company || '_obt_confined',       target_company, 'CONFINED_SPACE',   'Rad u skučenom prostoru',     'WORKER',  '{60,30,15,7}', true,  50, false),
    (target_company || '_obt_machine_permit', target_company, 'MACHINE_LICENCE',  'Ovlaštenje za mašinu',        'WORKER',  '{60,30,15,7}', true,  60, true),
    (target_company || '_obt_driving',        target_company, 'DRIVING_LICENCE',  'Vozačka dozvola',             'WORKER',  '{60,30,15,7}', false, 70, false),
    (target_company || '_obt_first_aid',      target_company, 'FIRST_AID',        'Prva pomoć',                  'WORKER',  '{60,30,15,7}', true,  80, false),
    -- Mašina / vozilo
    (target_company || '_obt_registration',   target_company, 'REGISTRATION',     'Registracija',                'MACHINE', '{30,15,7}',    true,  10, true),
    (target_company || '_obt_inspection',     target_company, 'TECH_INSPECTION',  'Tehnički pregled',            'MACHINE', '{30,15,7}',    true,  20, true),
    (target_company || '_obt_insurance',      target_company, 'INSURANCE',        'Osiguranje',                  'MACHINE', '{30,15,7}',    true,  30, true),
    (target_company || '_obt_tachograph',     target_company, 'TACHOGRAPH',       'Tahograf / kalibracija',      'MACHINE', '{30,15,7}',    true,  40, false),
    (target_company || '_obt_crane',          target_company, 'CRANE_ATTEST',     'Atest dizalice',              'MACHINE', '{60,30,15,7}', true,  50, false),
    (target_company || '_obt_extinguisher',   target_company, 'EXTINGUISHER',     'Vatrogasni aparat',           'MACHINE', '{30,15,7}',    false, 60, false),
    (target_company || '_obt_warranty',       target_company, 'WARRANTY',         'Garancija',                   'MACHINE', '{}',           false, 70, false),
    -- Firma
    (target_company || '_obt_company_reg',    target_company, 'COMPANY_REGISTRATION', 'Registracija firme',      'COMPANY', '{60,30,15,7}', true,  10, true),
    (target_company || '_obt_licence',        target_company, 'LICENCE',          'Licenca',                     'COMPANY', '{60,30,15,7}', true,  20, true),
    (target_company || '_obt_certificate',    target_company, 'CERTIFICATE',      'Certifikat',                  'COMPANY', '{60,30,15,7}', true,  30, false),
    (target_company || '_obt_company_ins',    target_company, 'COMPANY_INSURANCE','Osiguranje firme',            'COMPANY', '{30,15,7}',    true,  40, false),
    -- Projekat (novo u R3, B5.4)
    (target_company || '_obt_building_permit', target_company, 'BUILDING_PERMIT', 'Građevinska dozvola',        'PROJECT', '{90,60,30,15}', true,  10, true),
    (target_company || '_obt_consent',        target_company, 'CONSENT',          'Saglasnost',                  'PROJECT', '{30,15,7}',    true,  20, true),
    (target_company || '_obt_road_closure',   target_company, 'ROAD_CLOSURE',     'Dozvola za obustavu saobraćaja','PROJECT', '{30,15,7}',  true,  30, true),
    (target_company || '_obt_public_area',    target_company, 'PUBLIC_AREA',      'Zauzeće javne površine',      'PROJECT', '{30,15,7}',    true,  40, false),
    (target_company || '_obt_environment',    target_company, 'ENVIRONMENT',      'Okolišna saglasnost',         'PROJECT', '{60,30,15,7}', true,  50, true),
    (target_company || '_obt_hse_plan',       target_company, 'HSE_PLAN',         'Elaborat HSE',                'PROJECT', '{30,15,7}',    false, 60, false),
    (target_company || '_obt_site_plan',      target_company, 'SITE_PLAN',        'Plan organizacije gradilišta','PROJECT', '{30,15,7}',   false, 70, true),
    (target_company || '_obt_abnormal_load',  target_company, 'ABNORMAL_LOAD',    'Dozvola za vanredni prijevoz','PROJECT', '{30,15,7}',   true,  80, false),
    (target_company || '_obt_handover',       target_company, 'TECH_HANDOVER',    'Tehnički prijem',             'PROJECT', '{}',           true,  90, false)
  ON CONFLICT (company_id, code) DO NOTHING;
$$;

-- Postojeće firme: nova funkcija popunjava samo ono što nedostaje.
SELECT seed_obligation_types(id) FROM companies;

-- Novi trigger za nove firme (stari je vezao ime funkcije, pa ne treba ponovo da se pravi —
-- ali se pravi iznova da bi migracija bila čitljiva kao cjelina).
DROP TRIGGER IF EXISTS companies_seed_obligation_types ON companies;
CREATE TRIGGER companies_seed_obligation_types
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION companies_seed_obligation_types();

INSERT INTO schema_migrations (name) VALUES ('20261109120000_r3_projekti') ON CONFLICT DO NOTHING;
