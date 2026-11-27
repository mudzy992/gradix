-- F10: više uloga partnera, bez gubitka stare primarne vrste ili podataka.
BEGIN;

ALTER TABLE public.partners DROP CONSTRAINT partners_kind_check;
ALTER TABLE public.partners ADD CONSTRAINT partners_kind_check
  CHECK (kind IN ('VENDOR', 'SERVICE', 'OTHER', 'CLIENT', 'SUBCONTRACTOR'));
ALTER TABLE public.partners
  ADD COLUMN vat_number TEXT,
  ADD COLUMN address TEXT,
  ADD COLUMN contact_person TEXT,
  ADD COLUMN phone TEXT,
  ADD COLUMN email TEXT;
ALTER TABLE public.partners
  ADD CONSTRAINT partners_vat_number_length CHECK (vat_number IS NULL OR length(vat_number) <= 64),
  ADD CONSTRAINT partners_address_length CHECK (address IS NULL OR length(address) <= 500),
  ADD CONSTRAINT partners_contact_person_length CHECK (contact_person IS NULL OR length(contact_person) <= 200),
  ADD CONSTRAINT partners_phone_length CHECK (phone IS NULL OR length(phone) <= 64),
  ADD CONSTRAINT partners_email_length CHECK (email IS NULL OR length(email) <= 254);

CREATE TABLE public.partner_roles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CLIENT', 'VENDOR', 'SERVICE', 'SUBCONTRACTOR', 'OTHER')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partner_roles_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT partner_roles_partner_fk FOREIGN KEY (company_id, partner_id) REFERENCES public.partners(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_roles_company_partner_role_unique UNIQUE (company_id, partner_id, role)
);
CREATE INDEX partner_roles_role_idx ON public.partner_roles (company_id, role, partner_id) WHERE is_active;

-- Migracija se izvršava vlasničkom/BYPASSRLS rolom; sve postojeće primarne vrste postaju uloge.
INSERT INTO public.partner_roles (id, company_id, partner_id, role)
SELECT 'pro_' || md5(company_id || ':' || id || ':' || kind), company_id, id, kind FROM public.partners;

ALTER TABLE public.partner_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY partner_roles_tenant_isolation ON public.partner_roles
  USING (company_id = NULLIF(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), ''));

CREATE FUNCTION public.partner_roles_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  primary_role TEXT;
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.partner_id IS DISTINCT FROM OLD.partner_id OR NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'PARTNER_ROLE_IMMUTABLE';
  END IF;
  IF NOT NEW.is_active THEN
    SELECT p.kind INTO primary_role FROM public.partners p
     WHERE p.company_id = NEW.company_id AND p.id = NEW.partner_id FOR UPDATE;
    IF primary_role = NEW.role THEN
      RAISE EXCEPTION 'PARTNER_PRIMARY_ROLE_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.partner_roles_guard() FROM PUBLIC, gradix_app;
CREATE TRIGGER partner_roles_guard BEFORE UPDATE ON public.partner_roles
  FOR EACH ROW EXECUTE FUNCTION public.partner_roles_guard();

-- Svaki novi partner i promjena primarne vrste moraju imati aktivnu odgovarajuću ulogu,
-- uključujući stare i buduće ulaze koji ne idu kroz partner-service.
CREATE FUNCTION public.partners_sync_primary_role() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.partner_roles (id, company_id, partner_id, role, is_active)
  VALUES ('pro_' || md5(NEW.company_id || ':' || NEW.id || ':' || NEW.kind), NEW.company_id, NEW.id, NEW.kind, true)
  ON CONFLICT (company_id, partner_id, role) DO UPDATE SET is_active = true, updated_at = clock_timestamp();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.partners_sync_primary_role() FROM PUBLIC, gradix_app;
CREATE TRIGGER partners_sync_primary_role AFTER INSERT OR UPDATE OF kind ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.partners_sync_primary_role();

INSERT INTO public.schema_migrations (name)
VALUES ('20261127100000_f10_partner_roles') ON CONFLICT DO NOTHING;

COMMIT;
