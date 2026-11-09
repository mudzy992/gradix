-- R4 korak 2: transakcijski cursor bez rupa pri obrnutom redoslijedu commita.
--
-- Rezervacija je kratka zasebna transakcija: zaključava samo allocator, povećava next_seq i
-- dodaje PENDING slot. Poslovna transakcija kasnije zaključava svoj slot, upisuje događaj i
-- označava slot COMMITTED. Pull ne prelazi preko prvog PENDING slota; SKIPPED slot je siguran
-- tek kada ga sweeper zaključa nakon isteka lease-a.
BEGIN;

CREATE TABLE public.sync_cursor_allocators (
  company_id   TEXT PRIMARY KEY,
  next_seq     BIGINT NOT NULL DEFAULT 1 CHECK (next_seq > 0),
  cursor_floor BIGINT NOT NULL DEFAULT 0 CHECK (cursor_floor >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sync_cursor_allocators_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT sync_cursor_allocators_floor_check CHECK (cursor_floor < next_seq)
);

CREATE TABLE public.sync_cursor_slots (
  company_id         TEXT NOT NULL,
  cursor_seq         BIGINT NOT NULL CHECK (cursor_seq > 0),
  reservation_token  TEXT NOT NULL CHECK (length(btrim(reservation_token)) BETWEEN 1 AND 128),
  status              TEXT NOT NULL CHECK (status IN ('PENDING', 'COMMITTED', 'SKIPPED')),
  reserved_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_until         TIMESTAMPTZ NOT NULL,
  committed_at        TIMESTAMPTZ,
  skipped_at          TIMESTAMPTZ,
  event_id            TEXT,
  request_hash        TEXT,
  PRIMARY KEY (company_id, cursor_seq),
  CONSTRAINT sync_cursor_slots_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  CONSTRAINT sync_cursor_slots_reservation_unique UNIQUE (company_id, reservation_token),
  CONSTRAINT sync_cursor_slots_event_unique UNIQUE (company_id, event_id),
  CONSTRAINT sync_cursor_slots_state_check CHECK (
    (status = 'PENDING' AND committed_at IS NULL AND skipped_at IS NULL
      AND event_id IS NULL AND request_hash IS NULL)
    OR
    (status = 'COMMITTED' AND committed_at IS NOT NULL AND skipped_at IS NULL
      AND event_id IS NOT NULL AND request_hash IS NOT NULL
      AND request_hash ~ '^[0-9a-f]{64}$')
    OR
    (status = 'SKIPPED' AND committed_at IS NULL AND skipped_at IS NOT NULL
      AND event_id IS NULL AND request_hash IS NULL)
  )
);
CREATE INDEX sync_cursor_slots_pending_lease_idx
  ON public.sync_cursor_slots (company_id, lease_until, cursor_seq)
  WHERE status = 'PENDING';

CREATE TABLE public.sync_change_log (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  cursor_seq     BIGINT NOT NULL,
  entity_type    TEXT NOT NULL CHECK (length(btrim(entity_type)) BETWEEN 1 AND 100),
  entity_id      TEXT NOT NULL CHECK (length(btrim(entity_id)) BETWEEN 1 AND 128),
  entity_version BIGINT NOT NULL CHECK (entity_version > 0),
  request_hash   TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  payload        JSONB,
  is_tombstone   BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + interval '90 days'),
  CONSTRAINT sync_change_log_slot_unique UNIQUE (company_id, cursor_seq),
  CONSTRAINT sync_change_log_slot_fk
    FOREIGN KEY (company_id, cursor_seq)
    REFERENCES public.sync_cursor_slots(company_id, cursor_seq) ON DELETE RESTRICT,
  CONSTRAINT sync_change_log_payload_check CHECK (
    (is_tombstone AND payload IS NULL) OR (NOT is_tombstone AND payload IS NOT NULL)
  )
);
CREATE INDEX sync_change_log_expiry_idx
  ON public.sync_change_log (company_id, expires_at, cursor_seq);

-- Cursor internals imaju FORCE RLS i nisu direktno čitljivi/pisivi od gradix_app. Funkcije ispod
-- su jedini app pozivni put i provjeravaju da je eksplicitni tenant jednak SET LOCAL kontekstu.
ALTER TABLE public.sync_cursor_allocators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_cursor_allocators FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_cursor_allocators_tenant_isolation ON public.sync_cursor_allocators
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.sync_cursor_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_cursor_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_cursor_slots_tenant_isolation ON public.sync_cursor_slots
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

ALTER TABLE public.sync_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_change_log FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_change_log_tenant_isolation ON public.sync_change_log
  USING (company_id = nullif(current_setting('app.company_id', true), ''))
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), ''));

CREATE OR REPLACE FUNCTION public.sync_cursor_reserve(
  p_company_id TEXT,
  p_reservation_token TEXT,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $reserve$
DECLARE
  v_next_seq BIGINT;
  v_existing_seq BIGINT;
  v_existing_status TEXT;
  v_existing_lease TIMESTAMPTZ;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM nullif(current_setting('app.company_id', true), '') THEN
    RAISE EXCEPTION 'SYNC_CURSOR_TENANT_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
  IF p_reservation_token IS NULL OR length(btrim(p_reservation_token)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'SYNC_CURSOR_RESERVATION_TOKEN_INVALID'
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 900 THEN
    RAISE EXCEPTION 'SYNC_CURSOR_LEASE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sync_cursor_allocators (company_id)
  VALUES (p_company_id)
  ON CONFLICT (company_id) DO NOTHING;

  -- Jedan kratki allocator lock serijalizuje samo rezervacije, nikad poslovne upise.
  SELECT next_seq INTO v_next_seq
    FROM public.sync_cursor_allocators
   WHERE company_id = p_company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SYNC_CURSOR_ALLOCATOR_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  -- Provjera je poslije allocator locka, pa dva istovremena retry-ja istog tokena ne alociraju
  -- dva slota. Postojeći COMMITTED token je idempotentan; SKIPPED se nikad ne oživljava.
  SELECT cursor_seq, status, lease_until
    INTO v_existing_seq, v_existing_status, v_existing_lease
    FROM public.sync_cursor_slots
   WHERE company_id = p_company_id AND reservation_token = p_reservation_token
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing_status = 'SKIPPED' THEN
      RAISE EXCEPTION 'SYNC_CURSOR_RESERVATION_SKIPPED'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_existing_status = 'PENDING' AND v_existing_lease <= clock_timestamp() THEN
      RAISE EXCEPTION 'SYNC_CURSOR_RESERVATION_EXPIRED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing_seq;
  END IF;

  v_now := clock_timestamp();
  UPDATE public.sync_cursor_allocators
     SET next_seq = v_next_seq + 1,
         updated_at = v_now
   WHERE company_id = p_company_id;

  INSERT INTO public.sync_cursor_slots (
    company_id, cursor_seq, reservation_token, status, reserved_at, lease_until
  ) VALUES (
    p_company_id, v_next_seq, p_reservation_token, 'PENDING', v_now,
    v_now + make_interval(secs => p_lease_seconds::double precision)
  );

  RETURN v_next_seq;
END;
$reserve$;

CREATE OR REPLACE FUNCTION public.sync_cursor_publish(
  p_company_id TEXT,
  p_cursor_seq BIGINT,
  p_reservation_token TEXT,
  p_request_hash TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_entity_version BIGINT,
  p_payload JSONB,
  p_is_tombstone BOOLEAN DEFAULT false
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $publish$
DECLARE
  v_status TEXT;
  v_token TEXT;
  v_lease_until TIMESTAMPTZ;
  v_event_id TEXT;
  v_request_hash TEXT;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM nullif(current_setting('app.company_id', true), '') THEN
    RAISE EXCEPTION 'SYNC_CURSOR_TENANT_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
  IF p_cursor_seq IS NULL OR p_cursor_seq <= 0
     OR p_reservation_token IS NULL
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_entity_type IS NULL OR length(btrim(p_entity_type)) NOT BETWEEN 1 AND 100
     OR p_entity_id IS NULL OR length(btrim(p_entity_id)) NOT BETWEEN 1 AND 128
     OR p_entity_version IS NULL OR p_entity_version <= 0
     OR p_is_tombstone IS NULL
     OR (p_is_tombstone AND p_payload IS NOT NULL)
     OR (NOT p_is_tombstone AND p_payload IS NULL) THEN
    RAISE EXCEPTION 'SYNC_CURSOR_EVENT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- Ovaj red-lock traje do commita/rollbacka poslovne transakcije. Sweeper koristi isti lock,
  -- pa ne može preskočiti slot dok writer još radi.
  SELECT status, reservation_token, lease_until, event_id, request_hash
    INTO v_status, v_token, v_lease_until, v_event_id, v_request_hash
    FROM public.sync_cursor_slots
   WHERE company_id = p_company_id AND cursor_seq = p_cursor_seq
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SYNC_CURSOR_SLOT_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_token IS DISTINCT FROM p_reservation_token THEN
    RAISE EXCEPTION 'SYNC_CURSOR_RESERVATION_TOKEN_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
  IF v_status = 'SKIPPED' THEN
    RAISE EXCEPTION 'SYNC_CURSOR_RESERVATION_SKIPPED'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'COMMITTED' THEN
    IF v_request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'SYNC_CURSOR_RETRY_PAYLOAD_MISMATCH'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_event_id;
  END IF;
  IF v_lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'SYNC_CURSOR_RESERVATION_EXPIRED'
      USING ERRCODE = 'P0001';
  END IF;

  v_event_id := gen_random_uuid()::text;
  v_now := clock_timestamp();
  INSERT INTO public.sync_change_log (
    id, company_id, cursor_seq, entity_type, entity_id, entity_version,
    request_hash, payload, is_tombstone, created_at, expires_at
  ) VALUES (
    v_event_id, p_company_id, p_cursor_seq, p_entity_type, p_entity_id, p_entity_version,
    p_request_hash, p_payload, p_is_tombstone, v_now, v_now + interval '90 days'
  );

  UPDATE public.sync_cursor_slots
     SET status = 'COMMITTED', committed_at = v_now,
         event_id = v_event_id, request_hash = p_request_hash
   WHERE company_id = p_company_id AND cursor_seq = p_cursor_seq;

  RETURN v_event_id;
END;
$publish$;

CREATE OR REPLACE FUNCTION public.sync_cursor_sweep(
  p_company_id TEXT,
  p_limit INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $sweep$
DECLARE
  v_skipped INTEGER;
BEGIN
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM nullif(current_setting('app.company_id', true), '') THEN
    RAISE EXCEPTION 'SYNC_CURSOR_TENANT_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'SYNC_CURSOR_SWEEP_LIMIT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  WITH expired AS (
    SELECT cursor_seq
      FROM public.sync_cursor_slots
     WHERE company_id = p_company_id
       AND status = 'PENDING'
       AND lease_until <= clock_timestamp()
     ORDER BY cursor_seq
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sync_cursor_slots slot
     SET status = 'SKIPPED', skipped_at = clock_timestamp()
    FROM expired
   WHERE slot.company_id = p_company_id
     AND slot.cursor_seq = expired.cursor_seq
     AND slot.status = 'PENDING';
  GET DIAGNOSTICS v_skipped = ROW_COUNT;
  RETURN v_skipped;
END;
$sweep$;

CREATE OR REPLACE FUNCTION public.sync_cursor_pull(
  p_company_id TEXT,
  p_after_cursor BIGINT,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (events JSONB, next_cursor BIGINT, cursor_floor BIGINT, has_more BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $pull$
DECLARE
  v_next_seq BIGINT := 1;
  v_floor BIGINT := 0;
  v_head BIGINT := 0;
  v_first_pending BIGINT;
  v_safe_frontier BIGINT := 0;
  v_page JSONB := '[]'::jsonb;
  v_page_rows INTEGER := 0;
  v_last_page_seq BIGINT;
  v_next_cursor BIGINT := 0;
  v_has_more BOOLEAN := false;
BEGIN
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM nullif(current_setting('app.company_id', true), '') THEN
    RAISE EXCEPTION 'SYNC_CURSOR_TENANT_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
  IF p_after_cursor IS NULL OR p_after_cursor < 0
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'SYNC_CURSOR_QUERY_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT next_seq, cursor_floor
    INTO v_next_seq, v_floor
    FROM public.sync_cursor_allocators
   WHERE company_id = p_company_id;
  IF FOUND THEN
    v_head := v_next_seq - 1;
  END IF;
  IF p_after_cursor < v_floor THEN
    RAISE EXCEPTION 'SYNC_CURSOR_EXPIRED'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_after_cursor > v_head THEN
    RAISE EXCEPTION 'SYNC_CURSOR_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT min(cursor_seq)
    INTO v_first_pending
    FROM public.sync_cursor_slots
   WHERE company_id = p_company_id AND status = 'PENDING';
  IF v_first_pending IS NOT NULL AND v_first_pending <= p_after_cursor THEN
    -- Korektan cursor nikad nije prešao PENDING slot. Fail closed umjesto da sakrije rupu.
    RAISE EXCEPTION 'SYNC_CURSOR_CROSSES_PENDING_SLOT'
      USING ERRCODE = '22023';
  END IF;

  v_safe_frontier := v_head;
  IF v_first_pending IS NOT NULL THEN
    v_safe_frontier := LEAST(v_safe_frontier, v_first_pending - 1);
  END IF;
  v_safe_frontier := GREATEST(v_safe_frontier, p_after_cursor);

  WITH page AS (
    SELECT selected.*, row_number() OVER (ORDER BY selected.cursor_seq) AS page_no
      FROM (
        SELECT id, cursor_seq, entity_type, entity_id, entity_version,
               payload, is_tombstone, created_at
          FROM public.sync_change_log
         WHERE company_id = p_company_id
           AND cursor_seq > p_after_cursor
           AND cursor_seq <= v_safe_frontier
         ORDER BY cursor_seq
         LIMIT p_limit + 1
      ) AS selected
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id', id,
               'cursorSeq', cursor_seq::text,
               'entityType', entity_type,
               'entityId', entity_id,
               'version', entity_version,
               'payload', payload,
               'tombstone', is_tombstone,
               'createdAt', created_at
             ) ORDER BY cursor_seq
           ) FILTER (WHERE page_no <= p_limit),
           '[]'::jsonb
         ),
         count(*)::integer,
         max(cursor_seq) FILTER (WHERE page_no <= p_limit)
    INTO v_page, v_page_rows, v_last_page_seq
    FROM page;

  IF v_page_rows > p_limit THEN
    v_next_cursor := COALESCE(v_last_page_seq, p_after_cursor);
    v_has_more := true;
  ELSE
    v_next_cursor := v_safe_frontier;
    v_has_more := v_safe_frontier < v_head;
  END IF;

  RETURN QUERY SELECT v_page, v_next_cursor, v_floor, v_has_more;
END;
$pull$;

REVOKE ALL ON FUNCTION public.sync_cursor_reserve(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_cursor_publish(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, BIGINT, JSONB, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_cursor_sweep(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_cursor_pull(TEXT, BIGINT, INTEGER) FROM PUBLIC;

INSERT INTO public.schema_migrations (name)
VALUES ('20261110140000_r4_sync_cursor')
ON CONFLICT DO NOTHING;
COMMIT;
