-- Tri decimale čuvaju milisate i hiljadite litra izvora; F1 je čuvao samo dvije.
ALTER TABLE public.daily_rollups
  ALTER COLUMN hours_total TYPE numeric(13,3),
  ALTER COLUMN machine_hours TYPE numeric(13,3),
  ALTER COLUMN fuel_liters TYPE numeric(15,3);

-- Jedini globalni podatak koji worker smije enumerisati su ID-jevi aktivnih firmi.
-- companies je globalni registar s RLS, ali bez FORCE (migrator/owner ga održava).
-- Vlasnik funkcije mora biti vlasnik companies: samo tako definer i u deploymentu s
-- ne-superuser migratorom vidi sve aktivne redove. Tenant poslovni upiti ostaju RLS-om vezani.
CREATE FUNCTION public.list_active_company_ids_for_worker()
RETURNS TABLE (id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c.id FROM public.companies AS c WHERE c.is_active ORDER BY c.id
$$;
DO $$
DECLARE v_owner name;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = 'public.companies'::regclass;
  EXECUTE format('ALTER FUNCTION public.list_active_company_ids_for_worker() OWNER TO %I', v_owner);
END $$;
REVOKE ALL ON FUNCTION public.list_active_company_ids_for_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_company_ids_for_worker() TO gradix_app;
INSERT INTO public.schema_migrations(name) VALUES ('20261128110000_f11_worker_company_ids') ON CONFLICT DO NOTHING;
