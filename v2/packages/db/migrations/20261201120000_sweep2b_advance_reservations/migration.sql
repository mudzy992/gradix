BEGIN;
-- Restore deductions made by every old revision of a period which is not paid. The latest
-- revision becomes a reservation; paid (LOCKED) periods remain untouched. This data migration
-- requires a controlled migration principal with BYPASSRLS (or superuser), never gradix_app.
-- FORCE RLS makes even a table owner blind across tenants; fail closed rather than skip data.
LOCK TABLE public.pay_periods, public.payroll_runs, public.payroll_run_lines,
  public.payroll_line_sources, public.worker_advances IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE bad boolean;
BEGIN
    IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='20261201120000_sweep2b_advance_reservations') THEN RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
      RAISE EXCEPTION 'ADVANCE_MIGRATION_REQUIRES_BYPASSRLS: run with the controlled migration administrator';
    END IF;
    WITH restored AS (
      SELECT s.company_id,s.source_id,sum(-s.amount_cents)::numeric AS cents, bool_or(s.amount_cents IS NULL OR s.amount_cents > 0) AS invalid
        FROM public.payroll_line_sources s
        JOIN public.payroll_run_lines l ON l.company_id=s.company_id AND l.id=s.line_id
        JOIN public.payroll_runs r ON r.company_id=l.company_id AND r.id=l.run_id
        JOIN public.pay_periods p ON p.company_id=r.company_id AND p.id=r.period_id
       WHERE s.source_type='ADVANCE' AND p.status <> 'LOCKED'
       GROUP BY s.company_id,s.source_id
    )
    SELECT EXISTS(SELECT 1 FROM restored x LEFT JOIN public.worker_advances a
      ON a.company_id=x.company_id AND a.id=x.source_id
      WHERE a.id IS NULL OR x.cents IS NULL OR x.cents < 0 OR x.invalid
         OR a.remaining_cents::numeric + x.cents > a.amount_cents::numeric) INTO bad;
    IF bad THEN RAISE EXCEPTION 'ADVANCE_LEGACY_BALANCE_INCONSISTENT across tenants' ; END IF;
    WITH restored AS (
      SELECT s.company_id,s.source_id,sum(-s.amount_cents)::bigint AS cents
        FROM public.payroll_line_sources s
        JOIN public.payroll_run_lines l ON l.company_id=s.company_id AND l.id=s.line_id
        JOIN public.payroll_runs r ON r.company_id=l.company_id AND r.id=l.run_id
        JOIN public.pay_periods p ON p.company_id=r.company_id AND p.id=r.period_id
       WHERE s.source_type='ADVANCE' AND p.status <> 'LOCKED'
       GROUP BY s.company_id,s.source_id
    )
    UPDATE public.worker_advances a SET remaining_cents=a.remaining_cents+x.cents,updated_at=clock_timestamp()
      FROM restored x WHERE a.company_id=x.company_id AND a.id=x.source_id;
END $$;
INSERT INTO public.schema_migrations(name) VALUES ('20261201120000_sweep2b_advance_reservations') ON CONFLICT DO NOTHING;
COMMIT;
