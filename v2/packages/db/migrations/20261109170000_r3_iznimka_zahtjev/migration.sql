-- =============================================================================
-- R3 — zahtjev za iznimku (PM traži, vlasnik odobrava)
--
-- Do sada je iznimka mogla nastati samo zajedno sa dodjelom. To je značilo: ko dodjeljuje, taj i
-- odobrava — pa je blokada iz B5.4 važila samo protiv onoga ko se sam ne može ugasiti.
--
-- Od sada iznimka ima dva koraka:
--   1. `projects.assign` (PM) šalje ZAHTJEV — red bez dodjele (`assignment_id` NULL), sa razlogom,
--   2. `projects.override` (vlasnik/admin) odobrava — i tek tada nastaje dodjela sa iznimkom.
-- =============================================================================

-- Zahtjev postoji PRIJE dodjele, pa veza na dodjelu mora biti opciona.
ALTER TABLE project_assignment_overrides ALTER COLUMN assignment_id DROP NOT NULL;

-- Zahtjev se odnosi na projekat i na entitet — bez toga se ne zna čega se traži.
ALTER TABLE project_assignment_overrides
  ADD COLUMN project_id   TEXT,
  ADD COLUMN worker_id    TEXT,
  ADD COLUMN machine_id   TEXT,
  ADD COLUMN requested_by TEXT,
  ADD COLUMN approved_at  TIMESTAMPTZ,
  ADD COLUMN approved_by  TEXT;

-- Postojeće iznimke su odobrene u trenutku upisa (nastale su zajedno sa dodjelom).
UPDATE project_assignment_overrides
   SET approved_at = created_at
 WHERE assignment_id IS NOT NULL AND approved_at IS NULL;

-- Rok važi samo za ODOBRENU iznimku: zahtjev još nema rok.
ALTER TABLE project_assignment_overrides ALTER COLUMN valid_until DROP NOT NULL;
ALTER TABLE project_assignment_overrides DROP CONSTRAINT project_assignment_overrides_valid;

ALTER TABLE project_assignment_overrides
  ADD CONSTRAINT project_assignment_overrides_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES projects (company_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT project_assignment_overrides_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES workers (company_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT project_assignment_overrides_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES machines (company_id, id) ON DELETE CASCADE,
  -- Zahtjev visi na TAČNO JEDNOM entitetu, isto pravilo kao dodjela.
  ADD CONSTRAINT project_assignment_overrides_one_target CHECK (
    (worker_id IS NOT NULL)::int + (machine_id IS NOT NULL)::int <= 1
  ),
  -- Iznimka bez roka bila bi trajno gašenje pravila pod imenom „iznimka". Zahtjev roka nema.
  ADD CONSTRAINT project_assignment_overrides_valid CHECK (
    approved_at IS NULL OR (valid_until IS NOT NULL AND valid_until >= approved_at::date)
  );

CREATE INDEX project_assignment_overrides_project_idx
  ON project_assignment_overrides (company_id, project_id) WHERE project_id IS NOT NULL;
-- Otvoreni zahtjevi: ono što vlasnik treba da vidi na jednom mjestu.
CREATE INDEX project_assignment_overrides_pending_idx
  ON project_assignment_overrides (company_id, created_at)
  WHERE approved_at IS NULL;

ALTER TABLE project_assignment_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_assignment_overrides FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_assignment_overrides;
CREATE POLICY tenant_isolation ON project_assignment_overrides
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

INSERT INTO schema_migrations (name) VALUES ('20261109170000_r3_iznimka_zahtjev')
  ON CONFLICT DO NOTHING;
