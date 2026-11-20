-- R7: partners.CLIENT + tenders + tender_attachments + obligations.tender_id.
-- Izvor: v1/backend/.../tender-status.ts, tenders.service.ts (samo čitanje).
BEGIN;

ALTER TABLE public.partners DROP CONSTRAINT partners_kind_check;
ALTER TABLE public.partners
  ADD CONSTRAINT partners_kind_check
  CHECK (kind IN ('VENDOR', 'SERVICE', 'OTHER', 'CLIENT'));

CREATE TABLE public.tenders (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT NOT NULL,
  title                  TEXT NOT NULL,
  partner_id             TEXT NOT NULL,
  submitted_value_cents  BIGINT NOT NULL,
  currency_code          TEXT NOT NULL,
  submitted_at           TIMESTAMPTZ,
  status                 TEXT NOT NULL,
  note                   TEXT,
  converted_project_id   TEXT,
  created_by             TEXT NOT NULL,
  updated_by             TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tenders_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  CONSTRAINT tenders_status_check
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'WON', 'LOST', 'WITHDRAWN')),
  CONSTRAINT tenders_money_check
    CHECK (submitted_value_cents >= 0 AND char_length(currency_code) = 3),
  CONSTRAINT tenders_note_check CHECK (note IS NULL OR length(note) <= 4000),
  CONSTRAINT tenders_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT tenders_converted_project_unique UNIQUE (converted_project_id),
  CONSTRAINT tenders_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT tenders_partner_fk
    FOREIGN KEY (company_id, partner_id) REFERENCES public.partners(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT tenders_converted_project_fk
    FOREIGN KEY (company_id, converted_project_id)
    REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT tenders_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT tenders_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX tenders_company_status_idx ON public.tenders (company_id, status, created_at DESC);
CREATE INDEX tenders_company_partner_idx ON public.tenders (company_id, partner_id);

ALTER TABLE public.tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenders_tenant_isolation ON public.tenders
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON TABLE public.tenders TO gradix_app;

CREATE TABLE public.tender_attachments (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tender_id     TEXT NOT NULL,
  object_key    TEXT NOT NULL,
  file_name     TEXT NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  content_type  TEXT NOT NULL CHECK (content_type IN (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'
  )),
  size_bytes    BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256        TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  uploaded_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  CONSTRAINT tender_attachments_tender_fk
    FOREIGN KEY (company_id, tender_id) REFERENCES public.tenders(company_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_attachments_sha_unique UNIQUE (tender_id, sha256)
);

CREATE INDEX tender_attachments_tender_idx
  ON public.tender_attachments (tender_id, created_at DESC);
CREATE INDEX tender_attachments_pending_idx
  ON public.tender_attachments (company_id, created_at) WHERE status = 'pending';

ALTER TABLE public.tender_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tender_attachments_tenant_isolation ON public.tender_attachments
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON TABLE public.tender_attachments TO gradix_app;

ALTER TABLE public.obligations ADD COLUMN tender_id TEXT;

ALTER TABLE public.obligation_types DROP CONSTRAINT obligation_types_entity_kind_check;
ALTER TABLE public.obligation_types
  ADD CONSTRAINT obligation_types_entity_kind_check
  CHECK (entity_kind IN ('WORKER', 'MACHINE', 'PROJECT', 'COMPANY', 'TENDER'));

ALTER TABLE public.obligations DROP CONSTRAINT obligations_one_scope;
ALTER TABLE public.obligations
  ADD CONSTRAINT obligations_one_scope CHECK (
    (worker_id IS NOT NULL)::int +
    (machine_id IS NOT NULL)::int +
    (project_id IS NOT NULL)::int +
    (tender_id IS NOT NULL)::int +
    (scope_company)::int = 1
  );

ALTER TABLE public.obligations
  ADD CONSTRAINT obligations_tender_fk
  FOREIGN KEY (company_id, tender_id) REFERENCES public.tenders(company_id, id) ON DELETE RESTRICT;

CREATE INDEX obligations_tender_idx
  ON public.obligations (company_id, tender_id) WHERE tender_id IS NOT NULL;

CREATE UNIQUE INDEX obligations_active_tender_type_unique
  ON public.obligations (company_id, tender_id, type_id)
  WHERE tender_id IS NOT NULL AND superseded_by IS NULL;

INSERT INTO public.obligation_types (
  id, company_id, code, label, entity_kind, default_reminder_days,
  requires_attachment, sort_order, blocks_assignment
)
SELECT
  target_company || '_obt_tender_docs',
  target_company,
  'TENDER_DOCS',
  'Tenderska dokumentacija',
  'TENDER',
  '{14,7,3,1}',
  true,
  10,
  false
FROM (SELECT id AS target_company FROM public.companies) c
ON CONFLICT (company_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_obligation_types(target_company TEXT)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO obligation_types (id, company_id, code, label, entity_kind, default_reminder_days,
                                requires_attachment, sort_order, blocks_assignment)
  VALUES
    (target_company || '_obt_medical',        target_company, 'MEDICAL',          'Ljekarski pregled',           'WORKER',  '{60,30,15,7}', true,  10, true),
    (target_company || '_obt_safety',         target_company, 'SAFETY_TRAINING',  'Obuka iz zaštite na radu',    'WORKER',  '{60,30,15,7}', true,  20, true),
    (target_company || '_obt_height',         target_company, 'WORK_AT_HEIGHT',   'Rad na visini',               'WORKER',  '{60,30,15,7}', true,  30, true),
    (target_company || '_obt_excavation',     target_company, 'EXCAVATION',       'Radovi iskopa',               'WORKER',  '{30,15,7}',    false, 40, false),
    (target_company || '_obt_confined',       target_company, 'CONFINED_SPACE',   'Rad u skučenom prostoru',     'WORKER',  '{60,30,15,7}', true,  50, false),
    (target_company || '_obt_machine_permit', target_company, 'MACHINE_LICENCE',  'Ovlaštenje za mašinu',        'WORKER',  '{60,30,15,7}', true,  60, true),
    (target_company || '_obt_driving',        target_company, 'DRIVING_LICENCE',  'Vozačka dozvola',             'WORKER',  '{60,30,15,7}', false, 70, false),
    (target_company || '_obt_first_aid',      target_company, 'FIRST_AID',        'Prva pomoć',                  'WORKER',  '{60,30,15,7}', true,  80, false),
    (target_company || '_obt_registration',   target_company, 'REGISTRATION',     'Registracija',                'MACHINE', '{30,15,7}',    true,  10, true),
    (target_company || '_obt_inspection',     target_company, 'TECH_INSPECTION',  'Tehnički pregled',            'MACHINE', '{30,15,7}',    true,  20, true),
    (target_company || '_obt_insurance',      target_company, 'INSURANCE',        'Osiguranje',                  'MACHINE', '{30,15,7}',    true,  30, true),
    (target_company || '_obt_tachograph',     target_company, 'TACHOGRAPH',       'Tahograf / kalibracija',      'MACHINE', '{30,15,7}',    true,  40, false),
    (target_company || '_obt_crane',          target_company, 'CRANE_ATTEST',     'Atest dizalice',              'MACHINE', '{60,30,15,7}', true,  50, false),
    (target_company || '_obt_extinguisher',   target_company, 'EXTINGUISHER',     'Vatrogasni aparat',           'MACHINE', '{30,15,7}',    false, 60, false),
    (target_company || '_obt_warranty',       target_company, 'WARRANTY',         'Garancija',                   'MACHINE', '{}',           false, 70, false),
    (target_company || '_obt_company_reg',    target_company, 'COMPANY_REGISTRATION', 'Registracija firme',      'COMPANY', '{60,30,15,7}', true,  10, true),
    (target_company || '_obt_licence',        target_company, 'LICENCE',          'Licenca',                     'COMPANY', '{60,30,15,7}', true,  20, true),
    (target_company || '_obt_certificate',    target_company, 'CERTIFICATE',      'Certifikat',                  'COMPANY', '{60,30,15,7}', true,  30, false),
    (target_company || '_obt_company_ins',    target_company, 'COMPANY_INSURANCE','Osiguranje firme',            'COMPANY', '{30,15,7}',    true,  40, false),
    (target_company || '_obt_building_permit', target_company, 'BUILDING_PERMIT', 'Građevinska dozvola',        'PROJECT', '{90,60,30,15}', true,  10, true),
    (target_company || '_obt_consent',        target_company, 'CONSENT',          'Saglasnost',                  'PROJECT', '{30,15,7}',    true,  20, true),
    (target_company || '_obt_road_closure',   target_company, 'ROAD_CLOSURE',     'Dozvola za obustavu saobraćaja','PROJECT', '{30,15,7}',  true,  30, true),
    (target_company || '_obt_public_area',    target_company, 'PUBLIC_AREA',      'Zauzeće javne površine',      'PROJECT', '{30,15,7}',    true,  40, false),
    (target_company || '_obt_environment',    target_company, 'ENVIRONMENT',      'Okolišna saglasnost',         'PROJECT', '{60,30,15,7}', true,  50, true),
    (target_company || '_obt_hse_plan',       target_company, 'HSE_PLAN',         'Elaborat HSE',                'PROJECT', '{30,15,7}',    false, 60, false),
    (target_company || '_obt_site_plan',      target_company, 'SITE_PLAN',        'Plan organizacije gradilišta','PROJECT', '{30,15,7}',   false, 70, true),
    (target_company || '_obt_abnormal_load',  target_company, 'ABNORMAL_LOAD',    'Dozvola za vanredni prijevoz','PROJECT', '{30,15,7}',   true,  80, false),
    (target_company || '_obt_handover',       target_company, 'TECH_HANDOVER',    'Tehnički prijem',             'PROJECT', '{}',           true,  90, false),
    (target_company || '_obt_tender_docs',    target_company, 'TENDER_DOCS',      'Tenderska dokumentacija',     'TENDER',  '{14,7,3,1}',   true,  10, false)
  ON CONFLICT (company_id, code) DO NOTHING;
$$;

INSERT INTO public.schema_migrations (name)
VALUES ('20261120140000_r7_tenders')
ON CONFLICT DO NOTHING;
COMMIT;
