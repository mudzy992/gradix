-- R5.5: partners + machine_faults + approval_requests. FORCE RLS; no DELETE grant.
-- Izvor: v1/docs/BACKEND.md (kvarovi / servis / partner)
BEGIN;

-- ---------------------------------------------------------------- partners
CREATE TABLE public.partners (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  note        TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partners_kind_check CHECK (kind IN ('VENDOR', 'SERVICE', 'OTHER')),
  CONSTRAINT partners_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 64),
  CONSTRAINT partners_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT partners_note_check CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT partners_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT partners_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT partners_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT
);

CREATE INDEX partners_company_active_idx
  ON public.partners (company_id, active, code);

-- ---------------------------------------------------------------- machine_faults
CREATE TABLE public.machine_faults (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT NOT NULL,
  machine_id            TEXT NOT NULL,
  reporter_worker_id    TEXT,
  project_id            TEXT,
  partner_id            TEXT,
  reported_at           TIMESTAMPTZ NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  priority              TEXT NOT NULL,
  status                TEXT NOT NULL,
  estimated_cost_cents  BIGINT,
  currency_code         TEXT,
  downtime_minutes      INTEGER,
  version               INTEGER NOT NULL DEFAULT 1,
  created_by            TEXT NOT NULL,
  updated_by            TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT machine_faults_priority_check
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT machine_faults_status_check
    CHECK (status IN ('OPEN', 'WAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  CONSTRAINT machine_faults_title_check
    CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT machine_faults_description_check
    CHECK (description IS NULL OR length(description) <= 4000),
  CONSTRAINT machine_faults_money_pair_check
    CHECK (
      (estimated_cost_cents IS NULL AND currency_code IS NULL)
      OR (estimated_cost_cents IS NOT NULL AND estimated_cost_cents >= 0
          AND currency_code IS NOT NULL AND char_length(currency_code) = 3)
    ),
  CONSTRAINT machine_faults_downtime_check
    CHECK (downtime_minutes IS NULL OR downtime_minutes >= 0),
  CONSTRAINT machine_faults_version_check CHECK (version > 0),
  CONSTRAINT machine_faults_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT machine_faults_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_faults_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_faults_reporter_fk
    FOREIGN KEY (company_id, reporter_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_faults_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_faults_partner_fk
    FOREIGN KEY (company_id, partner_id) REFERENCES public.partners(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_faults_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT machine_faults_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_faults_company_reported_idx
  ON public.machine_faults (company_id, reported_at DESC, id);
CREATE INDEX machine_faults_machine_idx
  ON public.machine_faults (company_id, machine_id, reported_at);
CREATE INDEX machine_faults_status_idx
  ON public.machine_faults (company_id, status, reported_at DESC);

-- ---------------------------------------------------------------- machine_fault_revisions
CREATE TABLE public.machine_fault_revisions (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  fault_id       TEXT NOT NULL,
  base_version   INTEGER NOT NULL CHECK (base_version > 0),
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  author_id      TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT machine_fault_revisions_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_fault_revisions_fault_fk
    FOREIGN KEY (company_id, fault_id)
    REFERENCES public.machine_faults(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_fault_revisions_author_fk
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_fault_revisions_fault_idx
  ON public.machine_fault_revisions (company_id, fault_id, created_at DESC);

-- ---------------------------------------------------------------- approval_requests (status reuse pattern)
CREATE TABLE public.approval_requests (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  subject_type    TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  amount_cents    BIGINT NOT NULL,
  currency_code   TEXT NOT NULL,
  status          TEXT NOT NULL,
  reason          TEXT,
  requested_by    TEXT NOT NULL,
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT approval_requests_subject_type_check
    CHECK (subject_type IN ('machine_fault')),
  CONSTRAINT approval_requests_status_check
    CHECK (status IN ('OPEN', 'APPROVED', 'REJECTED')),
  CONSTRAINT approval_requests_amount_check CHECK (amount_cents >= 0),
  CONSTRAINT approval_requests_currency_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT approval_requests_reason_check
    CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 10 AND 500),
  CONSTRAINT approval_requests_decision_check CHECK (
    (status = 'OPEN' AND decided_by IS NULL AND decided_at IS NULL)
    OR
    (status IN ('APPROVED', 'REJECTED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT approval_requests_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT approval_requests_requested_by_fk
    FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT approval_requests_decided_by_fk
    FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX approval_requests_open_subject_uidx
  ON public.approval_requests (company_id, subject_type, subject_id)
  WHERE status = 'OPEN';
CREATE INDEX approval_requests_company_status_idx
  ON public.approval_requests (company_id, status, created_at DESC);

-- ---------------------------------------------------------------- RLS
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners FORCE ROW LEVEL SECURITY;
CREATE POLICY partners_tenant_isolation ON public.partners
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.machine_faults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_faults FORCE ROW LEVEL SECURITY;
CREATE POLICY machine_faults_tenant_isolation ON public.machine_faults
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.machine_fault_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_fault_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY machine_fault_revisions_tenant_isolation ON public.machine_fault_revisions
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_requests_tenant_isolation ON public.approval_requests
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON TABLE public.partners TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_faults TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.machine_fault_revisions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.approval_requests TO gradix_app;

INSERT INTO public.schema_migrations (name)
VALUES ('20261119180000_r5_5_machine_faults')
ON CONFLICT DO NOTHING;
COMMIT;
