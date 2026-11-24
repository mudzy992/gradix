-- F0.3 — `usage_overrides` zamjenjuje `project_assignment_overrides`.
--
-- Do sada je iznimka od blokade postojala SAMO za dodjelu radnika na projekat i bila je vezana
-- na `assignment_id`. Spec 02 §19 traži iznimku za svaki subjekt (radnik, mašina, tender) i svaku
-- radnju (`assign`, `haul`, `machine_hours`, `tender_submit`), sa odobrenjem i rokom važenja.
--
-- Prenos: postojeći redovi ostaju, `subject_kind = 'WORKER'`, `action = 'assign'`. Stara tabela
-- se NE briše u ovoj migraciji — kod je čita do prelaska na `usage-service`; brisanje je
-- zaseban korak (kao kod priloga u F0.2), da se može odložiti bez zastoja rada.

BEGIN;

CREATE TABLE public.usage_overrides (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  subject_kind  TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  action        TEXT NOT NULL,
  -- Veza na izvor blokade (obaveza, kvar, servis). `NULL` samo za ručnu iznimku bez izvora.
  reference_id  TEXT,
  reason        TEXT NOT NULL,
  valid_from    DATE NOT NULL DEFAULT current_date,
  valid_to      DATE,
  requested_by  TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by   TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT usage_overrides_subject_kind_check CHECK (subject_kind IN ('WORKER', 'MACHINE', 'TENDER')),
  CONSTRAINT usage_overrides_action_check
    CHECK (action IN ('assign', 'haul', 'machine_hours', 'fuel', 'workday', 'tender_submit')),
  -- Iznimka bez razloga je tiho gašenje pravila; ista granica kao u domeni (≥10 znakova).
  CONSTRAINT usage_overrides_reason_check CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT usage_overrides_valid_range_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- Odobrena iznimka mora imati i ko i kad — inače je „odobreno“ samo tvrdnja.
  CONSTRAINT usage_overrides_approval_check
    CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);

CREATE INDEX usage_overrides_subject_idx
  ON public.usage_overrides (company_id, subject_kind, subject_id, action);

ALTER TABLE public.usage_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY usage_overrides_tenant_isolation ON public.usage_overrides
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

GRANT SELECT, INSERT, UPDATE ON public.usage_overrides TO gradix_app;

-- Prenos postojećih iznimaka dodjele. `assignment_id` ostaje u staroj tabeli; ovdje se pamti
-- subjekt, jer iznimka od sada važi za OSOBU, ne za jedan red dodjele.
INSERT INTO public.usage_overrides
  (id, company_id, subject_kind, subject_id, action, reference_id, reason,
   valid_from, valid_to, requested_by, approved_by, approved_at, created_at)
SELECT 'uo_' || o.id,
       o.company_id,
       'WORKER',
       COALESCE(o.worker_id, a.worker_id),
       'assign',
       o.obligation_id,
       o.reason,
       COALESCE(o.created_at::date, current_date),
       o.valid_until,
       o.requested_by,
       o.approved_by,
       o.approved_at,
       o.created_at
  FROM public.project_assignment_overrides o
  LEFT JOIN public.project_assignments a
         ON a.company_id = o.company_id AND a.id = o.assignment_id
 WHERE COALESCE(o.worker_id, a.worker_id) IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.schema_migrations (name)
VALUES ('20261123130000_f0_3_usage_overrides')
ON CONFLICT DO NOTHING;

COMMIT;
