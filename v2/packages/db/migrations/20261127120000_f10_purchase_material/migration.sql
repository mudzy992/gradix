-- F10A-2: dokumenti nabavke, materijal i eksplicitno razgraničenje.
BEGIN;
ALTER TABLE public.companies ADD COLUMN purchase_approval_threshold_cents BIGINT NOT NULL DEFAULT 100000 CHECK (purchase_approval_threshold_cents >= 0);

CREATE TABLE public.purchase_requests (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 project_id TEXT, phase_id TEXT, requested_by_worker_id TEXT, needed_by DATE, justification TEXT NOT NULL CHECK(length(btrim(justification)) BETWEEN 1 AND 2000),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','ORDERED','CLOSED','CANCELLED')),
 total_estimated_cents BIGINT NOT NULL CHECK(total_estimated_cents>=0), currency_code TEXT NOT NULL CHECK(char_length(currency_code)=3),
 approval_threshold_cents BIGINT CHECK(approval_threshold_cents IS NULL OR approval_threshold_cents>=0),
 client_generated_id UUID, request_hash TEXT,
 created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id), UNIQUE(company_id,client_generated_id), CHECK((client_generated_id IS NULL)=(request_hash IS NULL)),
 FOREIGN KEY(company_id,project_id) REFERENCES public.projects(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,phase_id) REFERENCES public.project_phases(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,requested_by_worker_id) REFERENCES public.workers(company_id,id) ON DELETE RESTRICT,
 CHECK(phase_id IS NULL OR project_id IS NOT NULL)
);
CREATE TABLE public.purchase_request_items (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 request_id TEXT NOT NULL, item_id TEXT, description TEXT NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
 unit TEXT NOT NULL CHECK(length(btrim(unit)) BETWEEN 1 AND 16), quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0),
 estimated_unit_price_cents BIGINT NOT NULL CHECK(estimated_unit_price_cents>=0),
 UNIQUE(company_id,id), FOREIGN KEY(company_id,request_id) REFERENCES public.purchase_requests(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,item_id) REFERENCES public.stock_items(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.purchase_orders (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 request_id TEXT, partner_id TEXT NOT NULL, ordered_at TIMESTAMPTZ, expected_at DATE,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
 total_cents BIGINT NOT NULL CHECK(total_cents>=0), currency_code TEXT NOT NULL CHECK(char_length(currency_code)=3),
 client_generated_id UUID, request_hash TEXT,
 created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id), UNIQUE(company_id,client_generated_id), CHECK((client_generated_id IS NULL)=(request_hash IS NULL)), FOREIGN KEY(company_id,request_id) REFERENCES public.purchase_requests(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,partner_id) REFERENCES public.partners(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.purchase_order_items (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 order_id TEXT NOT NULL, request_item_id TEXT, item_id TEXT NOT NULL, description TEXT NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
 unit TEXT NOT NULL CHECK(length(btrim(unit)) BETWEEN 1 AND 16), quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0), unit_price_cents BIGINT NOT NULL CHECK(unit_price_cents>=0),
 UNIQUE(company_id,id), UNIQUE(company_id,order_id,item_id),
 FOREIGN KEY(company_id,order_id) REFERENCES public.purchase_orders(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,request_item_id) REFERENCES public.purchase_request_items(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,item_id) REFERENCES public.stock_items(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.goods_receipts (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 order_id TEXT, partner_id TEXT NOT NULL, warehouse_id TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL,
 currency_code TEXT NOT NULL CHECK(char_length(currency_code)=3), note TEXT CHECK(note IS NULL OR length(btrim(note)) BETWEEN 3 AND 1000),
 client_generated_id UUID, request_hash TEXT, resulting_order_status TEXT,
 created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id), UNIQUE(company_id,client_generated_id), CHECK((client_generated_id IS NULL)=(request_hash IS NULL)), CHECK(order_id IS NOT NULL OR note IS NOT NULL),
 FOREIGN KEY(company_id,order_id) REFERENCES public.purchase_orders(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,partner_id) REFERENCES public.partners(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,warehouse_id) REFERENCES public.warehouses(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.goods_receipt_items (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 receipt_id TEXT NOT NULL, order_item_id TEXT, item_id TEXT NOT NULL, quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0),
 unit_price_cents BIGINT NOT NULL CHECK(unit_price_cents>=0), amount_cents BIGINT NOT NULL CHECK(amount_cents>=0), movement_id TEXT NOT NULL,
 UNIQUE(company_id,id), UNIQUE(company_id,receipt_id,item_id), UNIQUE(company_id,movement_id),
 FOREIGN KEY(company_id,receipt_id) REFERENCES public.goods_receipts(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,order_item_id) REFERENCES public.purchase_order_items(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,item_id) REFERENCES public.stock_items(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,movement_id) REFERENCES public.stock_movements(company_id,id) ON DELETE RESTRICT
);
-- Složeni ključ onemogućava prilog druge firme čak i pri direktnom upisu.
ALTER TABLE public.attachments ADD CONSTRAINT attachments_company_id_unique UNIQUE(company_id,id);
CREATE TABLE public.purchase_invoices (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 partner_id TEXT NOT NULL, invoice_number TEXT NOT NULL CHECK(length(btrim(invoice_number)) BETWEEN 1 AND 120),
 invoice_date DATE NOT NULL, due_date DATE, amount_cents BIGINT NOT NULL CHECK(amount_cents>=0), currency_code TEXT NOT NULL CHECK(char_length(currency_code)=3),
 order_id TEXT, project_id TEXT, phase_id TEXT, attachment_id TEXT,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','PAID','DISPUTED')),
 created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id), UNIQUE(company_id,partner_id,invoice_number), CHECK(phase_id IS NULL OR project_id IS NOT NULL),
 FOREIGN KEY(company_id,partner_id) REFERENCES public.partners(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,order_id) REFERENCES public.purchase_orders(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,attachment_id) REFERENCES public.attachments(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,project_id) REFERENCES public.projects(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,phase_id) REFERENCES public.project_phases(company_id,id) ON DELETE RESTRICT
);
-- Eksplicitna veza fakturisanog dijela s prijemom: ukupni račun može sadržati i nefakturisane stavke.
CREATE TABLE public.purchase_invoice_items (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 invoice_id TEXT NOT NULL, receipt_item_id TEXT NOT NULL, quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0), amount_cents BIGINT NOT NULL CHECK(amount_cents>=0),
 UNIQUE(company_id,id), UNIQUE(company_id,invoice_id,receipt_item_id),
 FOREIGN KEY(company_id,invoice_id) REFERENCES public.purchase_invoices(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,receipt_item_id) REFERENCES public.goods_receipt_items(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.material_issues (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 warehouse_id TEXT NOT NULL, project_id TEXT, phase_id TEXT, issued_to_worker_id TEXT, issued_at TIMESTAMPTZ NOT NULL,
 currency_code TEXT NOT NULL CHECK(char_length(currency_code)=3), note TEXT CHECK(note IS NULL OR length(btrim(note)) BETWEEN 1 AND 1000),
 client_generated_id UUID, request_hash TEXT, below_minimum BOOLEAN NOT NULL DEFAULT false,
 created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id), UNIQUE(company_id,client_generated_id), CHECK((client_generated_id IS NULL)=(request_hash IS NULL)), CHECK(phase_id IS NULL OR project_id IS NOT NULL),
 FOREIGN KEY(company_id,warehouse_id) REFERENCES public.warehouses(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,project_id) REFERENCES public.projects(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,phase_id) REFERENCES public.project_phases(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,issued_to_worker_id) REFERENCES public.workers(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.material_issue_items (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 issue_id TEXT NOT NULL, item_id TEXT NOT NULL, quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0),
 amount_cents BIGINT NOT NULL CHECK(amount_cents>=0), movement_id TEXT NOT NULL,
 UNIQUE(company_id,id), UNIQUE(company_id,issue_id,item_id), UNIQUE(company_id,movement_id),
 FOREIGN KEY(company_id,issue_id) REFERENCES public.material_issues(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,item_id) REFERENCES public.stock_items(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,movement_id) REFERENCES public.stock_movements(company_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_source_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_source_check CHECK (
 source_type IS NULL OR source_type IN ('SERVICE_ORDER','MANUAL','PURCHASE','COUNT','TANK_OPENING','FUEL_ENTRY','MATERIAL_ISSUE')
);

-- Negativan iznos dozvoljen je SAMO za zaseban vezani OFFSET; originali ostaju netaknuti.
ALTER TABLE public.cost_entries ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'CHARGE',
 ADD COLUMN supplier_invoice_id TEXT,
 ADD COLUMN material_issue_item_id TEXT;
ALTER TABLE public.cost_entries DROP CONSTRAINT cost_entries_amount_check;
ALTER TABLE public.cost_entries DROP CONSTRAINT cost_entries_subject_check;
ALTER TABLE public.cost_entries ADD CONSTRAINT cost_entries_amount_check CHECK (
 (entry_kind='OFFSET' AND amount_cents IS NOT NULL AND amount_cents<=0)
 OR (entry_kind IN ('CHARGE','OVERHEAD') AND (amount_cents IS NULL OR amount_cents>=0))
), ADD CONSTRAINT cost_entries_entry_kind_check CHECK (
 (entry_kind='CHARGE' AND (project_id IS NOT NULL OR machine_id IS NOT NULL) AND material_issue_item_id IS NULL)
 OR (entry_kind='OVERHEAD' AND source_type='PURCHASE' AND project_id IS NULL AND phase_id IS NULL AND machine_id IS NULL AND material_issue_item_id IS NULL)
 OR (entry_kind='OFFSET' AND source_type='PURCHASE' AND project_id IS NOT NULL AND machine_id IS NULL AND supplier_invoice_id IS NOT NULL AND material_issue_item_id IS NOT NULL AND status='POSTED')
), ADD CONSTRAINT cost_entries_supplier_invoice_fk FOREIGN KEY(company_id,supplier_invoice_id) REFERENCES public.purchase_invoices(company_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT cost_entries_issue_item_fk FOREIGN KEY(company_id,material_issue_item_id) REFERENCES public.material_issue_items(company_id,id) ON DELETE RESTRICT;

CREATE TABLE public.material_issue_allocations (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 issue_item_id TEXT NOT NULL, invoice_item_id TEXT NOT NULL, quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0),
 offset_cents BIGINT NOT NULL CHECK(offset_cents>=0), offset_cost_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id), UNIQUE(company_id,issue_item_id,invoice_item_id), UNIQUE(company_id,offset_cost_id),
 FOREIGN KEY(company_id,issue_item_id) REFERENCES public.material_issue_items(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,invoice_item_id) REFERENCES public.purchase_invoice_items(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,offset_cost_id) REFERENCES public.cost_entries(company_id,id) ON DELETE RESTRICT
);

-- Jednom proknjižene nabavne stavke i vezane korekcije ne smiju biti jednostrano stornirane.
CREATE FUNCTION public.purchase_cost_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.entry_kind IS DISTINCT FROM OLD.entry_kind OR NEW.supplier_invoice_id IS DISTINCT FROM OLD.supplier_invoice_id OR NEW.material_issue_item_id IS DISTINCT FROM OLD.material_issue_item_id THEN
   RAISE EXCEPTION 'COST_ENTRY_IMMUTABLE';
 END IF;
 IF OLD.source_type='PURCHASE' AND NEW.status='REVERSED' THEN
   RAISE EXCEPTION 'PURCHASE_COST_REVERSAL_FORBIDDEN';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_cost_guard() FROM PUBLIC, gradix_app;
CREATE TRIGGER purchase_cost_guard BEFORE UPDATE ON public.cost_entries FOR EACH ROW EXECUTE FUNCTION public.purchase_cost_guard();

-- Red računa, suma i projekt ne mogu se mijenjati nakon odobrenja.
CREATE FUNCTION public.purchase_invoice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s TEXT;
BEGIN
 IF TG_TABLE_NAME='purchase_invoices' THEN
   IF OLD.status<>'PENDING' AND (NEW.partner_id IS DISTINCT FROM OLD.partner_id OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.phase_id IS DISTINCT FROM OLD.phase_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.status NOT IN ('APPROVED','PAID')) THEN RAISE EXCEPTION 'PURCHASE_INVOICE_IMMUTABLE'; END IF;
 ELSE
   IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id) THEN
     RAISE EXCEPTION 'PURCHASE_INVOICE_IMMUTABLE';
   END IF;
   SELECT status INTO s FROM public.purchase_invoices WHERE company_id=NEW.company_id AND id=NEW.invoice_id FOR UPDATE;
   IF s IS DISTINCT FROM 'PENDING' THEN RAISE EXCEPTION 'PURCHASE_INVOICE_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_invoice_guard() FROM PUBLIC, gradix_app;
CREATE TRIGGER purchase_invoice_guard BEFORE UPDATE ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.purchase_invoice_guard();
CREATE TRIGGER purchase_invoice_items_guard BEFORE INSERT OR UPDATE ON public.purchase_invoice_items FOR EACH ROW EXECUTE FUNCTION public.purchase_invoice_guard();

-- Isti par dobija kratku nečekajuću bravu; upis i provjera limita ostaju u istoj transakciji.
CREATE FUNCTION public.purchase_allocation_lock() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('invoice:' || NEW.company_id || ':' || NEW.invoice_item_id,0))
 OR NOT pg_try_advisory_xact_lock(hashtextextended('issue:' || NEW.company_id || ':' || NEW.issue_item_id,0)) THEN
   RAISE EXCEPTION 'PURCHASE_ALLOCATION_IN_PROGRESS';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_allocation_lock() FROM PUBLIC, gradix_app;
CREATE TRIGGER purchase_allocation_lock BEFORE INSERT ON public.material_issue_allocations FOR EACH ROW EXECUTE FUNCTION public.purchase_allocation_lock();

-- OFFSET bez stvarne i nedvostruke veze sa istim projektom, artiklom i valutom ne smije potvrditi transakciju.
CREATE FUNCTION public.purchase_offset_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cost_id TEXT; ok BOOLEAN;
BEGIN
 IF TG_TABLE_NAME='cost_entries' THEN
   IF NEW.entry_kind<>'OFFSET' THEN RETURN NEW; END IF;
   cost_id := NEW.id;
 ELSE cost_id := NEW.offset_cost_id; END IF;
 SELECT EXISTS (
   SELECT 1 FROM public.material_issue_allocations a
   JOIN public.material_issue_items mi ON mi.company_id=a.company_id AND mi.id=a.issue_item_id
   JOIN public.material_issues issue ON issue.company_id=mi.company_id AND issue.id=mi.issue_id
   JOIN public.purchase_invoice_items ii ON ii.company_id=a.company_id AND ii.id=a.invoice_item_id
   JOIN public.purchase_invoices inv ON inv.company_id=ii.company_id AND inv.id=ii.invoice_id
   JOIN public.goods_receipt_items ri ON ri.company_id=ii.company_id AND ri.id=ii.receipt_item_id
   JOIN public.goods_receipts r ON r.company_id=ri.company_id AND r.id=ri.receipt_id
   JOIN public.cost_entries c ON c.company_id=a.company_id AND c.id=a.offset_cost_id
   WHERE a.company_id=NEW.company_id AND a.offset_cost_id=cost_id
     AND c.entry_kind='OFFSET' AND c.supplier_invoice_id=inv.id AND c.material_issue_item_id=mi.id
     AND c.amount_cents=-a.offset_cents AND c.project_id=inv.project_id AND issue.project_id=inv.project_id
     AND c.currency_code=inv.currency_code AND issue.currency_code=inv.currency_code AND r.currency_code=inv.currency_code
     AND inv.partner_id=r.partner_id AND inv.status IN ('APPROVED','PAID') AND mi.item_id=ri.item_id
     AND issue.warehouse_id=r.warehouse_id AND r.created_at<=issue.created_at AND c.phase_id IS NOT DISTINCT FROM inv.phase_id
     AND (SELECT COALESCE(sum(x.quantity),0) FROM public.material_issue_allocations x WHERE x.company_id=a.company_id AND x.invoice_item_id=ii.id)<=ii.quantity
     AND (SELECT COALESCE(sum(x.offset_cents),0) FROM public.material_issue_allocations x WHERE x.company_id=a.company_id AND x.invoice_item_id=ii.id)<=ii.amount_cents
     AND (SELECT COALESCE(sum(x.quantity),0) FROM public.material_issue_allocations x WHERE x.company_id=a.company_id AND x.issue_item_id=mi.id)<=mi.quantity
     AND (SELECT COALESCE(sum(x.quantity),0) FROM public.purchase_invoice_items x WHERE x.company_id=a.company_id AND x.receipt_item_id=ri.id)<=ri.quantity
     AND (SELECT COALESCE(sum(x.amount_cents),0) FROM public.purchase_invoice_items x WHERE x.company_id=a.company_id AND x.invoice_id=inv.id)<=inv.amount_cents
     AND EXISTS (SELECT 1 FROM public.cost_entries ci WHERE ci.company_id=a.company_id AND ci.source_type='PURCHASE' AND ci.source_id=inv.id AND ci.entry_kind='CHARGE' AND ci.status='POSTED' AND ci.project_id=inv.project_id AND ci.amount_cents=inv.amount_cents)
     AND EXISTS (SELECT 1 FROM public.cost_entries cm WHERE cm.company_id=a.company_id AND cm.source_type='PURCHASE' AND cm.source_id=issue.id AND cm.entry_kind='CHARGE' AND cm.status='POSTED' AND cm.project_id=issue.project_id)
 ) INTO ok;
 IF NOT ok THEN RAISE EXCEPTION 'PURCHASE_OFFSET_INVALID'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_offset_guard() FROM PUBLIC, gradix_app;
CREATE CONSTRAINT TRIGGER purchase_offset_cost_guard AFTER INSERT ON public.cost_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.purchase_offset_guard();
CREATE CONSTRAINT TRIGGER purchase_offset_allocation_guard AFTER INSERT ON public.material_issue_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.purchase_offset_guard();

DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['purchase_requests','purchase_request_items','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','purchase_invoices','purchase_invoice_items','material_issues','material_issue_items','material_issue_allocations'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
   EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (company_id = nullif(current_setting(''app.company_id'',true),'''')) WITH CHECK (company_id = nullif(current_setting(''app.company_id'',true),''''))',t);
 END LOOP;
END $$;
INSERT INTO public.schema_migrations(name) VALUES ('20261127120000_f10_purchase_material') ON CONFLICT DO NOTHING;
COMMIT;
