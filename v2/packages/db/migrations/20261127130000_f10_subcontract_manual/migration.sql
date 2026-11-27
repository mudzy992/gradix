-- F10A-3: podizvođači i zahtjevi za odobrenje ručnog troška.
BEGIN;
ALTER TABLE public.companies ADD COLUMN manual_cost_approval_threshold_cents BIGINT NOT NULL DEFAULT 50000 CHECK (manual_cost_approval_threshold_cents>=0);
ALTER TABLE public.cost_entries ADD COLUMN client_generated_id UUID;
CREATE UNIQUE INDEX cost_entries_client_generated_unique ON public.cost_entries(company_id,client_generated_id) WHERE client_generated_id IS NOT NULL;

CREATE TABLE public.subcontractor_contracts (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL, partner_id TEXT NOT NULL, code TEXT NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 100),
 title TEXT NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 300), scope TEXT,
 contract_value_cents BIGINT NOT NULL CHECK(contract_value_cents>=0), currency_code TEXT NOT NULL CHECK(char_length(currency_code)=3),
 retention_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(retention_pct BETWEEN 0 AND 100),
 warranty_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(warranty_pct BETWEEN 0 AND 100),
 valid_from DATE, valid_to DATE, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','COMPLETED','TERMINATED')),
 document_attachment_id TEXT, created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 client_generated_id UUID NOT NULL, request_hash TEXT NOT NULL,
 UNIQUE(company_id,id), UNIQUE(company_id,code), UNIQUE(company_id,client_generated_id),
 CHECK(retention_pct+warranty_pct<=100), CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to>=valid_from),
 FOREIGN KEY(company_id,project_id) REFERENCES public.projects(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,partner_id) REFERENCES public.partners(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,document_attachment_id) REFERENCES public.attachments(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.subcontractor_contract_amendments (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 contract_id TEXT NOT NULL, value_amendment_cents BIGINT NOT NULL CHECK(value_amendment_cents>0), reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 client_generated_id UUID NOT NULL, request_hash TEXT NOT NULL, UNIQUE(company_id,id), UNIQUE(company_id,client_generated_id),
 FOREIGN KEY(company_id,contract_id) REFERENCES public.subcontractor_contracts(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.subcontractor_statements (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 contract_id TEXT NOT NULL, phase_id TEXT, period_from DATE NOT NULL, period_to DATE NOT NULL, statement_no TEXT NOT NULL CHECK(length(btrim(statement_no)) BETWEEN 1 AND 100),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','PAID')),
 gross_cents BIGINT NOT NULL CHECK(gross_cents>=0), retention_pct NUMERIC(5,2) NOT NULL, warranty_pct NUMERIC(5,2) NOT NULL,
 retention_cents BIGINT NOT NULL CHECK(retention_cents>=0), warranty_cents BIGINT NOT NULL CHECK(warranty_cents>=0), net_cents BIGINT NOT NULL CHECK(net_cents>=0),
 currency_code TEXT NOT NULL CHECK(char_length(currency_code)=3), exceeded_at_approval BOOLEAN NOT NULL DEFAULT false, created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 client_generated_id UUID NOT NULL, request_hash TEXT NOT NULL, UNIQUE(company_id,id), UNIQUE(company_id,contract_id,statement_no), UNIQUE(company_id,client_generated_id),
 CHECK(period_to>=period_from), CHECK(retention_pct BETWEEN 0 AND 100 AND warranty_pct BETWEEN 0 AND 100 AND retention_pct+warranty_pct<=100),
 CHECK(net_cents=gross_cents-retention_cents-warranty_cents),
 FOREIGN KEY(company_id,contract_id) REFERENCES public.subcontractor_contracts(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,phase_id) REFERENCES public.project_phases(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.subcontractor_statement_items (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 statement_id TEXT NOT NULL, description TEXT NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
 amount_cents BIGINT NOT NULL CHECK(amount_cents>=0), UNIQUE(company_id,id),
 FOREIGN KEY(company_id,statement_id) REFERENCES public.subcontractor_statements(company_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.manual_cost_requests (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 client_generated_id UUID NOT NULL, request_hash TEXT NOT NULL, project_id TEXT NOT NULL, phase_id TEXT, category_id TEXT NOT NULL,
 occurred_on DATE NOT NULL, amount_cents BIGINT NOT NULL CHECK(amount_cents>=0), currency_code TEXT NOT NULL CHECK(char_length(currency_code)=3),
 quantity NUMERIC(14,3), unit TEXT, note TEXT, attachment_id TEXT, status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 cost_entry_id TEXT, created_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,id), UNIQUE(company_id,client_generated_id),
 CHECK((status='APPROVED')=(cost_entry_id IS NOT NULL)), CHECK(quantity IS NULL OR quantity>0),
 FOREIGN KEY(company_id,project_id) REFERENCES public.projects(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,phase_id) REFERENCES public.project_phases(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,category_id) REFERENCES public.cost_categories(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,attachment_id) REFERENCES public.attachments(company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(company_id,cost_entry_id) REFERENCES public.cost_entries(company_id,id) ON DELETE RESTRICT
);
CREATE INDEX subcontractor_contracts_project_idx ON public.subcontractor_contracts(company_id,project_id,status);
CREATE INDEX subcontractor_statements_contract_idx ON public.subcontractor_statements(company_id,contract_id,status);

-- Povezanu odobrenu situaciju nije dozvoljeno jednostrano izbrisati iz ledgera.
CREATE OR REPLACE FUNCTION public.purchase_cost_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.entry_kind IS DISTINCT FROM OLD.entry_kind OR NEW.supplier_invoice_id IS DISTINCT FROM OLD.supplier_invoice_id OR NEW.material_issue_item_id IS DISTINCT FROM OLD.material_issue_item_id THEN
   RAISE EXCEPTION 'COST_ENTRY_IMMUTABLE';
 END IF;
 IF OLD.source_type IN ('PURCHASE','SUBCONTRACTOR') AND NEW.status='REVERSED' THEN
   RAISE EXCEPTION 'SOURCE_COST_REVERSAL_FORBIDDEN';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_cost_guard() FROM PUBLIC,gradix_app;

-- Identitet klijenta je dio nepromjenjivog ledger zapisa.
CREATE FUNCTION public.manual_cost_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.client_generated_id IS DISTINCT FROM OLD.client_generated_id THEN RAISE EXCEPTION 'COST_ENTRY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.manual_cost_identity_guard() FROM PUBLIC,gradix_app;
CREATE TRIGGER manual_cost_identity_guard BEFORE UPDATE ON public.cost_entries FOR EACH ROW EXECUTE FUNCTION public.manual_cost_identity_guard();
CREATE FUNCTION public.manual_cost_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.client_generated_id IS DISTINCT FROM OLD.client_generated_id
   OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.phase_id IS DISTINCT FROM OLD.phase_id
   OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.occurred_on IS DISTINCT FROM OLD.occurred_on OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
   OR NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.unit IS DISTINCT FROM OLD.unit
   OR NEW.note IS DISTINCT FROM OLD.note OR NEW.attachment_id IS DISTINCT FROM OLD.attachment_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
   OR (OLD.status<>'PENDING' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.cost_entry_id IS DISTINCT FROM OLD.cost_entry_id)) THEN
   RAISE EXCEPTION 'MANUAL_COST_REQUEST_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.manual_cost_request_guard() FROM PUBLIC,gradix_app;
CREATE TRIGGER manual_cost_request_guard BEFORE UPDATE ON public.manual_cost_requests FOR EACH ROW EXECUTE FUNCTION public.manual_cost_request_guard();
CREATE FUNCTION public.manual_cost_ledger_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.status='APPROVED' AND NOT EXISTS (
   SELECT 1 FROM public.cost_entries e WHERE e.company_id=NEW.company_id AND e.id=NEW.cost_entry_id AND e.source_type='MANUAL' AND e.source_id=NEW.id
     AND e.project_id=NEW.project_id AND e.phase_id IS NOT DISTINCT FROM NEW.phase_id AND e.category_id=NEW.category_id AND e.amount_cents=NEW.amount_cents
     AND e.currency_code=NEW.currency_code AND e.client_generated_id=NEW.client_generated_id AND e.status='POSTED'
 ) THEN RAISE EXCEPTION 'MANUAL_COST_LEDGER_INVALID'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.manual_cost_ledger_guard() FROM PUBLIC,gradix_app;
CREATE CONSTRAINT TRIGGER manual_cost_ledger_guard AFTER INSERT OR UPDATE ON public.manual_cost_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manual_cost_ledger_guard();

-- Odobrena situacija je finansijski dokument; njeni iznosi i stavke su nepromjenjivi.
CREATE FUNCTION public.subcontract_statement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s TEXT;
BEGIN
 IF TG_TABLE_NAME='subcontractor_statements' THEN
   IF OLD.status IN ('APPROVED','PAID') AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.contract_id IS DISTINCT FROM OLD.contract_id OR NEW.phase_id IS DISTINCT FROM OLD.phase_id OR NEW.period_from IS DISTINCT FROM OLD.period_from
     OR NEW.period_to IS DISTINCT FROM OLD.period_to OR NEW.statement_no IS DISTINCT FROM OLD.statement_no OR NEW.gross_cents IS DISTINCT FROM OLD.gross_cents
     OR NEW.retention_pct IS DISTINCT FROM OLD.retention_pct OR NEW.warranty_pct IS DISTINCT FROM OLD.warranty_pct
     OR NEW.retention_cents IS DISTINCT FROM OLD.retention_cents OR NEW.warranty_cents IS DISTINCT FROM OLD.warranty_cents OR NEW.net_cents IS DISTINCT FROM OLD.net_cents
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.exceeded_at_approval IS DISTINCT FROM OLD.exceeded_at_approval OR NEW.status NOT IN ('APPROVED','PAID')) THEN RAISE EXCEPTION 'SUBCONTRACT_STATEMENT_IMMUTABLE'; END IF;
 ELSE
   SELECT status INTO s FROM public.subcontractor_statements WHERE company_id=NEW.company_id AND id=NEW.statement_id FOR UPDATE;
   IF s IS DISTINCT FROM 'SUBMITTED' AND s IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'SUBCONTRACT_STATEMENT_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.subcontract_statement_guard() FROM PUBLIC,gradix_app;
CREATE TRIGGER subcontract_statement_guard BEFORE UPDATE ON public.subcontractor_statements FOR EACH ROW EXECUTE FUNCTION public.subcontract_statement_guard();
CREATE TRIGGER subcontract_statement_items_guard BEFORE INSERT ON public.subcontractor_statement_items FOR EACH ROW EXECUTE FUNCTION public.subcontract_statement_guard();

-- Odobrenje i bruto knjiženje moraju biti potvrđeni zajedno, nikad samo jedno od njih.
CREATE FUNCTION public.subcontract_ledger_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.status IN ('APPROVED','PAID') AND NOT EXISTS (
   SELECT 1 FROM public.subcontractor_contracts c JOIN public.cost_entries e ON e.company_id=c.company_id AND e.source_type='SUBCONTRACTOR' AND e.source_id=NEW.id
   JOIN public.cost_categories cat ON cat.company_id=e.company_id AND cat.id=e.category_id
   WHERE c.company_id=NEW.company_id AND c.id=NEW.contract_id AND e.project_id=c.project_id AND e.phase_id IS NOT DISTINCT FROM NEW.phase_id
     AND e.status='POSTED' AND e.amount_cents=NEW.gross_cents AND e.currency_code=NEW.currency_code AND cat.code='PODIZVOĐAČI'
     AND NEW.gross_cents=(SELECT COALESCE(sum(i.amount_cents),0) FROM public.subcontractor_statement_items i WHERE i.company_id=NEW.company_id AND i.statement_id=NEW.id)
 ) THEN RAISE EXCEPTION 'SUBCONTRACT_LEDGER_INVALID'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.subcontract_ledger_guard() FROM PUBLIC,gradix_app;
CREATE CONSTRAINT TRIGGER subcontract_ledger_guard AFTER INSERT OR UPDATE ON public.subcontractor_statements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.subcontract_ledger_guard();

DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['subcontractor_contracts','subcontractor_contract_amendments','subcontractor_statements','subcontractor_statement_items','manual_cost_requests'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
   EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (company_id = nullif(current_setting(''app.company_id'',true),'''')) WITH CHECK (company_id = nullif(current_setting(''app.company_id'',true),''''))',t);
 END LOOP;
END $$;
INSERT INTO public.schema_migrations(name) VALUES ('20261127130000_f10_subcontract_manual') ON CONFLICT DO NOTHING;
COMMIT;
