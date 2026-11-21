-- R4b: approval_status on workdays; week approvals; revisions. FORCE RLS; no DELETE grant.
BEGIN;

ALTER TABLE public.workdays
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'SUBMITTED',
  ADD CONSTRAINT workdays_approval_status_check
    CHECK (approval_status IN ('SUBMITTED', 'FOREMAN_CONFIRMED', 'LOCKED'));

CREATE TABLE public.work_week_approvals (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  week_start   DATE NOT NULL,
  status       TEXT NOT NULL,
  decided_by   TEXT,
  decided_at   TIMESTAMPTZ,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_week_approvals_company_week_unique UNIQUE (company_id, week_start),
  CONSTRAINT work_week_approvals_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT work_week_approvals_decided_by_fk
    FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT work_week_approvals_status_check CHECK (
    status IN ('OPEN', 'WEEK_APPROVED', 'WEEK_REJECTED', 'LOCKED')
  ),
  CONSTRAINT work_week_approvals_reason_check CHECK (
    reason IS NULL OR length(btrim(reason)) BETWEEN 10 AND 500
  ),
  CONSTRAINT work_week_approvals_decision_check CHECK (
    (status = 'OPEN' AND decided_by IS NULL AND decided_at IS NULL AND reason IS NULL)
    OR
    (status IN ('WEEK_APPROVED', 'WEEK_REJECTED', 'LOCKED')
      AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);
CREATE INDEX work_week_approvals_company_status_idx
  ON public.work_week_approvals (company_id, status, week_start);

CREATE TABLE public.workday_revisions (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  workday_id      TEXT NOT NULL,
  base_version    INTEGER NOT NULL CHECK (base_version > 0),
  reason          TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  author_id       TEXT NOT NULL,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workday_revisions_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT workday_revisions_workday_fk
    FOREIGN KEY (company_id, workday_id)
    REFERENCES public.workdays(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT workday_revisions_author_fk
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT
);
CREATE INDEX workday_revisions_workday_idx
  ON public.workday_revisions (company_id, workday_id, created_at DESC);

ALTER TABLE public.work_week_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_week_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY work_week_approvals_tenant_isolation ON public.work_week_approvals
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.workday_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workday_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY workday_revisions_tenant_isolation ON public.workday_revisions
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON TABLE public.work_week_approvals TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.workday_revisions TO gradix_app;

INSERT INTO public.schema_migrations (name)
VALUES ('20261118120000_r4b_approval')
ON CONFLICT DO NOTHING;
COMMIT;
