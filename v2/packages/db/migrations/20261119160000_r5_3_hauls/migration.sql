-- R5.3: ture (hauls) + stacionaža (route_segments) + revizije. FORCE RLS; no DELETE grant.
-- Izvor: v1/docs/BACKEND.md (ture nepromjenjive; ispravke amendment)
BEGIN;

-- ---------------------------------------------------------------- route_segments
CREATE TABLE public.route_segments (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  project_id    TEXT,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  from_station  TEXT NOT NULL,
  to_station    TEXT NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT route_segments_code_check CHECK (length(btrim(code)) BETWEEN 1 AND 64),
  CONSTRAINT route_segments_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT route_segments_from_station_check CHECK (length(btrim(from_station)) BETWEEN 1 AND 200),
  CONSTRAINT route_segments_to_station_check CHECK (length(btrim(to_station)) BETWEEN 1 AND 200),
  CONSTRAINT route_segments_note_check CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT route_segments_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT route_segments_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT route_segments_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT route_segments_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX route_segments_company_idx
  ON public.route_segments (company_id, code);

-- ---------------------------------------------------------------- hauls
CREATE TABLE public.hauls (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL,
  machine_id         TEXT NOT NULL,
  driver_worker_id   TEXT NOT NULL,
  project_id         TEXT,
  segment_id         TEXT,
  hauled_at          TIMESTAMPTZ NOT NULL,
  origin_text        TEXT NOT NULL,
  destination_text   TEXT NOT NULL,
  material_text      TEXT NOT NULL,
  quantity           NUMERIC(12,3) NOT NULL,
  quantity_unit      TEXT NOT NULL,
  scale_ticket_text  TEXT,
  trip_count         INTEGER NOT NULL DEFAULT 1,
  note               TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  created_by         TEXT NOT NULL,
  updated_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hauls_origin_check CHECK (length(btrim(origin_text)) BETWEEN 1 AND 200),
  CONSTRAINT hauls_destination_check CHECK (length(btrim(destination_text)) BETWEEN 1 AND 200),
  CONSTRAINT hauls_material_check CHECK (length(btrim(material_text)) BETWEEN 1 AND 200),
  CONSTRAINT hauls_quantity_check CHECK (quantity > 0),
  CONSTRAINT hauls_quantity_unit_check CHECK (quantity_unit IN ('M3', 'T')),
  CONSTRAINT hauls_scale_ticket_check CHECK (scale_ticket_text IS NULL OR length(scale_ticket_text) <= 120),
  CONSTRAINT hauls_trip_count_check CHECK (trip_count >= 1),
  CONSTRAINT hauls_note_check CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT hauls_version_check CHECK (version > 0),
  CONSTRAINT hauls_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT hauls_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hauls_machine_fk
    FOREIGN KEY (company_id, machine_id) REFERENCES public.machines(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hauls_driver_fk
    FOREIGN KEY (company_id, driver_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hauls_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hauls_segment_fk
    FOREIGN KEY (company_id, segment_id) REFERENCES public.route_segments(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hauls_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT hauls_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX hauls_company_hauled_idx
  ON public.hauls (company_id, hauled_at DESC, id);
CREATE INDEX hauls_machine_hauled_idx
  ON public.hauls (company_id, machine_id, hauled_at);
CREATE INDEX hauls_driver_hauled_idx
  ON public.hauls (company_id, driver_worker_id, hauled_at);

-- ---------------------------------------------------------------- haul_revisions
CREATE TABLE public.haul_revisions (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  haul_id        TEXT NOT NULL,
  base_version   INTEGER NOT NULL CHECK (base_version > 0),
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  author_id      TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT haul_revisions_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT haul_revisions_haul_fk
    FOREIGN KEY (company_id, haul_id)
    REFERENCES public.hauls(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT haul_revisions_author_fk
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX haul_revisions_haul_idx
  ON public.haul_revisions (company_id, haul_id, created_at DESC);

-- ---------------------------------------------------------------- RLS
ALTER TABLE public.route_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_segments FORCE ROW LEVEL SECURITY;
CREATE POLICY route_segments_tenant_isolation ON public.route_segments
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.hauls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hauls FORCE ROW LEVEL SECURITY;
CREATE POLICY hauls_tenant_isolation ON public.hauls
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.haul_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haul_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY haul_revisions_tenant_isolation ON public.haul_revisions
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON TABLE public.route_segments TO gradix_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.hauls TO gradix_app;
GRANT SELECT, INSERT ON TABLE public.haul_revisions TO gradix_app;

INSERT INTO public.schema_migrations (name)
VALUES ('20261119160000_r5_3_hauls')
ON CONFLICT DO NOTHING;
COMMIT;
