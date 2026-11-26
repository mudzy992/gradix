-- F10A-1: centralno skladište, zalihe po skladištu i jedinstven ledger cisterne.
BEGIN;

ALTER TABLE public.companies ADD COLUMN stock_count_tolerance_cents BIGINT NOT NULL DEFAULT 20000
  CHECK (stock_count_tolerance_cents >= 0);

CREATE TABLE public.warehouses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  kind TEXT NOT NULL CHECK (kind IN ('CENTRAL', 'SITE', 'TANK')),
  project_id TEXT,
  address TEXT CHECK (address IS NULL OR length(address) <= 500),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT warehouses_site_project_check CHECK (kind <> 'SITE' OR project_id IS NOT NULL),
  CONSTRAINT warehouses_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT warehouses_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT warehouses_project_fk FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX warehouses_one_central ON public.warehouses(company_id) WHERE kind = 'CENTRAL';

-- Jedinstvena zadana lokacija po postojećoj firmi, uključujući one bez članova.
INSERT INTO public.warehouses(id, company_id, code, name, kind)
SELECT 'whc_' || md5(id), id, 'CENTRALNO', 'Centralno', 'CENTRAL' FROM public.companies;

ALTER TABLE public.stock_items
  ADD COLUMN default_unit_cost_cents BIGINT CHECK (default_unit_cost_cents IS NULL OR default_unit_cost_cents >= 0),
  ADD COLUMN system_managed BOOLEAN NOT NULL DEFAULT false;
-- Stari model cisterne nije bilježio korisnika koji je kreirao cisternu. Samo migracijski
-- sistemski artikal smije imati nepoznatog autora; ne izmišljamo historijskog korisnika.
ALTER TABLE public.stock_items ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.stock_items ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE public.stock_items ADD CONSTRAINT stock_items_actor_check
  CHECK ((created_by IS NOT NULL AND updated_by IS NOT NULL) OR system_managed);

ALTER TABLE public.stock_movements
  ADD COLUMN transfer_id TEXT,
  ADD COLUMN client_generated_id UUID,
  ADD COLUMN amount_cents BIGINT CHECK (amount_cents IS NULL OR amount_cents >= 0),
  ADD COLUMN legacy_ignored BOOLEAN NOT NULL DEFAULT false;
-- Vrijednost je zbirna, ne zaokružena jedinična cijena: transfer prenosi isti iznos.
UPDATE public.stock_movements SET amount_cents = round(quantity * unit_cost_cents)
 WHERE kind IN ('IN','OUT') AND unit_cost_cents IS NOT NULL;
-- F8 nije računao stare COUNT/TRANSFER redove; ostaju historija, ali bez promjene stanja.
UPDATE public.stock_movements SET legacy_ignored = true WHERE kind IN ('COUNT', 'TRANSFER');
UPDATE public.stock_movements sm SET warehouse_id = w.id
  FROM public.warehouses w WHERE w.company_id = sm.company_id AND w.kind = 'CENTRAL';
ALTER TABLE public.stock_movements ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_warehouse_fk FOREIGN KEY (company_id, warehouse_id)
    REFERENCES public.warehouses(company_id, id) ON DELETE RESTRICT;
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_quantity_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_quantity_check CHECK (
  (kind IN ('IN','OUT') AND quantity > 0) OR (kind IN ('COUNT','TRANSFER') AND quantity <> 0)
);
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_source_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_source_check CHECK (
  source_type IS NULL OR source_type IN ('SERVICE_ORDER','MANUAL','PURCHASE','COUNT','TANK_OPENING','FUEL_ENTRY')
);
ALTER TABLE public.stock_movements ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_actor_check
  CHECK (created_by IS NOT NULL OR source_type = 'TANK_OPENING');
CREATE UNIQUE INDEX stock_movements_transfer_leg_unique ON public.stock_movements(company_id, transfer_id, kind)
 WHERE transfer_id IS NOT NULL;
CREATE UNIQUE INDEX stock_movements_client_uuid_unique ON public.stock_movements(company_id, client_generated_id)
 WHERE client_generated_id IS NOT NULL;
CREATE INDEX stock_movements_warehouse_item_idx ON public.stock_movements(company_id, warehouse_id, item_id);

CREATE TABLE public.stock_item_levels (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  item_id TEXT NOT NULL, warehouse_id TEXT NOT NULL,
  min_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  max_quantity NUMERIC(14,3) CHECK (max_quantity IS NULL OR max_quantity >= min_quantity),
  CONSTRAINT stock_item_levels_unique UNIQUE(company_id, item_id, warehouse_id),
  CONSTRAINT stock_item_levels_item_fk FOREIGN KEY(company_id,item_id) REFERENCES public.stock_items(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT stock_item_levels_warehouse_fk FOREIGN KEY(company_id,warehouse_id) REFERENCES public.warehouses(company_id,id) ON DELETE RESTRICT
);
-- F8 minimum vrijedi za prethodno jedino skladište.
INSERT INTO public.stock_item_levels(id,company_id,item_id,warehouse_id,min_quantity)
SELECT 'lvl_' || md5(i.company_id || ':' || i.id), i.company_id, i.id, w.id, i.min_quantity
  FROM public.stock_items i JOIN public.warehouses w ON w.company_id=i.company_id AND w.kind='CENTRAL';

CREATE TABLE public.stock_counts (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  warehouse_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPLIED')),
  reason TEXT CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 1000),
  created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), applied_at TIMESTAMPTZ,
  CONSTRAINT stock_counts_company_id_unique UNIQUE(company_id,id),
  CONSTRAINT stock_counts_warehouse_fk FOREIGN KEY(company_id,warehouse_id) REFERENCES public.warehouses(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT stock_counts_applied_check CHECK ((status='APPLIED') = (applied_at IS NOT NULL))
);
CREATE TABLE public.stock_count_items (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  count_id TEXT NOT NULL, item_id TEXT NOT NULL, counted_quantity NUMERIC(14,3) NOT NULL CHECK(counted_quantity >= 0),
  system_quantity NUMERIC(14,3), difference NUMERIC(14,3),
  CONSTRAINT stock_count_items_unique UNIQUE(company_id,count_id,item_id),
  CONSTRAINT stock_count_items_count_fk FOREIGN KEY(company_id,count_id) REFERENCES public.stock_counts(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT stock_count_items_item_fk FOREIGN KEY(company_id,item_id) REFERENCES public.stock_items(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT stock_count_items_difference_check CHECK ((system_quantity IS NULL AND difference IS NULL) OR
    (system_quantity IS NOT NULL AND difference IS NOT NULL AND difference = counted_quantity - system_quantity))
);

-- Svaka cisterna dobija vlastito TANK skladište, a sva goriva firme isti sistemski artikal.
INSERT INTO public.stock_items(id, company_id, code, name, unit, system_managed, created_by, updated_by)
SELECT 'stf_' || md5(c.id), c.id, 'F10-GORIVO-' || substr(md5(c.id),1,16), 'Gorivo', 'l', true, NULL, NULL
  FROM public.companies c WHERE EXISTS (SELECT 1 FROM public.fuel_tanks t WHERE t.company_id=c.id);
INSERT INTO public.warehouses(id,company_id,code,name,kind,is_active)
SELECT 'wht_' || md5(company_id || ':' || id), company_id,
       'TANK-' || substr(md5(id),1,24), name, 'TANK', is_active FROM public.fuel_tanks;
ALTER TABLE public.fuel_tanks ADD COLUMN warehouse_id TEXT, ADD COLUMN fuel_item_id TEXT;
UPDATE public.fuel_tanks SET warehouse_id = 'wht_' || md5(company_id || ':' || id), fuel_item_id='stf_' || md5(company_id);
ALTER TABLE public.fuel_tanks ALTER COLUMN warehouse_id SET NOT NULL, ALTER COLUMN fuel_item_id SET NOT NULL;
ALTER TABLE public.fuel_tanks
  ADD CONSTRAINT fuel_tanks_warehouse_unique UNIQUE(company_id,warehouse_id),
  ADD CONSTRAINT fuel_tanks_warehouse_fk FOREIGN KEY(company_id,warehouse_id) REFERENCES public.warehouses(company_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT fuel_tanks_item_fk FOREIGN KEY(company_id,fuel_item_id) REFERENCES public.stock_items(company_id,id) ON DELETE RESTRICT;
-- Jedan početni saldo: postojeća točenja su VEĆ sadržana u current_l, ne ponavljaju se.
INSERT INTO public.stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,occurred_on,source_type,source_id,note,created_by)
SELECT 'stm_open_' || md5(company_id || ':' || id), company_id, fuel_item_id, warehouse_id,
       'IN',current_l,current_date,'TANK_OPENING',id,'Migrirano stanje cisterne',NULL
  FROM public.fuel_tanks WHERE current_l > 0;
ALTER TABLE public.fuel_tanks DROP CONSTRAINT fuel_tanks_current_check;
ALTER TABLE public.fuel_tanks DROP COLUMN current_l;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['warehouses','stock_item_levels','stock_counts','stock_count_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (company_id = current_setting(''app.company_id'', true)) WITH CHECK (company_id = current_setting(''app.company_id'', true))',t);
  END LOOP;
END $$;

-- Primijenjeni popis je dokaz, ne promjenjivo stanje.
CREATE FUNCTION public.stock_count_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parent_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'stock_counts' THEN
    IF OLD.status='APPLIED' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'STOCK_COUNT_IMMUTABLE';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.count_id IS DISTINCT FROM OLD.count_id OR NEW.item_id IS DISTINCT FROM OLD.item_id
      OR NEW.counted_quantity IS DISTINCT FROM OLD.counted_quantity) THEN
      RAISE EXCEPTION 'STOCK_COUNT_IMMUTABLE';
    END IF;
    SELECT c.status INTO parent_status FROM public.stock_counts c
      WHERE c.company_id=NEW.company_id AND c.id=NEW.count_id FOR UPDATE;
    IF parent_status = 'APPLIED' THEN RAISE EXCEPTION 'STOCK_COUNT_IMMUTABLE'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stock_count_guard() FROM PUBLIC, gradix_app;
CREATE TRIGGER stock_counts_guard BEFORE UPDATE ON public.stock_counts FOR EACH ROW EXECUTE FUNCTION public.stock_count_guard();
CREATE TRIGGER stock_count_items_guard BEFORE INSERT OR UPDATE ON public.stock_count_items FOR EACH ROW EXECUTE FUNCTION public.stock_count_guard();

-- Legacy F8 writer ne navodi warehouse_id; novi tenant i dalje ima CENTRAL.
CREATE FUNCTION public.stock_movement_warehouse_default() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.warehouse_id IS NULL THEN
    SELECT id INTO NEW.warehouse_id FROM public.warehouses WHERE company_id=NEW.company_id AND kind='CENTRAL';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stock_movement_warehouse_default() FROM PUBLIC, gradix_app;
CREATE TRIGGER stock_movement_warehouse_default BEFORE INSERT ON public.stock_movements
 FOR EACH ROW EXECUTE FUNCTION public.stock_movement_warehouse_default();

-- Isti ključ koristi servis inventure prije čitanja stanja. Nijedna kretnja ne može
-- proći dok traje popis. Brava je kratka i oslobađa se na kraju transakcije.
CREATE FUNCTION public.stock_movement_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE tank RECORD; balance NUMERIC;
BEGIN
  IF NEW.legacy_ignored THEN RAISE EXCEPTION 'STOCK_LEGACY_FLAG_FORBIDDEN'; END IF;
  IF NEW.amount_cents IS NULL AND NEW.unit_cost_cents IS NOT NULL AND NEW.kind IN ('IN','OUT') THEN
    NEW.amount_cents := round(NEW.quantity * NEW.unit_cost_cents);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(NEW.company_id || ':' || NEW.warehouse_id, 0)) THEN
    RAISE EXCEPTION 'STOCK_COUNT_IN_PROGRESS';
  END IF;
  SELECT fuel_item_id,capacity_l INTO tank FROM public.fuel_tanks
    WHERE company_id=NEW.company_id AND warehouse_id=NEW.warehouse_id;
  IF FOUND THEN
    IF tank.fuel_item_id <> NEW.item_id THEN RAISE EXCEPTION 'TANK_ITEM_INVALID'; END IF;
    SELECT COALESCE(sum(CASE WHEN kind='IN' THEN quantity WHEN kind='OUT' THEN -quantity WHEN kind='COUNT' AND NOT legacy_ignored THEN quantity ELSE 0 END),0)
      INTO balance FROM public.stock_movements WHERE company_id=NEW.company_id AND warehouse_id=NEW.warehouse_id AND item_id=NEW.item_id;
    balance := balance + CASE WHEN NEW.kind='IN' THEN NEW.quantity WHEN NEW.kind='OUT' THEN -NEW.quantity WHEN NEW.kind='COUNT' THEN NEW.quantity ELSE 0 END;
    IF balance < 0 OR balance > tank.capacity_l THEN RAISE EXCEPTION 'TANK_LEVEL_INVALID'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stock_movement_lock() FROM PUBLIC, gradix_app;
CREATE TRIGGER stock_movement_zz_lock BEFORE INSERT ON public.stock_movements
 FOR EACH ROW EXECUTE FUNCTION public.stock_movement_lock();

-- Dvije noge se provjeravaju tek na COMMIT-u; djelimičan transfer se ne može upisati.
CREATE FUNCTION public.stock_transfer_pair_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE good BOOLEAN;
BEGIN
  IF NEW.transfer_id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*)=2 AND count(*) FILTER(WHERE kind='IN')=1 AND count(*) FILTER(WHERE kind='OUT')=1
     AND count(DISTINCT item_id)=1 AND count(DISTINCT warehouse_id)=2 AND min(quantity)=max(quantity)
     AND (count(amount_cents)=0 OR (count(amount_cents)=2 AND min(amount_cents)=max(amount_cents)))
    INTO good FROM public.stock_movements WHERE company_id=NEW.company_id AND transfer_id=NEW.transfer_id;
  IF NOT good THEN RAISE EXCEPTION 'STOCK_TRANSFER_INCOMPLETE'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stock_transfer_pair_guard() FROM PUBLIC, gradix_app;
CREATE CONSTRAINT TRIGGER stock_transfer_pair_guard AFTER INSERT ON public.stock_movements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.stock_transfer_pair_guard();

CREATE FUNCTION public.companies_seed_central_warehouse() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO public.warehouses(id,company_id,code,name,kind)
  VALUES ('whc_' || md5(NEW.id), NEW.id, 'CENTRALNO', 'Centralno', 'CENTRAL');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.companies_seed_central_warehouse() FROM PUBLIC, gradix_app;
CREATE TRIGGER companies_seed_central_warehouse AFTER INSERT ON public.companies
 FOR EACH ROW EXECUTE FUNCTION public.companies_seed_central_warehouse();

INSERT INTO public.schema_migrations(name) VALUES ('20261127110000_f10_warehouse_ledger') ON CONFLICT DO NOTHING;
COMMIT;
