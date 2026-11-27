-- R2a: radnici, kategorije mašina, proširenje mašina/vozila.
--
-- Odluke vlasnika (2026-11-08) koje su ovdje ugrađene:
--  * Kategorije mašina NISU `enum`: tabela po firmi, seed 13 zadanih, uvoz mapira tekst na njih.
--  * Vozila i mašine su JEDNA tabela; razlika je kategorija i vrsta brojila (sati ili kilometri).
--  * Brojilo mašine je samo TRENUTNA vrijednost; historija očitanja je R5.
--  * Radnik može postojati bez korisničkog naloga; veza je opciona i pravi je administrator.
--  * U R2a NEMA kolona za JMBG, adresu ni bankovni račun (vidi docs/PLAN-R2.md §9).
--
-- Zašto `UNIQUE (company_id, id)` na svakoj tabeli koja je cilj veze: jedini način da baza
-- garantuje da obaveza (R2b) i entitet pripadaju ISTOJ firmi jeste kompozitni FK
-- `(company_id, worker_id) → workers (company_id, id)`. Bez toga bi RLS bio jedina linija
-- odbrane, a RLS se zaobilazi (BYPASSRLS nalog, Definer funkcija).

-- ---------------------------------------------------------------------------
-- 1. Radnici
-- ---------------------------------------------------------------------------
CREATE TABLE workers (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL CHECK (length(btrim(first_name)) BETWEEN 1 AND 100),
  last_name   TEXT NOT NULL CHECK (length(btrim(last_name)) BETWEEN 1 AND 100),
  -- Kontakt, namjerno NIJE jedinstven: dva brata mogu dijeliti broj, a radnik bez telefona
  -- i emaila postoji. Jedinstvenost bi izmislila pravilo koje firma nema.
  phone       TEXT,
  email       TEXT,
  job_title   TEXT,
  engagement  TEXT NOT NULL DEFAULT 'PERMANENT'
              CHECK (engagement IN ('PERMANENT', 'FIXED_TERM', 'SEASONAL', 'CONTRACT')),
  hired_at    DATE NOT NULL,
  ended_at    DATE CHECK (ended_at IS NULL OR ended_at >= hired_at),
  team        TEXT,
  supervisor_id TEXT,
  -- Opciona veza na nalog. Prazno = radnik postoji bez naloga (uobičajen slučaj u pilotu).
  user_id     TEXT UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workers_company_id_unique UNIQUE (company_id, id),
  -- Nadređeni mora biti iz iste firme i ne može biti sam sebi nadređen.
  CONSTRAINT workers_supervisor_fk FOREIGN KEY (company_id, supervisor_id)
    REFERENCES workers (company_id, id) ON DELETE SET NULL,
  CONSTRAINT workers_not_own_supervisor CHECK (supervisor_id IS DISTINCT FROM id)
);

CREATE INDEX workers_company_name_idx ON workers (company_id, last_name, first_name);
-- Pretraga po telefonu/emailu tokom uvoza (mogući duplikat) i na ekranu.
CREATE INDEX workers_company_phone_idx ON workers (company_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX workers_company_email_idx ON workers (company_id, lower(email)) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Kategorije mašina — podaci po firmi, ne enum
-- ---------------------------------------------------------------------------
CREATE TABLE equipment_categories (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  -- Zadana vrsta brojila za kategoriju; mašina je nasljeđuje pri kreiranju, poslije može mijenjati.
  meter       TEXT NOT NULL CHECK (meter IN ('HOURS', 'KM')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT equipment_categories_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT equipment_categories_company_id_unique UNIQUE (company_id, id)
);

CREATE INDEX equipment_categories_company_sort_idx
  ON equipment_categories (company_id, sort_order, name);

-- Seed zadanih kategorija. Funkcija, a ne `INSERT` u migraciji: iste kategorije treba dati i
-- postojećim firmama (demo) i svakoj novoj firmi pri kreiranju. Idempotentna je po `code`.
CREATE OR REPLACE FUNCTION seed_equipment_categories(target_company TEXT)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO equipment_categories (id, company_id, code, name, meter, sort_order)
  VALUES
    (target_company || '_cat_excavator',      target_company, 'EXCAVATOR',       'Bager',             'HOURS', 10),
    (target_company || '_cat_loader',         target_company, 'LOADER',          'Utovarivač',        'HOURS', 20),
    (target_company || '_cat_roller',         target_company, 'ROLLER',          'Valjak',            'HOURS', 30),
    (target_company || '_cat_dozer',          target_company, 'DOZER',           'Buldožer',          'HOURS', 40),
    (target_company || '_cat_grader',         target_company, 'GRADER',          'Grejder',           'HOURS', 50),
    (target_company || '_cat_paver',          target_company, 'PAVER',           'Finišer',           'HOURS', 60),
    (target_company || '_cat_truck',          target_company, 'TRUCK',           'Kamion',            'KM',    70),
    (target_company || '_cat_dumper',         target_company, 'DUMPER',          'Damper',            'KM',    80),
    (target_company || '_cat_compressor',     target_company, 'COMPRESSOR',      'Kompresor',         'HOURS', 90),
    (target_company || '_cat_generator',      target_company, 'GENERATOR',       'Agregat',           'HOURS', 100),
    (target_company || '_cat_trailer',        target_company, 'TRAILER',         'Prikolica',         'KM',    110),
    (target_company || '_cat_passenger_car',  target_company, 'PASSENGER_CAR',   'Putničko vozilo',   'KM',    120),
    (target_company || '_cat_other',          target_company, 'OTHER',           'Ostalo',            'HOURS', 999)
  ON CONFLICT (company_id, code) DO NOTHING;
$$;

SELECT seed_equipment_categories(id) FROM companies;

-- ---------------------------------------------------------------------------
-- 3. Mašine i vozila — proširenje postojeće tabele
-- ---------------------------------------------------------------------------
ALTER TABLE machines
  ADD COLUMN category_id      TEXT,
  ADD COLUMN make             TEXT,
  ADD COLUMN model            TEXT,
  ADD COLUMN serial_no        TEXT,
  ADD COLUMN plate            TEXT,
  ADD COLUMN year             INT,
  ADD COLUMN ownership        TEXT NOT NULL DEFAULT 'OWN',
  ADD COLUMN meter            TEXT NOT NULL DEFAULT 'HOURS',
  ADD COLUMN meter_value      NUMERIC(12,1),
  ADD COLUMN meter_updated_at TIMESTAMPTZ,
  ADD COLUMN is_active        BOOLEAN NOT NULL DEFAULT true;

-- Postojeće mašine (demo) ne mogu ostati bez kategorije: dobijaju 'OTHER' svoje firme.
UPDATE machines m
   SET category_id = m.company_id || '_cat_other'
 WHERE m.category_id IS NULL;

ALTER TABLE machines
  ALTER COLUMN category_id SET NOT NULL,
  ADD CONSTRAINT machines_category_fk FOREIGN KEY (company_id, category_id)
    REFERENCES equipment_categories (company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT machines_ownership_check CHECK (ownership IN ('OWN', 'RENT')),
  ADD CONSTRAINT machines_meter_check CHECK (meter IN ('HOURS', 'KM')),
  -- Brojilo je jedna trenutna vrijednost; negativno nema smisla ni za sate ni za kilometre.
  ADD CONSTRAINT machines_meter_value_check CHECK (meter_value IS NULL OR meter_value >= 0),
  -- Vrijednost bez datuma unosa (i obratno) ne smije postojati: inače se ne zna koliko je stara.
  ADD CONSTRAINT machines_meter_updated_check
    CHECK ((meter_value IS NULL) = (meter_updated_at IS NULL)),
  ADD CONSTRAINT machines_year_check
    CHECK (year IS NULL OR (year BETWEEN 1950 AND extract(year FROM now())::int + 1)),
  -- Kompozitni cilj za veze iz R2b (obaveze). `UNIQUE (company_id, code)` već postoji.
  ADD CONSTRAINT machines_company_id_unique UNIQUE (company_id, id);

CREATE INDEX machines_company_category_idx ON machines (company_id, category_id);
-- Registarska oznaka je jedinstvena unutar firme kad postoji; neregistrovanih mašina ima više.
CREATE UNIQUE INDEX machines_company_plate_unique
  ON machines (company_id, upper(plate)) WHERE plate IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- Isti obrazac kao `machines` u migraciji `init`: ENABLE + FORCE + politika po firmi.
ALTER TABLE workers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers              FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workers
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

ALTER TABLE equipment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_categories FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON equipment_categories
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- ---------------------------------------------------------------------------
-- 5. Nova firma dobija kategorije bez posebnog koraka u aplikaciji
-- ---------------------------------------------------------------------------
-- Trigger, a ne poziv iz koda: firma se kreira i kroz seed i kroz budući onboarding, a
-- zaboravljen poziv bi ostavio firmu bez ijedne kategorije (i uvoz bi padao na prvoj mašini).
CREATE OR REPLACE FUNCTION companies_seed_equipment_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_equipment_categories(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_seed_equipment_categories
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION companies_seed_equipment_categories();

-- ---------------------------------------------------------------------------
-- 6. Prava
-- ---------------------------------------------------------------------------
-- Tabele idu kroz `bootstrap/grants.sql` (GRANT na sve tabele + default privileges).
-- Funkcija je SECURITY DEFINER i zove se iz trigera, pa aplikacija ne treba EXECUTE na njoj;
-- `seed_equipment_categories` takođe nije za aplikaciju — kategorije se dodaju kroz API.

INSERT INTO schema_migrations (name) VALUES ('20261108160000_r2a_radnici_masine') ON CONFLICT DO NOTHING;
