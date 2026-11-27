BEGIN;

-- Keep the paid run immutable and record a reviewable correction even when
-- the next month has not yet been opened. Serialize against period locking.
CREATE FUNCTION public.record_locked_day_correction(
  p_company text, p_day text, p_date date, p_actor text, p_delta numeric, p_reason text
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_period public.pay_periods; target_period public.pay_periods; next_month date;
BEGIN
  SELECT * INTO source_period FROM public.pay_periods
    WHERE company_id=p_company AND year=extract(year FROM p_date)::int AND month=extract(month FROM p_date)::int FOR SHARE;
  IF source_period.id IS NULL OR source_period.status <> 'LOCKED' THEN RETURN; END IF;
  next_month := (date_trunc('month',p_date::timestamp) + interval '1 month')::date;
  INSERT INTO public.pay_periods(id,company_id,year,month)
    VALUES ('prd_' || replace(gen_random_uuid()::text,'-',''),p_company,extract(year FROM next_month)::int,extract(month FROM next_month)::int)
    ON CONFLICT (company_id,year,month) DO NOTHING;
  SELECT * INTO target_period FROM public.pay_periods
    WHERE company_id=p_company AND year=extract(year FROM next_month)::int AND month=extract(month FROM next_month)::int FOR SHARE;
  IF target_period.status IN ('APPROVED','LOCKED') THEN
    RAISE EXCEPTION 'PAY_CORRECTION_TARGET_CLOSED' USING DETAIL='Naredni obračunski period je već odobren ili zaključan.';
  END IF;
  INSERT INTO public.pay_corrections(id,company_id,period_id,workday_id,delta_hours,reason,target_period_id,created_by)
    VALUES ('cor_' || replace(gen_random_uuid()::text,'-',''),p_company,source_period.id,p_day,p_delta,p_reason,target_period.id,p_actor);
END $$;
REVOKE ALL ON FUNCTION public.record_locked_day_correction(text,text,date,text,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_locked_day_correction(text,text,date,text,numeric,text) TO gradix_app;

CREATE OR REPLACE FUNCTION public.open_correction_for_locked_day() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.approval_status,NEW.day_kind) IS NOT DISTINCT FROM ROW(OLD.approval_status,OLD.day_kind) THEN RETURN NEW; END IF;
  PERFORM public.record_locked_day_correction(NEW.company_id,NEW.id,NEW.work_date,NEW.updated_by,0,
    format('Izmjena radnog dana %s u zaključanom periodu.',NEW.work_date));
  RETURN NEW;
END $$;
CREATE TRIGGER workdays_insert_correction AFTER INSERT ON public.workdays
 FOR EACH ROW EXECUTE FUNCTION public.open_correction_for_locked_day();

CREATE FUNCTION public.open_correction_for_locked_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE day_date date; old_hours numeric := 0; new_hours numeric := 0;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.workday_id,NEW.kind,NEW.started_at,NEW.ended_at,NEW.end_state,NEW.resolution_state,NEW.project_id)
    IS NOT DISTINCT FROM ROW(OLD.workday_id,OLD.kind,OLD.started_at,OLD.ended_at,OLD.end_state,OLD.resolution_state,OLD.project_id) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.kind='WORK' AND OLD.end_state='KNOWN_END' AND OLD.resolution_state='ACTIVE' THEN
    old_hours := extract(epoch FROM (OLD.ended_at-OLD.started_at))/3600;
  END IF;
  IF NEW.kind='WORK' AND NEW.end_state='KNOWN_END' AND NEW.resolution_state='ACTIVE' THEN
    new_hours := extract(epoch FROM (NEW.ended_at-NEW.started_at))/3600;
  END IF;
  IF TG_OP='UPDATE' AND OLD.workday_id <> NEW.workday_id THEN
    SELECT work_date INTO day_date FROM public.workdays WHERE company_id=OLD.company_id AND id=OLD.workday_id;
    PERFORM public.record_locked_day_correction(OLD.company_id,OLD.workday_id,day_date,NEW.updated_by,-old_hours,
      format('Izmjena segmenta radnog dana %s u zaključanom periodu.',day_date));
    old_hours := 0;
  END IF;
  SELECT work_date INTO day_date FROM public.workdays WHERE company_id=NEW.company_id AND id=NEW.workday_id;
  PERFORM public.record_locked_day_correction(NEW.company_id,NEW.workday_id,day_date,NEW.updated_by,new_hours-old_hours,
    format('Izmjena segmenta radnog dana %s u zaključanom periodu.',day_date));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.open_correction_for_locked_entry() FROM PUBLIC,gradix_app;
CREATE TRIGGER work_entries_open_correction AFTER INSERT OR UPDATE ON public.work_entries
 FOR EACH ROW EXECUTE FUNCTION public.open_correction_for_locked_entry();

INSERT INTO public.schema_migrations(name) VALUES ('20261201110000_sweep2_locked_pay_corrections') ON CONFLICT DO NOTHING;
COMMIT;
