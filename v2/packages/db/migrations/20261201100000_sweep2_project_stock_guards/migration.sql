BEGIN;

-- Serialise booking with closeProject's row lock. The existing status guard alone
-- reads a snapshot and can miss a FINISHED transition that has not committed yet.
CREATE FUNCTION public.cost_entry_project_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE project_status text;
BEGIN
  IF NEW.project_id IS NOT NULL AND (TG_OP = 'INSERT' OR (OLD.status = 'PENDING' AND NEW.status = 'POSTED')) THEN
    SELECT p.status INTO project_status FROM public.projects p
      WHERE p.company_id = NEW.company_id AND p.id = NEW.project_id FOR SHARE;
    IF project_status = 'FINISHED' THEN
      RAISE EXCEPTION 'PROJECT_CLOSED' USING DETAIL = 'Projekat je zatvoren; prvo ga ponovo otvorite.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cost_entry_project_lock() FROM PUBLIC, gradix_app;
CREATE TRIGGER cost_entry_00_project_lock BEFORE INSERT OR UPDATE ON public.cost_entries
  FOR EACH ROW EXECUTE FUNCTION public.cost_entry_project_lock();

-- All writers use the same transaction-scoped warehouse lock; defend the
-- ordinary warehouse too, not only tanks, when a writer bypasses a service.
CREATE FUNCTION public.stock_movement_nonnegative_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE balance numeric;
BEGIN
  IF NEW.kind = 'OUT' OR (NEW.kind = 'COUNT' AND NEW.quantity < 0) THEN
    SELECT COALESCE(sum(CASE WHEN kind='IN' THEN quantity WHEN kind='OUT' THEN -quantity
      WHEN kind='COUNT' AND NOT legacy_ignored THEN quantity ELSE 0 END),0)
      INTO balance FROM public.stock_movements
      WHERE company_id=NEW.company_id AND warehouse_id=NEW.warehouse_id AND item_id=NEW.item_id;
    IF balance + (CASE WHEN NEW.kind='OUT' THEN -NEW.quantity ELSE NEW.quantity END) < 0 THEN
      RAISE EXCEPTION 'STOCK_INSUFFICIENT';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stock_movement_nonnegative_guard() FROM PUBLIC, gradix_app;
-- Alphabetically after stock_movement_zz_lock, which obtains the shared lock.
CREATE TRIGGER stock_movement_zzz_nonnegative BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.stock_movement_nonnegative_guard();

INSERT INTO public.schema_migrations(name) VALUES ('20261201100000_sweep2_project_stock_guards') ON CONFLICT DO NOTHING;
COMMIT;
