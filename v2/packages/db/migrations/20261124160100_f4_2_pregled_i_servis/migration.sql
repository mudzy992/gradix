-- =============================================================================
-- FAZA 4 (Modul 5) — dopuna prve migracije: fotografija za kritični `FAIL` i servisni nalog.
--
-- Razdvojeno od `f4_1` namjerno: prva migracija je čisto aditivna nad postojećim semama i može
-- se pustiti na produkciju bez ijednog novog toka. Ova uvodi DVA nova toka i zato je odvojen
-- korak koji se može vratiti nezavisno:
--
--   1. kritična `FAIL` stavka pregleda traži FOTOGRAFIJU (spec 05 §1.5.22) — fotografija se ne
--      može poslati u istom zahtjevu u kojem nastaje pregled (prilog traži `check_id`), pa
--      pregled nosi `photo_required` i `photo_confirmed_at`, a potvrda je zasebna radnja;
--   2. `APPROVED` kvar otvara SERVISNI NALOG (spec 05 §1.6.25). Tabela `service_orders` je
--      minimalna — Modul 8 je puni; ovdje postoji zato što bez nje „odobreno" ne pokreće ništa,
--      pa se trošak popravke nikad ne bi pojavio na projektu.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. Fotografija kritičnog nalaza

ALTER TABLE public.machine_daily_checks
  /*
   * `photo_required` se ZAPISUJE, a ne izračunava pri čitanju: šablon se može poslije izmijeniti
   * (stavka prestane biti kritična), a pitanje „je li ovaj pregled tražio fotografiju" mora
   * ostati odgovoreno onako kako je bilo u trenutku pregleda.
   */
  ADD COLUMN IF NOT EXISTS photo_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS photo_confirmed_by TEXT;

ALTER TABLE public.machine_daily_checks
  ADD CONSTRAINT machine_daily_checks_photo_confirm_fk
    FOREIGN KEY (photo_confirmed_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT machine_daily_checks_photo_pair_check
    CHECK ((photo_confirmed_at IS NULL) = (photo_confirmed_by IS NULL)),
  /*
   * Potvrda fotografije postoji SAMO kad je fotografija tražena. Bez ovog uslova bi se potvrda
   * mogla upisati na pregled koji je ne traži — i tada bi izvještaj tvrdio da je dokaz provjeren
   * tamo gdje nikad nije ni zatražen.
   */
  ADD CONSTRAINT machine_daily_checks_photo_required_check
    CHECK (photo_confirmed_at IS NULL OR photo_required);

COMMENT ON COLUMN public.machine_daily_checks.photo_required IS
  'Kritična FAIL stavka šablona (spec 05 §1.5.22) traži fotografiju prije potvrde pregleda. '
  'Rad NIJE automatski blokiran — odluka je čovjeka, ali dokaz mora postojati.';

-- ---------------------------------------------------------------- 2. Servisni nalog iz kvarda

CREATE TABLE public.service_orders (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL,
  machine_id       TEXT NOT NULL,
  fault_id         TEXT NOT NULL,
  partner_id       TEXT,
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  status           TEXT NOT NULL DEFAULT 'OPEN',
  description      TEXT NOT NULL,
  amount_cents     BIGINT,
  currency_code    TEXT,
  closed_at        TIMESTAMPTZ,
  created_by       TEXT,
  CONSTRAINT service_orders_status_check
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  CONSTRAINT service_orders_description_check
    CHECK (length(btrim(description)) BETWEEN 3 AND 2000),
  CONSTRAINT service_orders_amount_check
    CHECK (amount_cents IS NULL OR amount_cents >= 0),
  CONSTRAINT service_orders_currency_check
    CHECK (currency_code IS NULL OR char_length(currency_code) = 3),
  CONSTRAINT service_orders_amount_pair_check
    CHECK ((amount_cents IS NULL) = (currency_code IS NULL)),
  CONSTRAINT service_orders_company_id_unique UNIQUE (company_id, id),
  -- Jedan kvar = jedan servisni nalog. Bez ovoga bi svaki prelaz u APPROVED (i svaka ispravka
  -- statusa) otvorio novi nalog, pa bi trošak popravke bio uvećan onoliko puta koliko je klikova.
  CONSTRAINT service_orders_fault_unique UNIQUE (company_id, fault_id),
  CONSTRAINT service_orders_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT service_orders_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_orders_fault_fk
    FOREIGN KEY (company_id, fault_id) REFERENCES public.machine_faults(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_orders_partner_fk
    FOREIGN KEY (company_id, partner_id) REFERENCES public.partners(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT service_orders_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX service_orders_machine_idx
  ON public.service_orders (company_id, machine_id, opened_at DESC);

COMMENT ON TABLE public.service_orders IS
  'Servisni nalog otvoren prelazom kvara u APPROVED (spec 05 §1.6.25). Modul 8 ga puni; ovdje je '
  'veza kvar→nalog i iznos koji ulazi u `project_cost_entries` sa `source_type = SERVICE_ORDER`.';

/**
 * Kvar prešao u `APPROVED` → otvori nalog, ako ga još nema.
 *
 * Triger, a ne kod servisa: `APPROVED` se postavlja na DVA mjesta (odobrenje zahtjeva i ručna
 * promjena statusa), a treće mjesto bi se lako zaboravilo. `ON CONFLICT DO NOTHING` čuva
 * idempotentnost — ponovni prelaz ne pravi drugi nalog.
 */
CREATE OR REPLACE FUNCTION public.machine_fault_open_service_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fault_service_order$
DECLARE
  v_currency TEXT;
BEGIN
  IF NEW.status <> 'APPROVED' OR (TG_OP = 'UPDATE' AND OLD.status = 'APPROVED') THEN
    RETURN NEW;
  END IF;

  SELECT currency INTO v_currency FROM public.companies WHERE id = NEW.company_id;

  INSERT INTO public.service_orders
    (id, company_id, machine_id, fault_id, partner_id, description, amount_cents,
     currency_code, created_by)
  VALUES (
    'svo_' || replace(gen_random_uuid()::text, '-', ''),
    NEW.company_id,
    NEW.machine_id,
    NEW.id,
    NEW.partner_id,
    left('Servis po kvaru: ' || NEW.title, 2000),
    NEW.estimated_cost_cents,
    CASE WHEN NEW.estimated_cost_cents IS NULL THEN NULL ELSE COALESCE(v_currency, 'BAM') END,
    NEW.updated_by
  )
  ON CONFLICT (company_id, fault_id) DO NOTHING;

  RETURN NEW;
END;
$fault_service_order$;

CREATE TRIGGER machine_faults_open_service_order
  AFTER INSERT OR UPDATE OF status ON public.machine_faults
  FOR EACH ROW EXECUTE FUNCTION public.machine_fault_open_service_order();

-- ---------------------------------------------------------------- 3. RLS na novoj tabeli

ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.service_orders
  USING (company_id = current_setting('app.company_id'::text, true))
  WITH CHECK (company_id = current_setting('app.company_id'::text, true));

INSERT INTO public.schema_migrations (name)
VALUES ('20261124160100_f4_2_pregled_i_servis')
ON CONFLICT DO NOTHING;

COMMIT;
