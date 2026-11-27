-- =============================================================================
-- FAZA 9 (Modul 10) — dnevnik građenja i HSE: zakonski dokument i dokaz savesnog
-- postupanja, oba moraju raditi offline.
--
-- Zašto ovaj oblik:
--   1. **Dnevnik je jedan dan po projektu.** Unique `(company_id, project_id, diary_date)` je
--      pravilo, ne savjet: dva šefa na istom gradilištu ne smiju napraviti dva dnevnikа za isti
--      dan. Spajanje po sekcijama (spec §1.8/35) radi nad JEDNIM redom, zato unique.
--   2. **`DRAFT → SIGNED → LOCKED`.** `SIGNED` traži potpis (§1.1/5), `LOCKED` ne dopušta
--      izmjenu — ispravka ide kroz `site_diary_revisions` sa razlogom ≥10 znakova, isti obrazac
--      kao `workday_revisions`/`fuel_entry_revisions`. Bez toga bi „zaključan“ dokument mogao
--      tiho promijeniti sadržaj, što je gore od nepisanog dnevnika.
--   3. **Količine imaju JEDAN izvor završenosti.** `source='BOQ'` stavka ažurira
--      `project_boq_items.quantity_executed` (Modul 6); `source='HAUL'` je izvedena iz tura i
--      samo se potvrđuje. Zato `quantity_executed` NIJE polje koje se unosi — ono je posljedica.
--   4. **HSE mjere su jedna tabela** (`hse_actions`) i za incidente i za inspekcije, sa
--      `CHECK` da ima bar jedan izvor. Dvije tabele bi značile dva roka, dva podsjetnika i dva
--      načina da mjera „padne u zaborav“.
--   5. **`OVERDUE` se računa, ne čuva** (`due_on < danas AND status='OPEN'`). Upisano stanje bi
--      u ponedjeljak lagalo o petku.
--   6. **Incident se NE prepisuje.** Dopuna ide u `hse_incident_updates`; triger odbija izmjenu
--      činjeničnih polja (`HSE_INCIDENT_IMMUTABLE`). Incident je zapis o događaju, ne radni nalog.
--   7. **Prisustvo na obuci je POTPIS**, ne checkbox: `signed_at` + `signature_name` po radniku,
--      uz audit. Checkbox bi bio tvrdnja predstavnika, potpis je tvrdnja radnika.
--
-- Šta NIJE u migraciji: podrazumijevani `site_diary_templates` red. Isti razlog kao
-- `maintenance_templates` (F8) i `tender_checklist_templates` (F7): `created_by` pokazuje na
-- STVARNOG korisnika, pa se šablon pravi lenjo u servisu (`ensureDefaultDiaryTemplate`).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. Dnevnik građenja

CREATE TABLE public.site_diaries (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,
  project_id          TEXT NOT NULL,
  diary_date          DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'DRAFT',
  /* Vrijeme je RUČNI unos u MVP-u (§1.1/3); `weather_source` ostaje za kasniju integraciju sa
     vremenskom stanicom — kolona postoji da se izvor zna kad podatak ne dođe od čovjeka. */
  weather             TEXT,
  weather_source      TEXT NOT NULL DEFAULT 'MANUAL',
  temperature_c       NUMERIC(5, 1),
  worked_hours        NUMERIC(6, 2),
  description         TEXT,
  visitors            TEXT,
  events              TEXT,
  /* Automatski izvučeno iz Modula 3/5 — zamrznuto u trenutku potpisa, da PDF poslije ne
     prikazuje drugačije brojeve od onih koje je šef potpisao. */
  auto_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,
  signed_by_worker_id TEXT,
  signed_name         TEXT,
  signed_at           TIMESTAMPTZ,
  locked_at           TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1,
  created_by          TEXT NOT NULL,
  updated_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT site_diaries_status_check CHECK (status IN ('DRAFT', 'SIGNED', 'LOCKED')),
  CONSTRAINT site_diaries_weather_check CHECK (
    weather IS NULL OR weather IN ('CLEAR', 'CLOUDY', 'RAIN', 'SNOW', 'WIND', 'FROST', 'HEAT')
  ),
  CONSTRAINT site_diaries_weather_source_check CHECK (weather_source IN ('MANUAL', 'STATION')),
  CONSTRAINT site_diaries_temperature_check CHECK (temperature_c IS NULL OR (temperature_c >= -60 AND temperature_c <= 60)),
  CONSTRAINT site_diaries_hours_check CHECK (worked_hours IS NULL OR (worked_hours >= 0 AND worked_hours <= 24)),
  CONSTRAINT site_diaries_description_check CHECK (description IS NULL OR length(description) <= 4000),
  CONSTRAINT site_diaries_visitors_check CHECK (visitors IS NULL OR length(visitors) <= 2000),
  CONSTRAINT site_diaries_events_check CHECK (events IS NULL OR length(events) <= 4000),
  /* `SIGNED` bez potpisa je nemoguće stanje: dokument koji tvrdi da je potpisan, a nema ko/кад. */
  CONSTRAINT site_diaries_signature_check CHECK (
    (status = 'DRAFT' AND signed_at IS NULL AND signed_name IS NULL)
    OR (status IN ('SIGNED', 'LOCKED')
        AND signed_at IS NOT NULL
        AND signed_name IS NOT NULL
        AND length(btrim(signed_name)) BETWEEN 1 AND 200)
  ),
  CONSTRAINT site_diaries_locked_check CHECK ((status = 'LOCKED') = (locked_at IS NOT NULL)),
  CONSTRAINT site_diaries_version_check CHECK (version > 0),
  CONSTRAINT site_diaries_company_id_unique UNIQUE (company_id, id),
  /* JEDAN dan po projektu (§1.1/1) — ovo je pravilo, ne savjet. */
  CONSTRAINT site_diaries_project_date_unique UNIQUE (company_id, project_id, diary_date),
  CONSTRAINT site_diaries_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT site_diaries_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT site_diaries_signed_worker_fk
    FOREIGN KEY (company_id, signed_by_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT site_diaries_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX site_diaries_month_idx
  ON public.site_diaries (company_id, project_id, diary_date DESC);
CREATE INDEX site_diaries_unsigned_idx
  ON public.site_diaries (company_id, diary_date)
  WHERE status = 'DRAFT';

CREATE TABLE public.site_diary_items (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  diary_id      TEXT NOT NULL,
  /* `boq_item_id` je NULL za rad koji nije u predmjeru (dnevnik bilježi i sitnice). */
  boq_item_id   TEXT,
  description   TEXT NOT NULL,
  unit          TEXT NOT NULL,
  quantity      NUMERIC(14, 3) NOT NULL,
  source        TEXT NOT NULL DEFAULT 'MANUAL',
  /* Izvor je jedinstven po dnevniku i stavci: ista BOQ stavka ne može dva puta u isti dan. */
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT site_diary_items_source_check CHECK (source IN ('MANUAL', 'HAUL', 'BOQ')),
  CONSTRAINT site_diary_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT site_diary_items_description_check CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  CONSTRAINT site_diary_items_unit_check CHECK (length(btrim(unit)) BETWEEN 1 AND 20),
  /* BOQ stavka ima svoj `boq_item_id`; ostale ga ne smiju imati. */
  CONSTRAINT site_diary_items_boq_pair_check CHECK (
    (source = 'BOQ' AND boq_item_id IS NOT NULL) OR (source <> 'BOQ' AND boq_item_id IS NULL)
  ),
  CONSTRAINT site_diary_items_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_items_diary_fk
    FOREIGN KEY (company_id, diary_id) REFERENCES public.site_diaries(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_items_boq_fk
    FOREIGN KEY (company_id, boq_item_id) REFERENCES public.project_boq_items(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_items_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX site_diary_items_boq_unique
  ON public.site_diary_items (company_id, diary_id, boq_item_id)
  WHERE boq_item_id IS NOT NULL;
CREATE INDEX site_diary_items_diary_idx ON public.site_diary_items (company_id, diary_id);

CREATE TABLE public.site_diary_revisions (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  diary_id      TEXT NOT NULL,
  base_version  INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  /* Cijeli sadržaj prije izmjene — bez njega revizija ne dokazuje šta se promijenilo. */
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT site_diary_revisions_reason_check CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  CONSTRAINT site_diary_revisions_version_check CHECK (base_version > 0),
  CONSTRAINT site_diary_revisions_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_revisions_diary_fk
    FOREIGN KEY (company_id, diary_id) REFERENCES public.site_diaries(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_revisions_author_fk
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX site_diary_revisions_diary_idx
  ON public.site_diary_revisions (company_id, diary_id, created_at DESC);

/* Strukturirani zastoji (§1.1/4): zbir sati po periodu je DOKAZ za produženje roka, pa je vezan
   na `TIME` aneks iz Modula 6 (`extension_days`). Bez veze bi „13 kišnih dana“ ostalo tvrdnja. */
CREATE TABLE public.site_diary_delays (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  diary_id        TEXT NOT NULL,
  kind            TEXT NOT NULL,
  from_at         TIMESTAMPTZ NOT NULL,
  to_at           TIMESTAMPTZ NOT NULL,
  hours           NUMERIC(6, 2) NOT NULL,
  note            TEXT,
  amendment_id    TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT site_diary_delays_kind_check CHECK (
    kind IN ('RAIN', 'SNOW', 'WIND', 'FROST', 'SUBCONTRACTOR', 'MATERIAL', 'PERMIT', 'OTHER')
  ),
  CONSTRAINT site_diary_delays_range_check CHECK (to_at > from_at),
  CONSTRAINT site_diary_delays_hours_check CHECK (hours > 0 AND hours <= 24),
  CONSTRAINT site_diary_delays_note_check CHECK (note IS NULL OR length(note) <= 1000),
  CONSTRAINT site_diary_delays_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_delays_diary_fk
    FOREIGN KEY (company_id, diary_id) REFERENCES public.site_diaries(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_delays_amendment_fk
    FOREIGN KEY (company_id, amendment_id) REFERENCES public.project_amendments(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_delays_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX site_diary_delays_diary_idx ON public.site_diary_delays (company_id, diary_id);
CREATE INDEX site_diary_delays_amendment_idx
  ON public.site_diary_delays (company_id, amendment_id)
  WHERE amendment_id IS NOT NULL;

-- ---------------------------------------------------------------- 2. Šablon dnevnika po firmi

/* Šablon je PODATAK, ne kod (§1.7/31-32): zaglavlje, redoslijed sekcija i potpisne linije se
   mijenjaju od firme do firme i od opštine do opštine. Do potvrde vlasnika/pravnika izvoz nosi
   `DRAFT_FORMAT` oznaku — `format_confirmed_at` je taj prekidač, i to je JEDINO mjesto gdje se
   tvrdi da je obrazac zakonski. */
CREATE TABLE public.site_diary_templates (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,
  name                TEXT NOT NULL,
  header              JSONB NOT NULL DEFAULT '{}'::jsonb,
  sections            JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  format_confirmed_at TIMESTAMPTZ,
  format_confirmed_by TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT site_diary_templates_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT site_diary_templates_sections_check CHECK (jsonb_typeof(sections) = 'array'),
  CONSTRAINT site_diary_templates_header_check CHECK (jsonb_typeof(header) = 'object'),
  CONSTRAINT site_diary_templates_confirm_pair_check CHECK (
    (format_confirmed_at IS NULL AND format_confirmed_by IS NULL) OR format_confirmed_at IS NOT NULL
  ),
  CONSTRAINT site_diary_templates_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT site_diary_templates_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_templates_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

/* Jedan podrazumijevani šablon po firmi — djelimični unikat. */
CREATE UNIQUE INDEX site_diary_templates_default_unique
  ON public.site_diary_templates (company_id)
  WHERE is_default AND is_active;

-- ---------------------------------------------------------------- 3. HSE: incident, dopuna, istraga

CREATE TABLE public.hse_incidents (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT NOT NULL,
  project_id             TEXT,
  /* `NEAR_MISS` je RAVNOPRAVNA kategorija (§1.3/12), ne „manji incident“: najkorisniji
     preventivni signal. Zato je u istom CHECK-u, a ne u zasebnom polju. */
  kind                   TEXT NOT NULL,
  severity               TEXT NOT NULL,
  occurred_at            TIMESTAMPTZ NOT NULL,
  location_text          TEXT,
  lat                    NUMERIC(9, 6),
  lng                    NUMERIC(9, 6),
  description            TEXT NOT NULL,
  immediate_action       TEXT,
  reporter_worker_id     TEXT,
  reporter_user_id       TEXT,
  injured_worker_id      TEXT,
  lost_days              INTEGER NOT NULL DEFAULT 0,
  reportable_to_authority BOOLEAN NOT NULL DEFAULT false,
  authority_reported_at  TIMESTAMPTZ,
  /* Veza na obavezu iz Modula 2 (`HSE_REPORT`). Bez nje bi prijava inspekciji živjela u dva
     sistema: u HSE modulu i u rokovima, sa dva podsjetnika i dva roka. */
  report_obligation_id   TEXT,
  status                 TEXT NOT NULL DEFAULT 'REPORTED',
  closed_at              TIMESTAMPTZ,
  closed_by              TEXT,
  /* Ključ idempotencije za offline prijavu: isti `localId` drugi put ne pravi drugi incident. */
  client_local_id        TEXT,
  created_by             TEXT NOT NULL,
  updated_by             TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hse_incidents_kind_check CHECK (
    kind IN ('ACCIDENT', 'NEAR_MISS', 'PROPERTY_DAMAGE', 'ENVIRONMENTAL', 'OCCUPATIONAL_ILLNESS')
  ),
  CONSTRAINT hse_incidents_severity_check CHECK (severity IN ('MINOR', 'MODERATE', 'SEVERE', 'FATAL')),
  CONSTRAINT hse_incidents_status_check CHECK (status IN ('REPORTED', 'INVESTIGATING', 'ACTIONS_OPEN', 'CLOSED')),
  CONSTRAINT hse_incidents_description_check CHECK (length(btrim(description)) BETWEEN 5 AND 4000),
  CONSTRAINT hse_incidents_action_check CHECK (immediate_action IS NULL OR length(immediate_action) <= 2000),
  CONSTRAINT hse_incidents_location_check CHECK (location_text IS NULL OR length(location_text) <= 300),
  CONSTRAINT hse_incidents_lost_days_check CHECK (lost_days >= 0 AND lost_days <= 3650),
  CONSTRAINT hse_incidents_coords_check CHECK (
    (lat IS NULL AND lng IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
  ),
  /* `NEAR_MISS` ne može imati izgubljene dane ni povrijeđenog: to bi bio accident sa pogrešnom
     etiketom, i statistika bi lagala na obje strane. */
  CONSTRAINT hse_incidents_near_miss_check CHECK (
    kind <> 'NEAR_MISS' OR (lost_days = 0 AND injured_worker_id IS NULL)
  ),
  CONSTRAINT hse_incidents_reported_pair_check CHECK (
    reportable_to_authority OR (authority_reported_at IS NULL)
  ),
  CONSTRAINT hse_incidents_closed_pair_check CHECK (
    (status = 'CLOSED') = (closed_at IS NOT NULL)
  ),
  CONSTRAINT hse_incidents_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT hse_incidents_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hse_incidents_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_incidents_reporter_worker_fk
    FOREIGN KEY (company_id, reporter_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_incidents_injured_worker_fk
    FOREIGN KEY (company_id, injured_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_incidents_reporter_user_fk
    FOREIGN KEY (reporter_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT hse_incidents_obligation_fk
    FOREIGN KEY (company_id, report_obligation_id) REFERENCES public.obligations(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_incidents_closed_by_fk
    FOREIGN KEY (closed_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT hse_incidents_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

/* Isti telefonski `localId` drugi put ne pravi drugi incident (offline ponovni push). */
CREATE UNIQUE INDEX hse_incidents_client_local_unique
  ON public.hse_incidents (company_id, client_local_id)
  WHERE client_local_id IS NOT NULL;
CREATE INDEX hse_incidents_open_idx
  ON public.hse_incidents (company_id, occurred_at DESC)
  WHERE status <> 'CLOSED';
CREATE INDEX hse_incidents_project_idx
  ON public.hse_incidents (company_id, project_id, occurred_at DESC);

/* Dopuna, NIKAD prepisivanje (§1.8/36). Dva zapisa o istom događaju nisu sukob — to je drugi
   svjedok. Zato posebna tabela, a ne UPDATE opisa. */
CREATE TABLE public.hse_incident_updates (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  incident_id   TEXT NOT NULL,
  author_id     TEXT,
  author_worker_id TEXT,
  body          TEXT NOT NULL,
  client_local_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hse_incident_updates_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  CONSTRAINT hse_incident_updates_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hse_incident_updates_incident_fk
    FOREIGN KEY (company_id, incident_id) REFERENCES public.hse_incidents(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_incident_updates_author_fk
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT hse_incident_updates_worker_fk
    FOREIGN KEY (company_id, author_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX hse_incident_updates_client_local_unique
  ON public.hse_incident_updates (company_id, client_local_id)
  WHERE client_local_id IS NOT NULL;
CREATE INDEX hse_incident_updates_incident_idx
  ON public.hse_incident_updates (company_id, incident_id, created_at);

CREATE TABLE public.hse_investigations (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,
  incident_id         TEXT NOT NULL,
  root_cause          TEXT NOT NULL,
  method              TEXT NOT NULL DEFAULT 'FIVE_WHY',
  findings            TEXT,
  investigator_user_id TEXT NOT NULL,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hse_investigations_method_check CHECK (method IN ('FIVE_WHY', 'FISHBONE', 'OTHER')),
  CONSTRAINT hse_investigations_root_cause_check CHECK (length(btrim(root_cause)) BETWEEN 5 AND 4000),
  CONSTRAINT hse_investigations_findings_check CHECK (findings IS NULL OR length(findings) <= 4000),
  CONSTRAINT hse_investigations_company_id_unique UNIQUE (company_id, id),
  /* Jedna istraga po incidentu — druga bi značila dva uzroka i dvije istine. */
  CONSTRAINT hse_investigations_incident_unique UNIQUE (company_id, incident_id),
  CONSTRAINT hse_investigations_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hse_investigations_incident_fk
    FOREIGN KEY (company_id, incident_id) REFERENCES public.hse_incidents(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_investigations_investigator_fk
    FOREIGN KEY (investigator_user_id) REFERENCES public.users(id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------- 4. Inspekcije

CREATE TABLE public.hse_inspections (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL,
  project_id           TEXT,
  kind                 TEXT NOT NULL,
  authority_name       TEXT,
  inspected_at         TIMESTAMPTZ NOT NULL,
  inspector_name       TEXT,
  summary              TEXT,
  result               TEXT NOT NULL,
  /* `PROHIBITION` (zabrana rada) je najteži ishod: ističe se na Pregledu i šalje CRITICAL
     notifikaciju vlasniku (§1.5/25). `prohibition_lifted_at` je jedini način da nestane. */
  prohibition_lifted_at TIMESTAMPTZ,
  created_by           TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hse_inspections_kind_check CHECK (kind IN ('INTERNAL', 'EXTERNAL', 'AUTHORITY')),
  CONSTRAINT hse_inspections_result_check CHECK (result IN ('PASS', 'MINOR_FINDINGS', 'MAJOR_FINDINGS', 'PROHIBITION')),
  CONSTRAINT hse_inspections_summary_check CHECK (summary IS NULL OR length(summary) <= 4000),
  CONSTRAINT hse_inspections_authority_check CHECK (
    kind <> 'AUTHORITY' OR (authority_name IS NOT NULL AND length(btrim(authority_name)) BETWEEN 2 AND 200)
  ),
  CONSTRAINT hse_inspections_lifted_check CHECK (
    result = 'PROHIBITION' OR prohibition_lifted_at IS NULL
  ),
  CONSTRAINT hse_inspections_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT hse_inspections_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hse_inspections_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_inspections_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE INDEX hse_inspections_list_idx
  ON public.hse_inspections (company_id, inspected_at DESC);
/* Zabrana koja još traje — jedini skup koji smije zasjeniti Pregled. */
CREATE INDEX hse_inspections_prohibition_idx
  ON public.hse_inspections (company_id, inspected_at DESC)
  WHERE result = 'PROHIBITION' AND prohibition_lifted_at IS NULL;

-- ---------------------------------------------------------------- 5. Mjere (jedna tabela)

CREATE TABLE public.hse_actions (
  id                      TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL,
  incident_id             TEXT,
  inspection_id           TEXT,
  description             TEXT NOT NULL,
  responsible_worker_id   TEXT NOT NULL,
  due_on                  DATE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'OPEN',
  done_at                 TIMESTAMPTZ,
  done_by                 TEXT,
  evidence_attachment_id  TEXT,
  client_local_id         TEXT,
  created_by              TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hse_actions_status_check CHECK (status IN ('OPEN', 'DONE', 'CANCELLED')),
  CONSTRAINT hse_actions_description_check CHECK (length(btrim(description)) BETWEEN 5 AND 1000),
  /* Mjera bez izvora, bez odgovornog ili bez roka se ODBIJA (§1.3/15): mjera koja nikome nije
     dodijeljena i nema rok je zabilješka, ne mjera. */
  CONSTRAINT hse_actions_source_check CHECK (incident_id IS NOT NULL OR inspection_id IS NOT NULL),
  CONSTRAINT hse_actions_done_pair_check CHECK (
    (status = 'DONE') = (done_at IS NOT NULL)
  ),
  CONSTRAINT hse_actions_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT hse_actions_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hse_actions_incident_fk
    FOREIGN KEY (company_id, incident_id) REFERENCES public.hse_incidents(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_actions_inspection_fk
    FOREIGN KEY (company_id, inspection_id) REFERENCES public.hse_inspections(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_actions_responsible_fk
    FOREIGN KEY (company_id, responsible_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_actions_done_by_fk
    FOREIGN KEY (done_by) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT hse_actions_evidence_fk
    FOREIGN KEY (evidence_attachment_id) REFERENCES public.attachments(id) ON DELETE RESTRICT,
  CONSTRAINT hse_actions_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX hse_actions_client_local_unique
  ON public.hse_actions (company_id, client_local_id)
  WHERE client_local_id IS NOT NULL;
/* Mjere koje kasne: tačno ovaj skup nosi Pregled i podsjetnik. */
CREATE INDEX hse_actions_due_idx
  ON public.hse_actions (company_id, due_on)
  WHERE status = 'OPEN';
CREATE INDEX hse_actions_incident_idx
  ON public.hse_actions (company_id, incident_id)
  WHERE incident_id IS NOT NULL;
CREATE INDEX hse_actions_inspection_idx
  ON public.hse_actions (company_id, inspection_id)
  WHERE inspection_id IS NOT NULL;

-- ---------------------------------------------------------------- 6. Obuke i prisustvo

CREATE TABLE public.hse_trainings (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  project_id        TEXT,
  kind              TEXT NOT NULL,
  title             TEXT NOT NULL,
  topic             TEXT,
  held_at           TIMESTAMPTZ NOT NULL,
  held_by_worker_id TEXT,
  held_by_user_id   TEXT,
  location          TEXT,
  duration_minutes  INTEGER,
  notes             TEXT,
  client_local_id   TEXT,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hse_trainings_kind_check CHECK (
    kind IN ('INDUCTION', 'TOOLBOX', 'TASK_INSTRUCTION', 'CERTIFICATION', 'DRILL')
  ),
  CONSTRAINT hse_trainings_title_check CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  CONSTRAINT hse_trainings_topic_check CHECK (topic IS NULL OR length(topic) <= 1000),
  CONSTRAINT hse_trainings_duration_check CHECK (
    duration_minutes IS NULL OR (duration_minutes > 0 AND duration_minutes <= 600)
  ),
  CONSTRAINT hse_trainings_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT hse_trainings_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hse_trainings_project_fk
    FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_trainings_held_by_worker_fk
    FOREIGN KEY (company_id, held_by_worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_trainings_held_by_user_fk
    FOREIGN KEY (held_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT hse_trainings_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX hse_trainings_client_local_unique
  ON public.hse_trainings (company_id, client_local_id)
  WHERE client_local_id IS NOT NULL;
CREATE INDEX hse_trainings_held_idx ON public.hse_trainings (company_id, held_at DESC);
CREATE INDEX hse_trainings_kind_idx ON public.hse_trainings (company_id, kind, held_at DESC);

/* Prisustvo je POTPIS (§1.4/19, 22): `signed_at` + `signature_name` po radniku. U MVP-u to nije
   kvalifikovani elektronski potpis (B15.16), ali jeste tvrdnja radnika, a ne predstavnika. */
CREATE TABLE public.hse_training_attendees (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  training_id     TEXT NOT NULL,
  worker_id       TEXT NOT NULL,
  signature_name  TEXT NOT NULL,
  signed_at       TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hse_training_attendees_signature_check CHECK (length(btrim(signature_name)) BETWEEN 2 AND 200),
  CONSTRAINT hse_training_attendees_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hse_training_attendees_training_fk
    FOREIGN KEY (company_id, training_id) REFERENCES public.hse_trainings(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT hse_training_attendees_worker_fk
    FOREIGN KEY (company_id, worker_id) REFERENCES public.workers(company_id, id) ON DELETE RESTRICT,
  /* Isti radnik dvaput na istoj obuci je greška unosa, ne dva prisustva. */
  CONSTRAINT hse_training_attendees_unique UNIQUE (company_id, training_id, worker_id)
);

CREATE INDEX hse_training_attendees_worker_idx
  ON public.hse_training_attendees (company_id, worker_id, signed_at DESC);

-- ---------------------------------------------------------------- 7. Prilozi: mirror dnevni-pregled obrasca

/* Zašto mirror, a ne `attachments`: ista pravila kao `machine_daily_check_attachments` —
   `pending` → `confirmed` sa `sha256` unikatom po entitetu. Prilog je veza na `object_key`, a ne
   kopija fajla; mobilni nastavlja upload kad se vrati mreža. */
CREATE TABLE public.site_diary_attachments (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  diary_id       TEXT NOT NULL,
  object_key     TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL,
  sha256         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  uploaded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by     TEXT,
  CONSTRAINT site_diary_attachments_file_name_check CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  CONSTRAINT site_diary_attachments_content_type_check
    CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  CONSTRAINT site_diary_attachments_size_check CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT site_diary_attachments_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT site_diary_attachments_status_check CHECK (status IN ('pending', 'confirmed')),
  CONSTRAINT site_diary_attachments_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_attachments_diary_fk
    FOREIGN KEY (company_id, diary_id) REFERENCES public.site_diaries(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT site_diary_attachments_sha_unique UNIQUE (diary_id, sha256)
);

CREATE INDEX site_diary_attachments_diary_idx
  ON public.site_diary_attachments (diary_id, created_at DESC);

CREATE TABLE public.hse_attachments (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  object_key     TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL,
  sha256         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  uploaded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by     TEXT,
  CONSTRAINT hse_attachments_entity_type_check
    CHECK (entity_type IN ('INCIDENT', 'INSPECTION', 'TRAINING')),
  CONSTRAINT hse_attachments_file_name_check CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  CONSTRAINT hse_attachments_content_type_check
    CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  CONSTRAINT hse_attachments_size_check CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT hse_attachments_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hse_attachments_status_check CHECK (status IN ('pending', 'confirmed')),
  CONSTRAINT hse_attachments_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT hse_attachments_sha_unique UNIQUE (entity_type, entity_id, sha256)
);

CREATE INDEX hse_attachments_entity_idx
  ON public.hse_attachments (company_id, entity_type, entity_id, created_at DESC);

-- ---------------------------------------------------------------- 8. Trigeri

/*
 * Zaključan dnevnik se NE mijenja (§1.1/5). Triger brani izmjenu sadržaja, ali dopušta prelaz
 * `LOCKED → LOCKED` kad se mijenja samo `updated_at`/`version` (idempotentan ponovni poziv).
 *
 * Zašto triger, a ne samo servis: servis je jedan pozivalac, ali sync i budući izvještaji pišu
 * istim tabelama — pravilo koje živi samo u TypeScript-u se zaobiđe prvim novim kodom.
 */
CREATE OR REPLACE FUNCTION site_diaries_locked_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('SIGNED', 'LOCKED') THEN
    /*
     * POTPIS je granica (§1.1/5): poslije njega se podaci mijenjaju samo kroz reviziju sa razlogom
     * — inače bi PDF pokazao sadržaj koji potpisnik nije vidio.
     *
     * REVIZIJA je jedini dozvoljen put. Dokaz da je riječ o reviziji nije parametar pozivaoca
     * (to bi bio zaobilaz kroz `SET LOCAL`), nego RED u `site_diary_revisions` sa
     * `base_version = OLD.version` — a takav red nastaje samo prije izmjene, sa sačuvanim
     * SADRŽAJEM PRIJE nje. Bez tog reda izmjena zaključanog dnevnika ostaje nemoguća.
     */
    IF EXISTS (
      SELECT 1 FROM public.site_diary_revisions r
       WHERE r.company_id = OLD.company_id
         AND r.diary_id = OLD.id
         AND r.base_version = OLD.version
    ) THEN
      RETURN NEW;
    END IF;
    IF NEW.status <> 'LOCKED'
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.visitors IS DISTINCT FROM OLD.visitors
       OR NEW.events IS DISTINCT FROM OLD.events
       OR NEW.weather IS DISTINCT FROM OLD.weather
       OR NEW.worked_hours IS DISTINCT FROM OLD.worked_hours
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.signed_name IS DISTINCT FROM OLD.signed_name
    THEN
      RAISE EXCEPTION 'DIARY_ALREADY_LOCKED: zaključan dnevnik se mijenja samo kroz reviziju';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER site_diaries_locked_guard
  BEFORE UPDATE ON public.site_diaries
  FOR EACH ROW EXECUTE FUNCTION site_diaries_locked_guard();

/*
 * Incident je ČINJENICA (§1.8/36): `kind`, `severity`, `occurred_at`, opis i povrijeđeni se ne
 * prepisuju. Dopuna ide u `hse_incident_updates`. Stanje, istraga, izgubljeni dani i prijava
 * inspekciji SE mijenjaju — to je život incidenta, ne njegov opis.
 */
CREATE OR REPLACE FUNCTION hse_incidents_facts_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.injured_worker_id IS DISTINCT FROM OLD.injured_worker_id
     OR NEW.reporter_worker_id IS DISTINCT FROM OLD.reporter_worker_id
  THEN
    RAISE EXCEPTION 'HSE_INCIDENT_IMMUTABLE: činjenice incidenta se dopunjuju, ne prepisuju';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER hse_incidents_facts_guard
  BEFORE UPDATE ON public.hse_incidents
  FOR EACH ROW EXECUTE FUNCTION hse_incidents_facts_guard();

/* Revizija dnevnika je zapis, ne radna verzija: UPDATE i DELETE se odbijaju. */
CREATE OR REPLACE FUNCTION site_diary_revisions_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SITE_DIARY_REVISION_IMMUTABLE: revizija dnevnika se ne mijenja ni briše';
END
$$;

CREATE TRIGGER site_diary_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.site_diary_revisions
  FOR EACH ROW EXECUTE FUNCTION site_diary_revisions_immutable();

/* Dopuna incidenta se takođe ne prepisuje — svjedok koji mijenja izjavu je nova izjava. */
CREATE OR REPLACE FUNCTION hse_incident_updates_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'HSE_INCIDENT_UPDATE_IMMUTABLE: dopuna incidenta se ne mijenja ni briše';
END
$$;

CREATE TRIGGER hse_incident_updates_immutable
  BEFORE UPDATE OR DELETE ON public.hse_incident_updates
  FOR EACH ROW EXECUTE FUNCTION hse_incident_updates_immutable();

/*
 * Stavke i zastoji se brišu SAMO dok je dnevnik nacrt. Zašto triger pored servisa: DELETE grant
 * postoji (pogrešan red u nacrtu mora moći da nestane), a zaključan dnevnik je dokaz — brisanje
 * reda iz potpisanog dnevnika bi promijenilo dokument bez traga u revizijama.
 */
CREATE OR REPLACE FUNCTION site_diary_children_draft_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
    FROM public.site_diaries
   WHERE company_id = OLD.company_id AND id = OLD.diary_id;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'DIARY_ALREADY_LOCKED: stavke i zastoji se brišu samo u nacrtu dnevnika';
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER site_diary_items_draft_guard
  BEFORE DELETE ON public.site_diary_items
  FOR EACH ROW EXECUTE FUNCTION site_diary_children_draft_guard();

CREATE TRIGGER site_diary_delays_draft_guard
  BEFORE DELETE ON public.site_diary_delays
  FOR EACH ROW EXECUTE FUNCTION site_diary_children_draft_guard();

-- ---------------------------------------------------------------- 9. RLS

ALTER TABLE public.site_diaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_diaries FORCE ROW LEVEL SECURITY;
CREATE POLICY site_diaries_tenant_isolation ON public.site_diaries
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.site_diary_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_diary_items FORCE ROW LEVEL SECURITY;
CREATE POLICY site_diary_items_tenant_isolation ON public.site_diary_items
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.site_diary_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_diary_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY site_diary_revisions_tenant_isolation ON public.site_diary_revisions
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.site_diary_delays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_diary_delays FORCE ROW LEVEL SECURITY;
CREATE POLICY site_diary_delays_tenant_isolation ON public.site_diary_delays
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.site_diary_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_diary_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY site_diary_templates_tenant_isolation ON public.site_diary_templates
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.site_diary_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_diary_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY site_diary_attachments_tenant_isolation ON public.site_diary_attachments
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.hse_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_incidents FORCE ROW LEVEL SECURITY;
CREATE POLICY hse_incidents_tenant_isolation ON public.hse_incidents
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.hse_incident_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_incident_updates FORCE ROW LEVEL SECURITY;
CREATE POLICY hse_incident_updates_tenant_isolation ON public.hse_incident_updates
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.hse_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_investigations FORCE ROW LEVEL SECURITY;
CREATE POLICY hse_investigations_tenant_isolation ON public.hse_investigations
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.hse_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY hse_actions_tenant_isolation ON public.hse_actions
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.hse_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_trainings FORCE ROW LEVEL SECURITY;
CREATE POLICY hse_trainings_tenant_isolation ON public.hse_trainings
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.hse_training_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_training_attendees FORCE ROW LEVEL SECURITY;
CREATE POLICY hse_training_attendees_tenant_isolation ON public.hse_training_attendees
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.hse_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_inspections FORCE ROW LEVEL SECURITY;
CREATE POLICY hse_inspections_tenant_isolation ON public.hse_inspections
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.hse_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hse_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY hse_attachments_tenant_isolation ON public.hse_attachments
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

-- ---------------------------------------------------------------- 10. Proširenja postojećih

/* Prilozi Modula 1 dobijaju HSE entitete; dnevnik ima svoju tabelu (mirror dnevnog pregleda). */
ALTER TABLE public.attachments DROP CONSTRAINT attachments_entity_type_check;
ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_entity_type_check
    CHECK (entity_type IN ('OBLIGATION', 'TENDER', 'MACHINE_DAILY_CHECK', 'PROJECT', 'HSE_INCIDENT'));

/* Konflikti sa terena (§1.8/34): pet novih tipova. `service_order_action` NIJE dodan u F8 jer
   ponovljeni push daje `DUPLICATE`, a ne sukob — ovdje sukob STVARNO postoji (dva šefa, isti dan). */
ALTER TABLE public.sync_conflicts DROP CONSTRAINT sync_conflicts_entity_type_check;
ALTER TABLE public.sync_conflicts
  ADD CONSTRAINT sync_conflicts_entity_type_check CHECK (
    entity_type IS NULL
    OR entity_type IN (
      'workday', 'work_entry', 'machine_work_log', 'fuel_entry',
      'haul', 'machine_daily_check', 'machine_fault',
      'site_diary', 'site_diary_item', 'hse_incident', 'hse_action', 'hse_training'
    )
  );

/* `HSE_REPORT` — obaveza s rokom za prijavu inspekciji (§1.3/16). Podsjetnici `{3,1}` jer je rok
   zakonski kratak; `requires_attachment = true` jer bez prijave nema dokaza da je prijavljeno. */
CREATE OR REPLACE FUNCTION seed_obligation_types(target_company TEXT)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO obligation_types (id, company_id, code, label, entity_kind, default_reminder_days,
                                requires_attachment, sort_order, blocks_assignment)
  SELECT * FROM (VALUES
    (target_company || '_obt_medical',        target_company, 'MEDICAL',          'Ljekarski pregled',           'WORKER',  '{60,30,15,7}'::integer[], true,  10, true),
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
    (target_company || '_obt_tender_docs',    target_company, 'TENDER_DOCS',      'Tenderska dokumentacija',     'TENDER',  '{14,7,3,1}',   true,  10, false),
    (target_company || '_obt_tender_deadline', target_company, 'TENDER_DEADLINE', 'Rok za predaju ponude',       'TENDER',  '{14,7,3,1}',   false, 20, false),
    (target_company || '_obt_tender_questions', target_company, 'TENDER_QUESTIONS','Rok za pitanja naručiocu',   'TENDER',  '{14,7,3,1}',   false, 30, false),
    /* F9: prijava ozljede/neposredne opasnosti inspekciji — zakonski rok je kratak. */
    (target_company || '_obt_hse_report',     target_company, 'HSE_REPORT',       'Prijava inspekciji rada',     'COMPANY', '{3,1}',        true,  50, false)
  ) AS t(id, company_id, code, label, entity_kind, default_reminder_days, requires_attachment, sort_order, blocks_assignment)
  ON CONFLICT (company_id, code) DO NOTHING;
$$;

/* Postojeće firme: `HSE_REPORT` odmah, isti obrazac kao TENDER tipovi u F7. */
INSERT INTO public.obligation_types (
  id, company_id, code, label, entity_kind, default_reminder_days,
  requires_attachment, sort_order, blocks_assignment
)
SELECT c.id || '_obt_hse_report', c.id, 'HSE_REPORT', 'Prijava inspekciji rada', 'COMPANY',
       '{3,1}', true, 50, false
FROM public.companies c
ON CONFLICT (company_id, code) DO NOTHING;

/*
 * Grantovi NIJESU ovdje — oni su u `bootstrap/grants.sql` (F8 je to platila greškom: grant u
 * migraciji poništi `REVOKE ALL` iz bootstrapa, pa se vidi tek kad se baza digne iznova).
 */

INSERT INTO public.schema_migrations (name)
VALUES ('20261126100000_f9_1_dnevnik_hse')
ON CONFLICT DO NOTHING;

COMMIT;
