-- F0.2: JEDNA tabela priloga za sve module (Modul 1 `attachment-service`).
--
-- Zašto: do sada su tri paralelna stacka (`obligation_attachments`,
-- `tender_attachments`, `machine_daily_check_attachments`) imala isti životni ciklus
-- (register → presigned PUT → confirm) i tri puta isti kod. Svaki novi modul (servis,
-- dnevnik, HSE, nabavka) tražio bi četvrti. Ovdje je jedan.
--
-- Migracija je DVOSTEPENA (plan, Faza 0):
--   korak A (ova migracija): nova tabela + prenos redova + pogledi za kompatibilnost;
--   korak B (nakon što kod prestane čitati stare tabele): DROP starih tabela.
--
-- Statusi: `pending` (registrovan, upload u toku) → `ready` (potvrđen, veličina provjerena)
-- → `deleted` (meko brisanje; objekat u bucketu briše worker po retenciji).
-- Nema DELETE granta aplikaciji: brisanje je status, kao i svuda u sistemu.

BEGIN;

CREATE TABLE public.attachments (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  -- Na šta je prilog zakačen. Zatvoren skup, jer svaki novi tip mora dobiti i UI i dozvolu.
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  object_key      TEXT NOT NULL,
  file_name       TEXT NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  -- Stvarni tip iz prvih bajtova, ne iz ekstenzije (Modul 1 §prilozi).
  content_type    TEXT NOT NULL CHECK (content_type IN (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'
  )),
  size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256          TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'ready', 'deleted')),
  -- Retencija po tipu priloga (Modul 1/2: osjetljivi prilozi 24 mjeseca).
  -- NULL = ne ističe (npr. dokument uz tender koji se čuva uz tender).
  retention_until DATE,
  uploaded_at     TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by      TEXT,
  CONSTRAINT attachments_entity_type_check
    CHECK (entity_type IN ('OBLIGATION', 'TENDER', 'MACHINE_DAILY_CHECK')),
  CONSTRAINT attachments_ready_has_upload_check
    CHECK ((status = 'ready') = (uploaded_at IS NOT NULL) OR status = 'deleted'),
  CONSTRAINT attachments_deleted_has_time_check
    CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  -- Isti fajl dvaput na istom entitetu je greška, ne duplikat u bucketu.
  CONSTRAINT attachments_entity_sha_unique UNIQUE (company_id, entity_type, entity_id, sha256),
  CONSTRAINT attachments_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT attachments_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX attachments_entity_idx
  ON public.attachments (company_id, entity_type, entity_id, created_at DESC)
  WHERE status <> 'deleted';
CREATE INDEX attachments_pending_idx
  ON public.attachments (company_id, created_at)
  WHERE status = 'pending';
-- Worker briše objekte iz bucketa po retenciji i po napuštenim uploadima.
CREATE INDEX attachments_retention_idx
  ON public.attachments (retention_until)
  WHERE retention_until IS NOT NULL AND status <> 'deleted';

-- ---------------------------------------------------------------- prenos podataka
-- Prenos je običan INSERT ... SELECT: stare tabele ostaju netaknute do koraka B.
-- Statusi: stare tabele koriste `pending`/`ready`/`confirmed`; `confirmed` postaje `ready`.
INSERT INTO public.attachments (
  id, company_id, entity_type, entity_id, object_key, file_name, content_type,
  size_bytes, sha256, status, uploaded_at, created_at, created_by
)
SELECT
  a.id, a.company_id, 'OBLIGATION', a.obligation_id, a.object_key, a.file_name,
  a.content_type, a.size_bytes, a.sha256, a.status, a.uploaded_at, a.created_at, a.created_by
FROM public.obligation_attachments a
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.attachments (
  id, company_id, entity_type, entity_id, object_key, file_name, content_type,
  size_bytes, sha256, status, uploaded_at, created_at, created_by
)
SELECT
  a.id, a.company_id, 'TENDER', a.tender_id, a.object_key, a.file_name,
  a.content_type, a.size_bytes, a.sha256, a.status, a.uploaded_at, a.created_at, a.created_by
FROM public.tender_attachments a
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.attachments (
  id, company_id, entity_type, entity_id, object_key, file_name, content_type,
  size_bytes, sha256, status, uploaded_at, created_at, created_by
)
SELECT
  a.id, a.company_id, 'MACHINE_DAILY_CHECK', a.check_id, a.object_key, a.file_name,
  a.content_type, a.size_bytes, a.sha256,
  CASE a.status WHEN 'confirmed' THEN 'ready' ELSE a.status END,
  a.uploaded_at, a.created_at, a.created_by
FROM public.machine_daily_check_attachments a
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- RLS + prava
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY attachments_tenant_isolation ON public.attachments
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

-- Aplikacija: bez DELETE. Meko brisanje je UPDATE na `deleted`.
GRANT SELECT, INSERT, UPDATE ON TABLE public.attachments TO gradix_app;

INSERT INTO public.schema_migrations (name)
VALUES ('20261123120000_f0_1_attachments_unified')
ON CONFLICT DO NOTHING;

COMMIT;
