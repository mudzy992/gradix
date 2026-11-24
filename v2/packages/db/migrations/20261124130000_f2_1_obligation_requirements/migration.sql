-- ============================================================================
-- F2 — Obaveze s rokom (Modul 2), prvi dio: ŠEMA
--
-- Šta se dodaje (spec 02 §2):
--   1. `obligation_types`: `requires_review`, `sensitive`, `blocks_actions`;
--   2. `obligations`: `reminder_days` (override), `review_at` (+ CHECK za trajne),
--      `reviewed_by`/`reviewed_at`, `review_state` za tok potvrde dokumenta;
--   3. `obligation_requirements` — pravila „svaki X mora imati Y“;
--   4. `obligation_notify_roles` — kome ide obavještenje po tipu;
--   5. `obligation_state()` dobija `review_at` i `review_due`.
--
-- `usage_overrides` (bivši `project_assignment_overrides`) je već napravljen u F0.3, sa
-- `subject_kind` (WORKER/MACHINE/TENDER) — spec 02 §19 je time ispunjen ranije i ovdje se
-- NE dira. Isto važi za jedinstveni `attachments` servis (§27–29, F0.1/F0.2).
--
-- Zašto `missing` NIJE kolona: to je odsustvo reda, ne stanje reda. Da je kolona, brisanje
-- radnika bi ostavljalo „duhove“ — redove koji tvrde da nešto nedostaje osobi koje nema.
-- Računa se upitom (§1.1 tačka 2) i ne može se razići sa stvarnošću.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipovi obaveza
-- ---------------------------------------------------------------------------
ALTER TABLE obligation_types
  ADD COLUMN requires_review BOOLEAN NOT NULL DEFAULT false,
  -- Medicinski nalaz i vozačka dozvola nisu isti podatak: prvi je posebna kategorija
  -- (posebna dozvola za prilog, ACCESS audit pri čitanju, retencija 24 mj.).
  ADD COLUMN sensitive BOOLEAN NOT NULL DEFAULT false,
  -- Koje radnje tip blokira kad je istekao/odbijen. `assign` je zadano (postojeće ponašanje
  -- dodjele radnika na projekat); mašine dodaju `haul`/`machine_hours`, tenderi
  -- `tender_submit`. Vrijednosti su iste kao `USAGE_ACTIONS` u `@gradix/domain`.
  ADD COLUMN blocks_actions TEXT[] NOT NULL DEFAULT '{assign}'
    CHECK (
      array_position(blocks_actions, NULL) IS NULL
      AND blocks_actions <@ ARRAY['assign', 'haul', 'machine_hours', 'fuel', 'workday', 'tender_submit']::TEXT[]
    );

-- `blocks_actions` se puni iz POSTOJEĆE `blocks_assignment` (R3), da ponašanje ne skoči:
-- tip koji je blokirao dodjelu blokira i dalje, a mašinski tipovi dobijaju i radnje koje su do
-- sada blokirali kroz posebne provjere (`haul`, `machine_hours`).
--
-- Ovo mora biti TRIGGER, a ne jednokratni `UPDATE` u migraciji: migracija prolazi prije nego
-- postoje firme, pa `obligation_types` u tom trenutku nema nijedan red. Tipovi se upisuju
-- kasnije — seed funkcijom pri kreiranju firme. Bez triggera bi svaki novi tip imao
-- `blocks_actions = {assign}` i registracija mašine bi puštala `haul`.
CREATE OR REPLACE FUNCTION obligation_types_sync_blocks_actions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Poštuje izričit unos: ako je pozivalac poslao vlastiti spisak (F2 tipovi), ne diramo ga.
  IF NEW.blocks_actions IS DISTINCT FROM ARRAY['assign']::TEXT[] THEN
    RETURN NEW;
  END IF;
  IF NEW.blocks_assignment THEN
    NEW.blocks_actions := CASE NEW.entity_kind
      WHEN 'MACHINE' THEN ARRAY['assign', 'haul', 'machine_hours']::TEXT[]
      WHEN 'PROJECT' THEN ARRAY['assign', 'tender_submit']::TEXT[]
      ELSE ARRAY['assign']::TEXT[]
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS obligation_types_blocks_actions ON obligation_types;
CREATE TRIGGER obligation_types_blocks_actions
  BEFORE INSERT OR UPDATE OF blocks_assignment, blocks_actions ON obligation_types
  FOR EACH ROW EXECUTE FUNCTION obligation_types_sync_blocks_actions();

-- Postojeći redovi (ako firme već imaju tipove) — isti izraz kao trigger.
UPDATE obligation_types
   SET blocks_actions = CASE entity_kind
         WHEN 'MACHINE' THEN ARRAY['assign', 'haul', 'machine_hours']::TEXT[]
         WHEN 'PROJECT' THEN ARRAY['assign', 'tender_submit']::TEXT[]
         ELSE ARRAY['assign']::TEXT[]
       END
 WHERE blocks_assignment AND blocks_actions = ARRAY['assign']::TEXT[];

-- ---------------------------------------------------------------------------
-- 2. Obaveze
-- ---------------------------------------------------------------------------
ALTER TABLE obligations
  -- `NULL` = koristi `obligation_types.default_reminder_days`. Niz umjesto množenja redova:
  -- tri praga su i dalje jedna obaveza, ne tri.
  ADD COLUMN reminder_days INT[]
    CHECK (
      reminder_days IS NULL
      OR (cardinality(reminder_days) <= 8 AND array_position(reminder_days, NULL) IS NULL)
    ),
  -- Trajna obaveza (`expires_at IS NULL`) MORA imati datum do kojeg je ured provjerava.
  -- Bez toga „trajno“ znači „zauvijek neprovjereno“ — a to je isto kao da je nema.
  ADD COLUMN review_at DATE,
  ADD COLUMN reviewed_by TEXT,
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  -- Tok potvrde dokumenta (§1.1 tačka 3–4). `none` = tip ne traži provjeru.
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'none'
    CHECK (review_state IN ('none', 'pending_review', 'rejected')),
  -- Zašto je odbijeno. Obavezan kad je `rejected` — odbijanje bez razloga ne kaže radniku
  -- šta da popravi, pa se isti dokument šalje ponovo.
  ADD COLUMN review_note TEXT CHECK (review_note IS NULL OR length(btrim(review_note)) BETWEEN 1 AND 1000),
  ADD CONSTRAINT obligations_review_note_required
    CHECK (review_state <> 'rejected' OR review_note IS NOT NULL),
  -- Provjera „trajna obaveza ima datum provjere“ NIJE CHECK: `expires_at` je keš koji puni
  -- trigger `obligation_versions_sync_current` POSLIJE inserta, pa bi CHECK na INSERT-u vidio
  -- NULL i odbio svaki novi red. Zato odgođeni constraint trigger — provjerava na kraju
  -- transakcije, kad je keš pun (vidi §2a niže).
  ADD CONSTRAINT obligations_reviewed_fk FOREIGN KEY (reviewed_by, company_id)
    REFERENCES memberships (user_id, company_id) ON DELETE SET NULL;

-- Trajne obaveze koje već postoje nemaju `review_at`, pa bi ih novi CHECK odbio. Datum se
-- postavlja na godinu od danas: to je najmanje izmišljanja koje zadovoljava pravilo, a ured
-- ga odmah vidi u listi „provjera dospjela“ i može ga promijeniti.
UPDATE obligations
   SET review_at = (CURRENT_DATE + INTERVAL '1 year')::date
 WHERE expires_at IS NULL AND review_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2a. Trajna obaveza MORA imati datum provjere — provjera na kraju transakcije
-- ---------------------------------------------------------------------------
-- Zašto odgođeno: `obligations.expires_at` je keš koji piše trigger iz `obligation_versions`.
-- U trenutku INSERT-a u `obligations` rok još ne postoji (NULL), pa bi običan CHECK odbio i
-- ispravan red. Odgođeni trigger gleda stanje kad su svi upisi gotovi.
-- `NEW` u odgođenom triggeru je red KAKAV JE BIO u trenutku INSERT-a (expires_at NULL), a ne
-- kakav je na kraju transakcije. Zato se red ponovo čita iz tabele — inače bi provjera uvijek
-- vidjela „nema roka“ i odbila i ispravan unos.
CREATE OR REPLACE FUNCTION obligations_require_review_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_expires DATE;
  current_review  DATE;
BEGIN
  SELECT expires_at, review_at INTO current_expires, current_review
    FROM obligations WHERE id = NEW.id;

  -- Red je u međuvremenu obrisan — nema šta da se provjerava.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF current_expires IS NULL AND current_review IS NULL THEN
    RAISE EXCEPTION
      'Trajna obaveza (bez datuma isteka) mora imati datum provjere (review_at).'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'obligations_review_at_required_for_no_expiry';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER obligations_review_at_required
  AFTER INSERT OR UPDATE ON obligations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION obligations_require_review_at();

CREATE INDEX obligations_review_at_idx ON obligations (company_id, review_at)
  WHERE review_at IS NOT NULL AND superseded_by IS NULL;
CREATE INDEX obligations_review_state_idx ON obligations (company_id, review_state)
  WHERE review_state <> 'none' AND superseded_by IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Zahtjevi („svaki radnik mora imati ljekarski“)
-- ---------------------------------------------------------------------------
CREATE TABLE obligation_requirements (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_kind   TEXT NOT NULL CHECK (entity_kind IN ('WORKER', 'MACHINE', 'PROJECT')),
  type_id       TEXT NOT NULL,
  -- Na šta se pravilo primjenjuje. `ALL` = svi entiteti tog roda; ostali imaju `applies_value`
  -- (kategorija mašine, vrsta angažmana, projekat).
  applies_scope TEXT NOT NULL CHECK (applies_scope IN ('ALL', 'ENGAGEMENT', 'MACHINE_CATEGORY', 'PROJECT')),
  applies_value TEXT,
  is_required   BOOLEAN NOT NULL DEFAULT true,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,

  CONSTRAINT obligation_requirements_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT obligation_requirements_type_fk FOREIGN KEY (company_id, type_id)
    REFERENCES obligation_types (company_id, id) ON DELETE CASCADE,
  -- Opseg bez vrijednosti ili sa njom — nikad između. Inače pravilo `MACHINE_CATEGORY` bez
  -- kategorije tiho znači „sve mašine“, a to je drugo pravilo.
  CONSTRAINT obligation_requirements_scope_value CHECK (
    (applies_scope = 'ALL' AND applies_value IS NULL)
    OR (applies_scope <> 'ALL' AND applies_value IS NOT NULL)
  )
);

-- Isto pravilo se ne unosi dvaput. `COALESCE` je nužan: `NULL` u UNIQUE znači „različito“,
-- pa bi dva `ALL` pravila za isti tip prošla kao dva reda i `missing` bi brojao dvaput.
CREATE UNIQUE INDEX obligation_requirements_unique
  ON obligation_requirements (company_id, entity_kind, type_id, applies_scope, COALESCE(applies_value, ''));
CREATE INDEX obligation_requirements_active_idx ON obligation_requirements (company_id, entity_kind)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- 4. Kome ide obavještenje po tipu
-- ---------------------------------------------------------------------------
CREATE TABLE obligation_notify_roles (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type_id    TEXT NOT NULL,
  role       "Role" NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT obligation_notify_roles_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT obligation_notify_roles_type_fk FOREIGN KEY (company_id, type_id)
    REFERENCES obligation_types (company_id, id) ON DELETE CASCADE,
  CONSTRAINT obligation_notify_roles_unique UNIQUE (company_id, type_id, role)
);

-- ---------------------------------------------------------------------------
-- 5. Stanje obaveze — proširenje
-- ---------------------------------------------------------------------------
-- `missing` se NE računa ovdje (nije red). Ova funkcija odgovara na „šta je sa OVIM redom“.
--
-- Redoslijed grananja je prioritet prikaza iz §1.1 tačke 5:
--   superseded > expired > rejected > pending_review > expiring > valid > no_expiry(review_due)
DROP FUNCTION IF EXISTS obligation_state(DATE, INT[], DATE, BOOLEAN);

CREATE OR REPLACE FUNCTION obligation_state(
  p_expires_at   DATE,
  p_thresholds   INT[],
  p_today        DATE,
  p_superseded   BOOLEAN DEFAULT false,
  p_review_at    DATE    DEFAULT NULL,
  p_review_state TEXT    DEFAULT 'none'
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_superseded THEN 'superseded'
    -- Odbijen dokument blokira (spec 02 §15) — zato je ISPRED `expired`: odbijanje je
    -- svježa informacija ureda, a ne stari datum koji možda više ništa ne znači.
    WHEN p_review_state = 'rejected' THEN 'rejected'
    WHEN p_expires_at IS NULL THEN
      -- Trajna obaveza: stanje nosi datum provjere, ne datum isteka.
      CASE
        WHEN p_review_at IS NOT NULL AND p_review_at < p_today THEN 'expired'
        WHEN p_review_at IS NOT NULL
          AND p_review_at - p_today <= COALESCE((SELECT min(x) FROM unnest(p_thresholds) AS x), 0)
          THEN 'review_due'
        ELSE 'no_expiry'
      END
    WHEN p_expires_at < p_today THEN 'expired'
    WHEN p_review_state = 'pending_review' THEN 'pending_review'
    WHEN p_expires_at - p_today <= COALESCE((SELECT min(x) FROM unnest(p_thresholds) AS x), 0)
      THEN 'expiring'
    ELSE 'valid'
  END;
$$;

COMMENT ON FUNCTION obligation_state(DATE, INT[], DATE, BOOLEAN, DATE, TEXT) IS
  'Stanje jednog reda obaveze. `missing` se ne računa ovdje (to je odsustvo reda). '
  'Dan isteka NIJE istekao. Trajna obaveza (expires_at IS NULL) koristi review_at.';

-- ---------------------------------------------------------------------------
-- 6. RLS + politike
-- ---------------------------------------------------------------------------
ALTER TABLE obligation_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligation_requirements FORCE  ROW LEVEL SECURITY;
ALTER TABLE obligation_notify_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligation_notify_roles FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON obligation_requirements
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));
CREATE POLICY tenant_isolation ON obligation_notify_roles
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- ---------------------------------------------------------------------------
-- 7. Podrazumijevani zahtjevi za postojeće firme
-- ---------------------------------------------------------------------------
-- Bez ijednog zahtjeva ekran „Nedostaje“ je prazan, pa vlasnik ne vidi da funkcija postoji.
-- Ovo NE pravi obaveze — samo pravila iz kojih se `missing` računa (§1.2 tačka 11).
CREATE OR REPLACE FUNCTION companies_seed_obligation_requirements()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Redoslijed: triggeri se izvršavaju ABECEDNO po imenu, a `requirements` je ispred `types`.
  -- Pravila se računaju IZ tipova, pa tipove moramo osigurati sami — bez ovoga bi nova firma
  -- dobila tipove ali nijedno pravilo, i ekran „Nedostaje“ bi zauvijek bio prazan.
  -- `seed_obligation_types` je idempotentan (`ON CONFLICT DO NOTHING`), pa dvostruki poziv
  -- ništa ne kvari.
  PERFORM seed_obligation_types(NEW.id);
  PERFORM seed_obligation_requirements(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION seed_obligation_requirements(target_company TEXT)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO obligation_requirements (id, company_id, entity_kind, type_id, applies_scope, applies_value)
  SELECT target_company || '_obr_' || lower(t.code), target_company, t.entity_kind, t.id, 'ALL', NULL
    FROM obligation_types t
   WHERE t.company_id = target_company
     AND t.code IN ('MEDICAL', 'SAFETY_TRAINING', 'REGISTRATION')
  ON CONFLICT DO NOTHING;
$$;

-- Postojeće firme dobijaju pravila odmah; nove kroz trigger na `companies`, istim redom kao
-- tipovi obaveza (R3). Bez ovoga bi ekran „Nedostaje“ za novu firmu bio prazan zauvijek.
SELECT seed_obligation_requirements(id) FROM companies;

DROP TRIGGER IF EXISTS companies_seed_obligation_requirements ON companies;
CREATE TRIGGER companies_seed_obligation_requirements
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION companies_seed_obligation_requirements();

INSERT INTO public.schema_migrations (name)
VALUES ('20261124130000_f2_1_obligation_requirements')
ON CONFLICT DO NOTHING;
