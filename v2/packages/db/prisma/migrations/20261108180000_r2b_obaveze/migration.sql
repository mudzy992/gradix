-- R2b: obaveze sa rokovima, verzije, tipovi i prilozi.
--
-- Model je iz `docs/PLAN-R2.md` §3 i §5. Tri stvari su ovdje namjerno drukčije od „očiglednog“
-- rješenja, pa ih vrijedi zapisati uz samu šemu:
--
--  1. **Veza na entitet je `nullable` FK po koloni, ne `entity_type` + `entity_id`.**
--     Sa `entity_id TEXT` nema FK, pa obaveza može pokazivati na nepostojećeg radnika; greška se
--     otkrije tek na ekranu. Sa FK-om brisanje radnika sa obavezama pada — i to je ispravno:
--     radnik sa ljekarskim se deaktivira, ne briše.
--
--  2. **Ista firma je garantovana dvostruko.** RLS je prva linija, a kompozitni FK
--     `(company_id, worker_id) → workers (company_id, id)` druga: obaveza firme A ne može
--     pokazivati na radnika firme B čak i kad se RLS zaobiđe (BYPASSRLS nalog, SECURITY DEFINER).
--     Zato `workers` i `machines` imaju `UNIQUE (company_id, id)` iz R2a.
--
--  3. **`obligations` nosi keš trenutne verzije, a mijenja ga samo trigger.** Ruta koja upisuje
--     verziju ne može „zaboraviti“ da ažurira keš, a pregled rokova ne radi `JOIN` po svakom redu.
--
-- `project_id` je u R2 predviđen ali **bez FK-a**: tabela `projects` dolazi u R3. Do tada kolona
-- postoji (da migracija u R3 ne mijenja oblik reda), a `CHECK` dozvoljava samo `NULL` — dakle
-- obaveza na projektu se u R2 ne može napraviti, umjesto da visi na nepostojeći id.

-- ---------------------------------------------------------------------------
-- 1. Tipovi obaveza — podaci po firmi, ne enum
-- ---------------------------------------------------------------------------
CREATE TABLE obligation_types (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                 TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  label                TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  -- Na šta se tip odnosi. Određuje koji je FK u obavezi obavezan, pa se ne miješa ljekarski
  -- radnika sa registracijom mašine.
  entity_kind          TEXT NOT NULL CHECK (entity_kind IN ('WORKER', 'MACHINE', 'PROJECT', 'COMPANY')),
  -- Pragovi u danima, najveći prvi. Prazan niz = tip ne upozorava prije isteka.
  default_reminder_days INT[] NOT NULL DEFAULT '{60,30,15,7}'
                       CHECK (cardinality(default_reminder_days) <= 8
                              AND array_position(default_reminder_days, NULL) IS NULL),
  requires_attachment  BOOLEAN NOT NULL DEFAULT false,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT obligation_types_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT obligation_types_company_id_unique UNIQUE (company_id, id)
);

CREATE INDEX obligation_types_company_kind_idx
  ON obligation_types (company_id, entity_kind, sort_order);

-- ---------------------------------------------------------------------------
-- 2. Obaveze
-- ---------------------------------------------------------------------------
CREATE TABLE obligations (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type_id             TEXT NOT NULL,
  -- Keš trenutne verzije. Piše ga ISKLJUČIVO trigger iz `obligation_versions` (vidi §4 niže),
  -- pa se ne može razići sa verzijama.
  number              TEXT,
  issuer              TEXT,
  issued_at           DATE,
  expires_at          DATE,
  current_version     INT NOT NULL DEFAULT 1,
  -- Ko odgovara za obavezu. Nije isto kao „radnik na kojeg se odnosi“: ljekarski je radnikov,
  -- a odgovoran je šef gradilišta.
  responsible_user_id TEXT,
  superseded_by       TEXT,
  worker_id           TEXT,
  machine_id          TEXT,
  project_id          TEXT,
  scope_company       BOOLEAN NOT NULL DEFAULT false,
  note                TEXT CHECK (note IS NULL OR length(note) <= 2000),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          TEXT,

  CONSTRAINT obligations_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT obligations_type_fk FOREIGN KEY (company_id, type_id)
    REFERENCES obligation_types (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT obligations_worker_fk FOREIGN KEY (company_id, worker_id)
    REFERENCES workers (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT obligations_machine_fk FOREIGN KEY (company_id, machine_id)
    REFERENCES machines (company_id, id) ON DELETE RESTRICT,
  -- Odgovorna osoba mora biti ČLAN ove firme. `memberships` je jedinstven po
  -- `(user_id, company_id)`, pa FK ide u tom redu — isti efekat, bez dodatnog indeksa.
  CONSTRAINT obligations_responsible_fk FOREIGN KEY (responsible_user_id, company_id)
    REFERENCES memberships (user_id, company_id) ON DELETE SET NULL,
  CONSTRAINT obligations_superseded_fk FOREIGN KEY (company_id, superseded_by)
    REFERENCES obligations (company_id, id) ON DELETE SET NULL,

  -- Obaveza visi na TAČNO JEDNOM entitetu (ili je obaveza same firme). Bez ovoga bi red mogao
  -- biti i radnikov i mašinin, pa se ne bi znalo gdje se prikazuje ni kad istječe.
  CONSTRAINT obligations_one_scope CHECK (
    (worker_id    IS NOT NULL)::int +
    (machine_id   IS NOT NULL)::int +
    (project_id   IS NOT NULL)::int +
    (scope_company)::int = 1
  ),
  -- `projects` dolazi u R3; do tada obaveza na projektu ne postoji (umjesto da visi bez FK-a).
  CONSTRAINT obligations_project_not_before_r3 CHECK (project_id IS NULL),
  CONSTRAINT obligations_not_self_superseded CHECK (superseded_by IS DISTINCT FROM id),
  CONSTRAINT obligations_dates_check CHECK (
    (issued_at IS NULL OR expires_at IS NULL OR issued_at <= expires_at)
  )
);

-- Pregled rokova: „šta istječe do datuma“ ide po ovom indeksu, a ne preko izraza stanja.
CREATE INDEX obligations_company_expires_idx ON obligations (company_id, expires_at)
  WHERE superseded_by IS NULL;
CREATE INDEX obligations_worker_idx ON obligations (company_id, worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX obligations_machine_idx ON obligations (company_id, machine_id) WHERE machine_id IS NOT NULL;
CREATE INDEX obligations_responsible_idx ON obligations (company_id, responsible_user_id)
  WHERE responsible_user_id IS NOT NULL;
-- Jedan tip ima najviše jednu aktivnu obavezu na istom entitetu: dva ljekarska istovremeno bi
-- značila dva roka za istu stvar i nijedan tačan. Obnova ide kroz `POST /renew` (nova verzija).
CREATE UNIQUE INDEX obligations_active_worker_type_unique
  ON obligations (company_id, worker_id, type_id)
  WHERE worker_id IS NOT NULL AND superseded_by IS NULL;
CREATE UNIQUE INDEX obligations_active_machine_type_unique
  ON obligations (company_id, machine_id, type_id)
  WHERE machine_id IS NOT NULL AND superseded_by IS NULL;
CREATE UNIQUE INDEX obligations_active_company_type_unique
  ON obligations (company_id, type_id)
  WHERE scope_company;

-- ---------------------------------------------------------------------------
-- 3. Verzije — obnova NE prepisuje, dodaje verziju
-- ---------------------------------------------------------------------------
CREATE TABLE obligation_versions (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  obligation_id TEXT NOT NULL,
  version       INT NOT NULL CHECK (version >= 1),
  number        TEXT,
  issuer        TEXT,
  issued_at     DATE,
  expires_at    DATE,
  note          TEXT CHECK (note IS NULL OR length(note) <= 2000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,

  CONSTRAINT obligation_versions_obligation_fk FOREIGN KEY (company_id, obligation_id)
    REFERENCES obligations (company_id, id) ON DELETE CASCADE,
  CONSTRAINT obligation_versions_unique UNIQUE (obligation_id, version),
  CONSTRAINT obligation_versions_dates_check CHECK (
    issued_at IS NULL OR expires_at IS NULL OR issued_at <= expires_at
  )
);

CREATE INDEX obligation_versions_obligation_idx ON obligation_versions (obligation_id, version DESC);

-- ---------------------------------------------------------------------------
-- 4. Trigger: keš u `obligations` uvijek prati najnoviju verziju
-- ---------------------------------------------------------------------------
-- Zašto trigger, a ne kod u servisu: „keš se mijenja samo kad se doda verzija“ je invarijanta
-- baze, a ne dogovor u aplikaciji. Ruta ne može upisati `expires_at` drugačije od verzije.
CREATE OR REPLACE FUNCTION sync_obligation_current_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE obligations o
     SET number          = v.number,
         issuer          = v.issuer,
         issued_at       = v.issued_at,
         expires_at      = v.expires_at,
         current_version = v.version,
         updated_at      = now()
    FROM (
      SELECT version, number, issuer, issued_at, expires_at
        FROM obligation_versions
       WHERE obligation_id = NEW.obligation_id
       ORDER BY version DESC
       LIMIT 1
    ) v
   WHERE o.id = NEW.obligation_id
     AND o.company_id = NEW.company_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER obligation_versions_sync_current
  AFTER INSERT OR UPDATE ON obligation_versions
  FOR EACH ROW EXECUTE FUNCTION sync_obligation_current_version();

-- ---------------------------------------------------------------------------
-- 5. Stanje obaveze — JEDNA funkcija, koriste je baza i aplikacija
-- ---------------------------------------------------------------------------
-- `p_today` je POSLOVNI datum firme (zona iz `companies.timezone`), ne UTC: obaveza koja istječe
-- danas ne smije izgledati istekla u 22 h. Aplikacija isti poslovni datum računa u `@gradix/domain`
-- (`businessDate`) i prosljeđuje ga ovdje, pa baza i ekran ne mogu dati dva različita odgovora.
CREATE OR REPLACE FUNCTION obligation_state(
  p_expires_at DATE,
  p_thresholds INT[],
  p_today      DATE,
  p_superseded BOOLEAN DEFAULT false
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_superseded THEN 'superseded'
    WHEN p_expires_at IS NULL THEN 'no_expiry'
    WHEN p_expires_at < p_today THEN 'expired'
    -- „Uskoro istječe“ je ZADNJI prag (najmanji), a ne prvi: pragovi 60/30/15/7 znače „podsjeti me
    -- 60, 30, 15 i 7 dana prije“, a rok od 20 dana nije „uskoro“ nego „važeće“ sa podsjetnikom koji
    -- je već prošao. Tako i kapija R2b glasi (§7): 20 dana → važeće, 5 dana → uskoro istječe.
    -- Bez pragova tip ne prelazi u „uskoro“ — samo u „isteklo“.
    WHEN p_expires_at - p_today <= COALESCE((SELECT min(x) FROM unnest(p_thresholds) AS x), 0)
      THEN 'expiring'
    ELSE 'valid'
  END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Prilozi
-- ---------------------------------------------------------------------------
-- Red postoji i prije nego što objekat stigne u bucket (`pending` → `ready`). Bez toga bi upload
-- bez potvrde ostavio objekat u bucketu na koji niko ne pokazuje — smeće koje se ne vidi.
CREATE TABLE obligation_attachments (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  obligation_id  TEXT NOT NULL,
  -- Putanja u bucketu `gradix-v2`, prefiks `gx2/` (ADR 0006). Uvijek `gx2/{company}/{obligation}/{id}`.
  object_key     TEXT NOT NULL,
  file_name      TEXT NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  -- Stvarni tip iz prvih bajtova, ne iz ekstenzije ni iz `content-type` zahtjeva (§5.1).
  content_type   TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes     BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  -- Isti fajl dvaput na istoj obavezi je greška, ne duplikat u bucketu.
  sha256         TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  uploaded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT,

  CONSTRAINT obligation_attachments_obligation_fk FOREIGN KEY (company_id, obligation_id)
    REFERENCES obligations (company_id, id) ON DELETE CASCADE,
  CONSTRAINT obligation_attachments_sha_unique UNIQUE (obligation_id, sha256)
);

CREATE INDEX obligation_attachments_obligation_idx
  ON obligation_attachments (obligation_id, created_at DESC);
-- Čišćenje napuštenih uploada: objekti u `pending` stariji od sat vremena brišu se pri sljedećem
-- uploadu (bez workera), pa indeks postoji da taj upit ne skenira tabelu.
CREATE INDEX obligation_attachments_pending_idx
  ON obligation_attachments (company_id, created_at) WHERE status = 'pending';

-- Verzija pokazuje na prilog koji je uz nju priložen (PDF rješenja, potvrda).
ALTER TABLE obligation_versions
  ADD COLUMN attachment_id TEXT,
  ADD CONSTRAINT obligation_versions_attachment_fk FOREIGN KEY (attachment_id)
    REFERENCES obligation_attachments (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE obligation_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligation_types        FORCE  ROW LEVEL SECURITY;
ALTER TABLE obligations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligations             FORCE  ROW LEVEL SECURITY;
ALTER TABLE obligation_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligation_versions     FORCE  ROW LEVEL SECURITY;
ALTER TABLE obligation_attachments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligation_attachments  FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON obligation_types
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));
CREATE POLICY tenant_isolation ON obligations
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));
CREATE POLICY tenant_isolation ON obligation_versions
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));
CREATE POLICY tenant_isolation ON obligation_attachments
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- ---------------------------------------------------------------------------
-- 8. Seed zadanih tipova (B5.4) — funkcija, kao kod kategorija mašina
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_obligation_types(target_company TEXT)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO obligation_types (id, company_id, code, label, entity_kind, default_reminder_days, requires_attachment, sort_order)
  VALUES
    -- Radnik
    (target_company || '_obt_medical',        target_company, 'MEDICAL',          'Ljekarski pregled',           'WORKER',  '{60,30,15,7}', true,  10),
    (target_company || '_obt_safety',         target_company, 'SAFETY_TRAINING',  'Obuka iz zaštite na radu',    'WORKER',  '{60,30,15,7}', true,  20),
    (target_company || '_obt_height',         target_company, 'WORK_AT_HEIGHT',   'Rad na visini',               'WORKER',  '{60,30,15,7}', true,  30),
    (target_company || '_obt_excavation',     target_company, 'EXCAVATION',       'Radovi iskopa',               'WORKER',  '{30,15,7}',    false, 40),
    (target_company || '_obt_confined',       target_company, 'CONFINED_SPACE',   'Rad u skučenom prostoru',     'WORKER',  '{60,30,15,7}', true,  50),
    (target_company || '_obt_machine_permit', target_company, 'MACHINE_LICENCE',  'Ovlaštenje za mašinu',        'WORKER',  '{60,30,15,7}', true,  60),
    (target_company || '_obt_driving',        target_company, 'DRIVING_LICENCE',  'Vozačka dozvola',             'WORKER',  '{60,30,15,7}', false, 70),
    (target_company || '_obt_first_aid',      target_company, 'FIRST_AID',        'Prva pomoć',                  'WORKER',  '{60,30,15,7}', true,  80),
    -- Mašina / vozilo
    (target_company || '_obt_registration',   target_company, 'REGISTRATION',     'Registracija',                'MACHINE', '{30,15,7}',    true,  10),
    (target_company || '_obt_inspection',     target_company, 'TECH_INSPECTION',  'Tehnički pregled',            'MACHINE', '{30,15,7}',    true,  20),
    (target_company || '_obt_insurance',      target_company, 'INSURANCE',        'Osiguranje',                  'MACHINE', '{30,15,7}',    true,  30),
    (target_company || '_obt_tachograph',     target_company, 'TACHOGRAPH',       'Tahograf / kalibracija',      'MACHINE', '{30,15,7}',    true,  40),
    (target_company || '_obt_crane',          target_company, 'CRANE_ATTEST',     'Atest dizalice',              'MACHINE', '{60,30,15,7}', true,  50),
    (target_company || '_obt_extinguisher',   target_company, 'EXTINGUISHER',     'Vatrogasni aparat',           'MACHINE', '{30,15,7}',    false, 60),
    (target_company || '_obt_warranty',       target_company, 'WARRANTY',         'Garancija',                   'MACHINE', '{}',           false, 70),
    -- Firma
    (target_company || '_obt_company_reg',    target_company, 'COMPANY_REGISTRATION', 'Registracija firme',      'COMPANY', '{60,30,15,7}', true,  10),
    (target_company || '_obt_licence',        target_company, 'LICENCE',          'Licenca',                     'COMPANY', '{60,30,15,7}', true,  20),
    (target_company || '_obt_certificate',    target_company, 'CERTIFICATE',      'Certifikat',                  'COMPANY', '{60,30,15,7}', true,  30),
    (target_company || '_obt_company_ins',    target_company, 'COMPANY_INSURANCE','Osiguranje firme',            'COMPANY', '{30,15,7}',    true,  40)
  ON CONFLICT (company_id, code) DO NOTHING;
$$;

SELECT seed_obligation_types(id) FROM companies;

CREATE OR REPLACE FUNCTION companies_seed_obligation_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_obligation_types(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_seed_obligation_types
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION companies_seed_obligation_types();

INSERT INTO schema_migrations (name) VALUES ('20261108180000_r2b_obaveze') ON CONFLICT DO NOTHING;
