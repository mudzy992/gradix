-- R4a-2 provjera prije 2d: odbačen segment je terminalno stanje reda.
-- Bez nove odluke (koja danas ne postoji kao operacija) red u work_entries
-- ne može iz REJECTED nazad u ACTIVE, niti mu se smiju mijenjati autor,
-- vrijeme ili razlog odbacivanja — ni direktnim upitom aplikacijske role.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_work_entry_resolution_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $resolution_guard$
BEGIN
  IF OLD.resolution_state = 'REJECTED'
     AND (NEW.resolution_state IS DISTINCT FROM OLD.resolution_state
       OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
       OR NEW.rejected_by IS DISTINCT FROM OLD.rejected_by
       OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason) THEN
    RAISE EXCEPTION 'WORK_ENTRY_REJECTED_TERMINAL'
      USING ERRCODE = 'P0001',
            DETAIL = 'Odbačen segment se ne reaktivira i ne mijenja; potrebna je nova odluka kroz razrješenje.';
  END IF;
  IF OLD.resolution_state = 'ACTIVE' AND NEW.resolution_state = 'REJECTED'
     AND (NEW.rejected_by IS NULL OR NEW.rejected_at IS NULL
       OR length(btrim(COALESCE(NEW.rejection_reason, ''))) < 10) THEN
    RAISE EXCEPTION 'WORK_ENTRY_REJECTION_INVALID'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$resolution_guard$;

CREATE TRIGGER work_entries_resolution_guard
  BEFORE UPDATE ON public.work_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_work_entry_resolution_state();

INSERT INTO public.schema_migrations (name)
VALUES ('20261111130000_r4a2_rejected_terminal')
ON CONFLICT DO NOTHING;
COMMIT;
