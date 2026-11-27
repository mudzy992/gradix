-- =============================================================================
-- FAZA 7 (Modul 8) — tenderi: od prilike do dobijenog projekta.
--
-- Model: tender je MALI PROJEKAT PRIJE PROJEKTA. Zato predmjer (`tender_boq_items`) ima
-- ISTU strukturu kao `project_boq_items` — konverzija je tada kopija, a ne preslikavanje
-- dva različita oblika koje se vremenom raziđu.
--
-- Tri pravila koja ova migracija čuva u BAZI, a ne samo u kodu:
--   1. status je zatvoren skup od 9 vrijednosti; `DRAFT` se migrira u `OPPORTUNITY` bez
--      gubitka redova (stari `DRAFT` je značio „prilika“, ne „predano“);
--   2. cijena se NE prepisuje — svaka izmjena je novi red u `tender_price_revisions`
--      (append-only; nema UPDATE ni DELETE granta);
--   3. garancija bez roka ne postoji: `valid_until` je obavezan čim postoji iznos, jer
--      podsjetnik 30 dana prije isteka bez datuma nema šta da računa.
--
-- Zadani šifarnik (`tender_checklist_templates`) NIJE u migraciji — isti razlog kao kod
-- komponenti obračuna (F6): `created_by` pokazuje na STVARNOG korisnika, pa bi svaka firma
-- u bazi dobila redove koji drže RESTRICT vezu ka `users`. Set nastaje lenjo u servisu.
-- `obligation_types` redovi za `TENDER_DEADLINE`/`TENDER_QUESTIONS` idu u `seed_obligation_types()`,
-- jer ta funkcija već puni tipove po firmi i ne dira `created_by`.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. Tender: rokovi, izvor, cijena

ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS questions_deadline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS site_visit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS portal_name TEXT,
  ADD COLUMN IF NOT EXISTS external_ref TEXT,
  ADD COLUMN IF NOT EXISTS estimated_value_cents BIGINT,
  ADD COLUMN IF NOT EXISTS price_source TEXT NOT NULL DEFAULT 'CALCULATED',
  ADD COLUMN IF NOT EXISTS markup_pct NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS current_revision INTEGER NOT NULL DEFAULT 0,
  -- Odluka o učešću (`GO_NO_GO`): DA/NE + razlog + ko i kad. Bez ovoga prelazak u
  -- `PREPARATION` ne bi imao šta da provjeri (spec 08 §1.1/3).
  ADD COLUMN IF NOT EXISTS participate BOOLEAN,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS decided_by TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

/* Migracija statusa prije novog CHECK-a: `DRAFT` je u v2 značio „prilika“, a u novom toku
   prilika je `OPPORTUNITY`. Redovi se NE brišu i ne prepisuju im se drugi podaci. */
UPDATE public.tenders SET status = 'OPPORTUNITY' WHERE status = 'DRAFT';

ALTER TABLE public.tenders DROP CONSTRAINT tenders_status_check;
ALTER TABLE public.tenders
  ADD CONSTRAINT tenders_status_check CHECK (status IN (
    'OPPORTUNITY', 'GO_NO_GO', 'PREPARATION', 'SUBMITTED', 'EVALUATION',
    'WON', 'LOST', 'WITHDRAWN', 'CANCELLED'
  )),
  ADD CONSTRAINT tenders_source_check
    CHECK (source IS NULL OR source IN ('PORTAL', 'INVITATION', 'DIRECT', 'OTHER')),
  ADD CONSTRAINT tenders_price_source_check
    CHECK (price_source IN ('CALCULATED', 'MANUAL')),
  ADD CONSTRAINT tenders_portal_name_check
    CHECK (portal_name IS NULL OR length(btrim(portal_name)) <= 120),
  ADD CONSTRAINT tenders_external_ref_check
    CHECK (external_ref IS NULL OR length(btrim(external_ref)) <= 60),
  ADD CONSTRAINT tenders_estimated_value_check
    CHECK (estimated_value_cents IS NULL OR estimated_value_cents >= 0),
  ADD CONSTRAINT tenders_markup_check
    CHECK (markup_pct IS NULL OR (markup_pct >= -100 AND markup_pct <= 1000)),
  ADD CONSTRAINT tenders_current_revision_check CHECK (current_revision >= 0),
  ADD CONSTRAINT tenders_decision_reason_check
    CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) <= 1000),
  /* Odluka je cjelina: `participate` bez `decided_by`/`decided_at` bila bi tvrdnja bez
     zapisa o tome ko ju je donio, a `decided_by` bez odluke je prazan trag. */
  ADD CONSTRAINT tenders_decision_shape_check CHECK (
    (participate IS NULL AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
    OR (participate IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  ADD CONSTRAINT tenders_decided_by_fk
    FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE RESTRICT;

/* Referentni broj naručioca je jedinstven po firmi KAD postoji (§1.2/7): dva tendera sa istim
   brojem na istom portalu su isti tender unesen dvaput. */
CREATE UNIQUE INDEX tenders_external_ref_unique
  ON public.tenders (company_id, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE INDEX tenders_company_deadline_idx
  ON public.tenders (company_id, deadline_at)
  WHERE deadline_at IS NOT NULL;

-- Minimalna marža je parametar FIRME, ne kod: ispod nje cijena traži odobrenje (§1.3/13).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS min_markup_pct NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_min_markup_check CHECK (min_markup_pct BETWEEN 0 AND 100);

-- ---------------------------------------------------------------- 2. Predmjer (kalkulacija)

/* Ista struktura kao `project_boq_items` (§1.3/10) — `code`, `description`, `unit`,
   `quantity`, `unit_price_cents`. Razlika je samo `unit_cost_cents`: ovdje je trošak
   PODATAK stavke (u projektu je trošak u knjizi), jer se marža računa iz njega. */
CREATE TABLE public.tender_boq_items (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL,
  tender_id        TEXT NOT NULL,
  code             TEXT NOT NULL,
  description      TEXT NOT NULL,
  unit             TEXT NOT NULL,
  quantity         NUMERIC(14, 3) NOT NULL,
  unit_cost_cents  BIGINT NOT NULL DEFAULT 0,
  unit_price_cents BIGINT NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by       TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by       TEXT NOT NULL,
  CONSTRAINT tender_boq_items_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT tender_boq_items_description_check CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  CONSTRAINT tender_boq_items_unit_check CHECK (char_length(btrim(unit)) BETWEEN 1 AND 16),
  CONSTRAINT tender_boq_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT tender_boq_items_cost_check CHECK (unit_cost_cents >= 0),
  CONSTRAINT tender_boq_items_price_check CHECK (unit_price_cents >= 0),
  CONSTRAINT tender_boq_items_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT tender_boq_items_code_unique UNIQUE (company_id, tender_id, code),
  CONSTRAINT tender_boq_items_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT tender_boq_items_tender_fk
    FOREIGN KEY (company_id, tender_id) REFERENCES public.tenders(company_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_boq_items_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT tender_boq_items_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX tender_boq_items_tender_idx
  ON public.tender_boq_items (company_id, tender_id, sort_order);

/* Resursi: rad, mašina, materijal, podizvođač. Cijena se PREDLAŽE iz `worker_rates` i
   `machine_cost_components` (Modul 4/5), pa veza može biti NULL kad je unos ručan — ali
   kad postoji, pokazuje na stvarni izvor cijene, ne na „procjenu iz glave“ (§1.3/11). */
CREATE TABLE public.tender_resources (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL,
  tender_id        TEXT NOT NULL,
  kind             TEXT NOT NULL,
  description      TEXT NOT NULL,
  quantity         NUMERIC(14, 3) NOT NULL,
  unit             TEXT NOT NULL,
  unit_cost_cents  BIGINT NOT NULL,
  currency_code    TEXT NOT NULL,
  worker_rate_ref  TEXT,
  machine_id       TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by       TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by       TEXT NOT NULL,
  CONSTRAINT tender_resources_kind_check
    CHECK (kind IN ('LABOR', 'MACHINE', 'MATERIAL', 'SUBCONTRACTOR', 'OTHER')),
  CONSTRAINT tender_resources_description_check
    CHECK (length(btrim(description)) BETWEEN 1 AND 300),
  CONSTRAINT tender_resources_unit_check CHECK (char_length(btrim(unit)) BETWEEN 1 AND 16),
  CONSTRAINT tender_resources_quantity_check CHECK (quantity > 0),
  CONSTRAINT tender_resources_cost_check CHECK (unit_cost_cents >= 0),
  CONSTRAINT tender_resources_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT tender_resources_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT tender_resources_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT tender_resources_tender_fk
    FOREIGN KEY (company_id, tender_id) REFERENCES public.tenders(company_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_resources_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT tender_resources_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT tender_resources_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX tender_resources_tender_idx
  ON public.tender_resources (company_id, tender_id, sort_order);

/* Revizije cijene: APPEND-ONLY. `approved_at`/`approved_by` su NULL dok revizija nije
   odobrena; ponuda se šalje iz POSLJEDNJE ODOBRENE revizije (§1.3/13, §1.6/22.1). */
CREATE TABLE public.tender_price_revisions (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,
  tender_id           TEXT NOT NULL,
  revision            INTEGER NOT NULL,
  direct_cost_cents   BIGINT NOT NULL,
  markup_pct          NUMERIC(6, 2) NOT NULL,
  risk_reserve_pct    NUMERIC(6, 2) NOT NULL DEFAULT 0,
  discount_pct        NUMERIC(6, 2) NOT NULL DEFAULT 0,
  offered_value_cents BIGINT NOT NULL,
  currency_code       TEXT NOT NULL,
  reason              TEXT,
  approved_at         TIMESTAMPTZ,
  approved_by         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by          TEXT NOT NULL,
  CONSTRAINT tender_price_revisions_revision_check CHECK (revision >= 1),
  CONSTRAINT tender_price_revisions_cost_check CHECK (direct_cost_cents >= 0),
  CONSTRAINT tender_price_revisions_pct_check
    CHECK (markup_pct BETWEEN -100 AND 1000
       AND risk_reserve_pct BETWEEN 0 AND 100
       AND discount_pct BETWEEN 0 AND 100),
  CONSTRAINT tender_price_revisions_offered_check CHECK (offered_value_cents >= 0),
  CONSTRAINT tender_price_revisions_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT tender_price_revisions_reason_check
    CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 1000),
  CONSTRAINT tender_price_revisions_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT tender_price_revisions_number_unique UNIQUE (company_id, tender_id, revision),
  CONSTRAINT tender_price_revisions_approval_shape_check
    CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  CONSTRAINT tender_price_revisions_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT tender_price_revisions_tender_fk
    FOREIGN KEY (company_id, tender_id) REFERENCES public.tenders(company_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_price_revisions_approved_by_fk
    FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT tender_price_revisions_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX tender_price_revisions_tender_idx
  ON public.tender_price_revisions (company_id, tender_id, revision DESC);

-- ---------------------------------------------------------------- 3. Kontrolna lista i garancije

CREATE TABLE public.tender_checklist_templates (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  code        TEXT NOT NULL,
  label       TEXT NOT NULL,
  required    BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by  TEXT NOT NULL,
  CONSTRAINT tender_checklist_templates_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT tender_checklist_templates_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CONSTRAINT tender_checklist_templates_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT tender_checklist_templates_code_unique UNIQUE (company_id, code),
  CONSTRAINT tender_checklist_templates_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT tender_checklist_templates_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT tender_checklist_templates_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

/* Stavka checkliste nosi i GARANCIJU (§1.4/18): isti red, jer je ponudbena garancija upravo
   jedan od dokumenata koje treba priložiti. `guarantee_type` je NULL za običan dokument. */
CREATE TABLE public.tender_checklist_items (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  tender_id       TEXT NOT NULL,
  code            TEXT NOT NULL,
  label           TEXT NOT NULL,
  required        BOOLEAN NOT NULL DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'MISSING',
  attachment_id   TEXT,
  valid_until     DATE,
  note            TEXT,
  guarantee_type  TEXT,
  bank            TEXT,
  amount_cents    BIGINT,
  returned_at     TIMESTAMPTZ,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by      TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by      TEXT NOT NULL,
  CONSTRAINT tender_checklist_items_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT tender_checklist_items_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CONSTRAINT tender_checklist_items_status_check
    CHECK (status IN ('MISSING', 'ATTACHED', 'NOT_APPLICABLE')),
  CONSTRAINT tender_checklist_items_guarantee_check
    CHECK (guarantee_type IS NULL OR guarantee_type IN ('BID', 'PERFORMANCE', 'ADVANCE', 'WARRANTY')),
  CONSTRAINT tender_checklist_items_bank_check
    CHECK (bank IS NULL OR length(btrim(bank)) <= 120),
  CONSTRAINT tender_checklist_items_amount_check CHECK (amount_cents IS NULL OR amount_cents > 0),
  CONSTRAINT tender_checklist_items_note_check CHECK (note IS NULL OR length(note) <= 1000),
  /* Garancija BEZ roka ne postoji (§1.4/18): podsjetnik 30 dana prije isteka nema od čega
     da računa, a povrat garancije bi bio događaj bez datuma. */
  CONSTRAINT tender_checklist_items_guarantee_validity_check
    CHECK (guarantee_type IS NULL OR valid_until IS NOT NULL),
  /* `ATTACHED` bez priloga bila bi tvrdnja bez dokaza; `NOT_APPLICABLE` bez razloga bila bi
     tišina koja pušta tender dalje (spec 08 §1.4/16). */
  CONSTRAINT tender_checklist_items_shape_check CHECK (
    (status = 'MISSING' AND attachment_id IS NULL)
    OR (status = 'ATTACHED' AND attachment_id IS NOT NULL)
    OR (status = 'NOT_APPLICABLE' AND attachment_id IS NULL AND note IS NOT NULL AND length(btrim(note)) >= 3)
  ),
  CONSTRAINT tender_checklist_items_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT tender_checklist_items_code_unique UNIQUE (company_id, tender_id, code),
  CONSTRAINT tender_checklist_items_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT tender_checklist_items_tender_fk
    FOREIGN KEY (company_id, tender_id) REFERENCES public.tenders(company_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_checklist_items_attachment_fk
    FOREIGN KEY (attachment_id) REFERENCES public.attachments(id) ON DELETE RESTRICT,
  CONSTRAINT tender_checklist_items_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT tender_checklist_items_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX tender_checklist_items_tender_idx
  ON public.tender_checklist_items (company_id, tender_id, sort_order);

/* Garancije koje ističu — worker `reminders.scan` traži upravo ovaj skup (§1.4/18). */
CREATE INDEX tender_checklist_items_guarantee_expiry_idx
  ON public.tender_checklist_items (company_id, valid_until)
  WHERE guarantee_type IS NOT NULL AND returned_at IS NULL;

-- ---------------------------------------------------------------- 4. Ishod

/* Ishod je JEDAN po tenderu i nosi razlog gubitka. Nije u `tenders` koloni: tek poslije
   ishoda se zna ko je pobijedio i po kojoj cijeni, a to je podatak za analizu, ne status. */
CREATE TABLE public.tender_outcomes (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,
  tender_id           TEXT NOT NULL,
  result              TEXT NOT NULL,
  lost_reason         TEXT,
  winner_partner_id   TEXT,
  winner_value_cents  BIGINT,
  bidders_count       INTEGER,
  our_rank            INTEGER,
  note                TEXT,
  recorded_by         TEXT NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tender_outcomes_result_check
    CHECK (result IN ('WON', 'LOST', 'WITHDRAWN', 'CANCELLED')),
  CONSTRAINT tender_outcomes_lost_reason_check
    CHECK (lost_reason IS NULL OR lost_reason IN ('PRICE', 'TECHNICAL', 'DOCUMENTATION', 'RELATIONSHIP', 'SCOPE', 'OTHER')),
  /* Razlog je OBAVEZAN za svaki ishod osim dobijenog (§1.5/20): „izgubili smo“ bez razloga
     ne mijenja nijednu buduću odluku. */
  CONSTRAINT tender_outcomes_reason_required_check
    CHECK (result = 'WON' OR lost_reason IS NOT NULL),
  CONSTRAINT tender_outcomes_winner_value_check
    CHECK (winner_value_cents IS NULL OR winner_value_cents >= 0),
  CONSTRAINT tender_outcomes_bidders_check
    CHECK (bidders_count IS NULL OR bidders_count BETWEEN 1 AND 1000),
  CONSTRAINT tender_outcomes_rank_check CHECK (our_rank IS NULL OR our_rank BETWEEN 1 AND 1000),
  CONSTRAINT tender_outcomes_note_check CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT tender_outcomes_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT tender_outcomes_tender_unique UNIQUE (company_id, tender_id),
  CONSTRAINT tender_outcomes_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT tender_outcomes_tender_fk
    FOREIGN KEY (company_id, tender_id) REFERENCES public.tenders(company_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_outcomes_winner_fk
    FOREIGN KEY (company_id, winner_partner_id) REFERENCES public.partners(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT tender_outcomes_recorded_by_fk
    FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------- 5. Faze i tim (za konverziju)

CREATE TABLE public.tender_phases (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  tender_id     TEXT NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  weight        INTEGER NOT NULL DEFAULT 1,
  planned_start DATE,
  planned_end   DATE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by    TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by    TEXT NOT NULL,
  CONSTRAINT tender_phases_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT tender_phases_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  -- Težina ≥ 1 je ista pravila kao `project_phases` (F5): faza bez težine tiho ispada.
  CONSTRAINT tender_phases_weight_check CHECK (weight BETWEEN 1 AND 1000),
  CONSTRAINT tender_phases_period_check
    CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
  CONSTRAINT tender_phases_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT tender_phases_code_unique UNIQUE (company_id, tender_id, code),
  CONSTRAINT tender_phases_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT tender_phases_tender_fk
    FOREIGN KEY (company_id, tender_id) REFERENCES public.tenders(company_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_phases_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT tender_phases_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE TABLE public.tender_team (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  tender_id   TEXT NOT NULL,
  worker_id   TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by  TEXT NOT NULL,
  CONSTRAINT tender_team_role_check CHECK (role IN ('PM', 'SUPERVISOR', 'MEMBER')),
  CONSTRAINT tender_team_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT tender_team_worker_unique UNIQUE (company_id, tender_id, worker_id),
  CONSTRAINT tender_team_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT tender_team_tender_fk
    FOREIGN KEY (company_id, tender_id) REFERENCES public.tenders(company_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_team_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT tender_team_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

/* Samo jedan vođa (PM) po tenderu: dva PM-a na istom poslu znače da nijedan nije odgovoran,
   a konverzija bi morala da bira između njih bez pravila. */
CREATE UNIQUE INDEX tender_team_single_pm
  ON public.tender_team (company_id, tender_id)
  WHERE role = 'PM';

-- ---------------------------------------------------------------- 6. RLS + grantovi

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tender_boq_items', 'tender_resources', 'tender_price_revisions',
    'tender_checklist_templates', 'tender_checklist_items', 'tender_outcomes',
    'tender_phases', 'tender_team'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tender_boq_items TO gradix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tender_resources TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tender_price_revisions TO gradix_app;

/* Revizija je append-only: `UPDATE` postoji SAMO zato što odobrenje upisuje `approved_at`
   i `approved_by` na postojeći red. Triger brani svaku drugu izmjenu (iznos, maržu,
   reviziju) i svaki UPDATE već odobrene revizije — inače bi „odobreno“ moglo tiho postati
   „odobreno po drugoj cijeni“, a to je jedina stvar koju revizija dokazuje. */
CREATE OR REPLACE FUNCTION tender_price_revision_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id <> OLD.company_id
     OR NEW.tender_id <> OLD.tender_id
     OR NEW.revision <> OLD.revision
     OR NEW.direct_cost_cents <> OLD.direct_cost_cents
     OR NEW.markup_pct <> OLD.markup_pct
     OR NEW.risk_reserve_pct <> OLD.risk_reserve_pct
     OR NEW.discount_pct <> OLD.discount_pct
     OR NEW.offered_value_cents <> OLD.offered_value_cents
     OR NEW.currency_code <> OLD.currency_code
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'TENDER_PRICE_REVISION_IMMUTABLE'
      USING ERRCODE = '23514',
            HINT = 'Cijena se mijenja novom revizijom, ne prepisivanjem.';
  END IF;
  IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'TENDER_PRICE_REVISION_IMMUTABLE'
      USING ERRCODE = '23514',
            HINT = 'Odobrenje se ne mijenja; nova cijena je nova revizija.';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tender_price_revisions_immutable
  BEFORE UPDATE ON public.tender_price_revisions
  FOR EACH ROW EXECUTE FUNCTION tender_price_revision_immutable();
GRANT SELECT, INSERT, UPDATE ON TABLE public.tender_checklist_templates TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tender_checklist_items TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.tender_outcomes TO gradix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tender_phases TO gradix_app;
GRANT SELECT, INSERT, DELETE ON TABLE public.tender_team TO gradix_app;

-- ---------------------------------------------------------------- 7. Tipovi obaveza

/* Prijelaz u `PREPARATION` pravi DVA roka (rok za pitanja i rok za predaju) — jedan posao,
   ne ručni unos dvaju redova (§1.2/9). Oba su `blocks_assignment = false`: tender nije
   dodjela radnika, pa rok ne smije blokirati raspored. */
CREATE OR REPLACE FUNCTION seed_obligation_types(target_company TEXT)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO obligation_types (id, company_id, code, label, entity_kind, default_reminder_days,
                                requires_attachment, sort_order, blocks_assignment)
  VALUES
    (target_company || '_obt_medical',        target_company, 'MEDICAL',          'Ljekarski pregled',           'WORKER',  '{60,30,15,7}', true,  10, true),
    (target_company || '_obt_safety',         target_company, 'SAFETY_TRAINING',  'Obuka iz zaštite na radu',    'WORKER',  '{60,30,15,7}', true,  20, true),
    (target_company || '_obt_height',         target_company, 'WORK_AT_HEIGHT',   'Rad na visini',               'WORKER',  '{60,30,15,7}', true,  30, true),
    (target_company || '_obt_excavation',     target_company, 'EXCAVATION',       'Radovi iskopa',               'WORKER',  '{30,15,7}',    false, 40, false),
    (target_company || '_obt_confined',       target_company, 'CONFINED_SPACE',   'Rad u skučenom prostoru',     'WORKER',  '{60,30,15,7}', true,  50, false),
    (target_company || '_obt_machine_permit', target_company, 'MACHINE_LICENCE',  'Ovlaštenje za mašinu',        'WORKER',  '{60,30,15,7}', true,  60, true),
    (target_company || '_obt_driving',        target_company, 'DRIVING_LICENCE',  'Vozačka dozvola',             'WORKER',  '{60,30,15,7}', false, 70, false),
    (target_company || '_obt_first_aid',      target_company, 'FIRST_AID',        'Prva pomoć',                  'WORKER',  '{60,30,15,7}', true,  80, false),
    (target_company || '_obt_registration',   target_company, 'REGISTRATION',     'Registracija',                'MACHINE', '{30,15,7}',    true,  10, true),
    (target_company || '_obt_inspection',     target_company, 'TECH_INSPECTION',  'Tehnički pregled',            'MACHINE', '{30,15,7}',    true,  20, true),
    (target_company || '_obt_insurance',      target_company, 'INSURANCE',        'Osiguranje',                  'MACHINE', '{30,15,7}',    true,  30, true),
    (target_company || '_obt_tachograph',     target_company, 'TACHOGRAPH',       'Tahograf / kalibracija',      'MACHINE', '{30,15,7}',    true,  40, false),
    (target_company || '_obt_crane',          target_company, 'CRANE_ATTEST',     'Atest dizalice',              'MACHINE', '{60,30,15,7}', true,  50, false),
    (target_company || '_obt_extinguisher',   target_company, 'EXTINGUISHER',     'Vatrogasni aparat',           'MACHINE', '{30,15,7}',    false, 60, false),
    (target_company || '_obt_warranty',       target_company, 'WARRANTY',         'Garancija',                   'MACHINE', '{}',           false, 70, false),
    (target_company || '_obt_company_reg',    target_company, 'COMPANY_REGISTRATION', 'Registracija firme',      'COMPANY', '{60,30,15,7}', true,  10, true),
    (target_company || '_obt_licence',        target_company, 'LICENCE',          'Licenca',                     'COMPANY', '{60,30,15,7}', true,  20, true),
    (target_company || '_obt_certificate',    target_company, 'CERTIFICATE',      'Certifikat',                  'COMPANY', '{60,30,15,7}', true,  30, false),
    (target_company || '_obt_company_ins',    target_company, 'COMPANY_INSURANCE','Osiguranje firme',            'COMPANY', '{30,15,7}',    true,  40, false),
    (target_company || '_obt_building_permit', target_company, 'BUILDING_PERMIT', 'Građevinska dozvola',        'PROJECT', '{90,60,30,15}', true,  10, true),
    (target_company || '_obt_consent',        target_company, 'CONSENT',          'Saglasnost',                  'PROJECT', '{30,15,7}',    true,  20, true),
    (target_company || '_obt_road_closure',   target_company, 'ROAD_CLOSURE',     'Dozvola za obustavu saobraćaja','PROJECT', '{30,15,7}',  true,  30, true),
    (target_company || '_obt_public_area',    target_company, 'PUBLIC_AREA',      'Zauzeće javne površine',      'PROJECT', '{30,15,7}',    true,  40, false),
    (target_company || '_obt_environment',    target_company, 'ENVIRONMENT',      'Okolišna saglasnost',         'PROJECT', '{60,30,15,7}', true,  50, true),
    (target_company || '_obt_hse_plan',       target_company, 'HSE_PLAN',         'Elaborat HSE',                'PROJECT', '{30,15,7}',    false, 60, false),
    (target_company || '_obt_site_plan',      target_company, 'SITE_PLAN',        'Plan organizacije gradilišta','PROJECT', '{30,15,7}',   false, 70, true),
    (target_company || '_obt_abnormal_load',  target_company, 'ABNORMAL_LOAD',    'Dozvola za vanredni prijevoz','PROJECT', '{30,15,7}',   true,  80, false),
    (target_company || '_obt_handover',       target_company, 'TECH_HANDOVER',    'Tehnički prijem',             'PROJECT', '{}',           true,  90, false),
    (target_company || '_obt_tender_docs',    target_company, 'TENDER_DOCS',      'Tenderska dokumentacija',     'TENDER',  '{14,7,3,1}',   true,  10, false),
    (target_company || '_obt_tender_deadline', target_company, 'TENDER_DEADLINE', 'Rok za predaju ponude',       'TENDER',  '{14,7,3,1}',   false, 20, false),
    (target_company || '_obt_tender_questions', target_company, 'TENDER_QUESTIONS','Rok za pitanja naručiocu',   'TENDER',  '{14,7,3,1}',   false, 30, false)
  ON CONFLICT (company_id, code) DO NOTHING;
$$;

/* Postojeće firme: tri nova TENDER tipa, isti obrazac kao `TENDER_DOCS` u R7. */
INSERT INTO public.obligation_types (
  id, company_id, code, label, entity_kind, default_reminder_days,
  requires_attachment, sort_order, blocks_assignment
)
SELECT
  c.id || '_obt_tender_deadline', c.id, 'TENDER_DEADLINE', 'Rok za predaju ponude', 'TENDER',
  '{14,7,3,1}', false, 20, false
FROM public.companies c
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO public.obligation_types (
  id, company_id, code, label, entity_kind, default_reminder_days,
  requires_attachment, sort_order, blocks_assignment
)
SELECT
  c.id || '_obt_tender_questions', c.id, 'TENDER_QUESTIONS', 'Rok za pitanja naručiocu', 'TENDER',
  '{14,7,3,1}', false, 30, false
FROM public.companies c
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO public.schema_migrations (name)
VALUES ('20261125120000_f7_1_tenderi')
ON CONFLICT DO NOTHING;

COMMIT;
