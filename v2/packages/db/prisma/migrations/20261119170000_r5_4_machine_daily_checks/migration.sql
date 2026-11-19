-- R5.4: dnevni pregled mašine + prilozi + revizije. FORCE RLS; no DELETE grant.
-- Izvor: v1/docs/BACKEND.md (dnevni pregled / checklist; prilozi kao obaveze)
BEGIN;

-- ---------------------------------------------------------------- machine_daily_checks
CREATE TABLE public.machine_daily_checks (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  machine_id      TEXT NOT NULL,
  worker_id       TEXT NOT NULL,
  project_id      TEXT,
  checked_at      TIMESTAMPTZ NOT NULL,
  result          TEXT NOT NULL,
  checklist_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  note            TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT machine_daily_checks_result_check
    CHECK (result IN ('PASS', 'FAIL', 'CONDITIONAL')),
  CONSTRAINT machine_daily_checks_note_check
    CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT machine_daily_checks_version_check
    CHECK (version > 0),
  CONSTRAINT machine_daily_checks_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT machine_daily_checks_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_daily_checks_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_daily_checks_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_daily_checks_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_daily_checks_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT machine_daily_checks_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_daily_checks_company_checked_idx
  ON public.machine_daily_checks (company_id, checked_at DESC, id);
CREATE INDEX machine_daily_checks_machine_idx
  ON public.machine_daily_checks (company_id, machine_id, checked_at);

-- ---------------------------------------------------------------- machine_daily_check_revisions
CREATE TABLE public.machine_daily_check_revisions (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  check_id       TEXT NOT NULL,
  base_version   INTEGER NOT NULL CHECK (base_version > 0),
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  author_id      TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT machine_daily_check_revisions_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_daily_check_revisions_check_fk
    FOREIGN KEY (company_id, check_id)
    REFERENCES public.machine_daily_checks(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_daily_check_revisions_author_fk
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX machine_daily_check_revisions_check_idx
  ON public.machine_daily_check_revisions (company_id, check_id, created_at DESC);

-- ---------------------------------------------------------------- machine_daily_check_attachments
-- Mirror obligation_attachments; status pending/confirmed; NO DELETE grant (app).
CREATE TABLE public.machine_daily_check_attachments (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  check_id       TEXT NOT NULL,
  object_key     TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL,
  sha256         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  uploaded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by     TEXT,
  CONSTRAINT machine_daily_check_attachments_file_name_check
    CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  CONSTRAINT machine_daily_check_attachments_content_type_check
    CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  CONSTRAINT machine_daily_check_attachments_size_check
    CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT machine_daily_check_attachments_sha256_check
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT machine_daily_check_attachments_status_check
    CHECK (status IN ('pending', 'confirmed')),
  CONSTRAINT machine_daily_check_attachments_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT machine_daily_check_attachments_check_fk
    FOREIGN KEY (company_id, check_id)
    REFERENCES public.machine_daily_checks(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT machine_daily_check_attachments_sha_unique
    UNIQUE (check_id, sha256)
);

CREATE INDEX machine_daily_check_attachments_check_idx
  ON public.machine_daily_check_attachments (check_id, created_at DESC);
CREATE INDEX machine_daily_check_attachments_pending_idx
  ON public.machine_daily_check_attachments (company_id, created_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------- RLS
ALTER TABLE public.machine_daily_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_daily_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY machine_daily_checks_tenant_isolation ON public.machine_daily_checks
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.machine_daily_check_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_daily_check_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY machine_daily_check_revisions_tenant_isolation ON public.machine_daily_check_revisions
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.machine_daily_check_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_daily_check_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY machine_daily_check_attachments_tenant_isolation ON public.machine_daily_check_attachments
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_daily_checks TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.machine_daily_check_revisions TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.machine_daily_check_attachments TO gradix_app;

INSERT INTO public.schema_migrations (name)
VALUES ('20261119170000_r5_4_machine_daily_checks')
ON CONFLICT DO NOTHING;
COMMIT;
