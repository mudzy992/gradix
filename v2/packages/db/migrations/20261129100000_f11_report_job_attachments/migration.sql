-- Report exports are server-generated attachments, never normal user uploads.
-- Their dedicated download endpoint must enforce ownership and current authorization.
ALTER TABLE public.attachments DROP CONSTRAINT attachments_entity_type_check;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_entity_type_check
  CHECK (entity_type IN ('OBLIGATION','TENDER','MACHINE_DAILY_CHECK','PROJECT','HSE_INCIDENT','REPORT_JOB'));
ALTER TABLE public.attachments DROP CONSTRAINT attachments_content_type_check;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_content_type_check CHECK (
  (entity_type = 'REPORT_JOB' AND content_type IN
    ('application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
  OR (entity_type <> 'REPORT_JOB' AND content_type IN
    ('application/pdf','image/jpeg','image/png','image/webp','image/heic'))
);
ALTER TABLE public.attachments DROP CONSTRAINT attachments_size_bytes_check;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_size_bytes_check CHECK (
  size_bytes > 0 AND size_bytes <= CASE WHEN entity_type='REPORT_JOB' THEN 104857600 ELSE 10485760 END
);
CREATE UNIQUE INDEX attachments_report_job_ready_idx ON public.attachments(company_id,entity_id)
  WHERE entity_type='REPORT_JOB' AND status='ready';
-- Rotate outbox scans fairly even if some jobs remain stuck or delivery is delayed.
ALTER TABLE public.report_jobs ADD COLUMN last_dispatched_at TIMESTAMPTZ;
CREATE INDEX report_jobs_dispatch_order_idx ON public.report_jobs
  (company_id, coalesce(last_dispatched_at,created_at), created_at, id)
  WHERE kind='REPORT' AND status='QUEUED';
INSERT INTO public.schema_migrations(name) VALUES ('20261129100000_f11_report_job_attachments') ON CONFLICT DO NOTHING;
