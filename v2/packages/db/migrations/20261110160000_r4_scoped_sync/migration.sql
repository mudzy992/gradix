-- R4a-1 korak 5: item-idempotent cursor reservations and removal of the R0 notes sync.
--
-- A reservation key is a SHA-256 of (tenant, actor, local_id), not request content. If a
-- business transaction fails and its 5-minute slot is later skipped, the same logical item gets
-- a fresh slot generation; it never reanimates a skipped slot or leaves a permanent cursor hole.
BEGIN;

ALTER TABLE public.work_entries
  ADD COLUMN review_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD CONSTRAINT work_entries_review_flags_check CHECK (
    review_flags <@ ARRAY[
      'UNKNOWN_END',
      'DEVICE_CLOCK_SKEW',
      'PROJECT_INACTIVE',
      'PROJECT_OUTSIDE_DATES',
      'PROJECT_NOT_ASSIGNED_ON_WORK_DATE',
      'MACHINE_INACTIVE',
      'MACHINE_NOT_ASSIGNED_ON_WORK_DATE'
    ]::TEXT[]
  );

CREATE OR REPLACE FUNCTION public.sync_cursor_reserve_item(
  p_company_id TEXT,
  p_idempotency_key TEXT,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (cursor_seq BIGINT, reservation_token TEXT, already_committed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $reserve_item$
DECLARE
  v_next_seq BIGINT;
  v_existing_seq BIGINT;
  v_existing_status TEXT;
  v_existing_lease TIMESTAMPTZ;
  v_existing_token TEXT;
  v_generation BIGINT;
  v_prefix TEXT;
  v_new_token TEXT;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM nullif(current_setting('app.company_id', true), '') THEN
    RAISE EXCEPTION 'SYNC_CURSOR_TENANT_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'SYNC_CURSOR_IDEMPOTENCY_KEY_INVALID'
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 900 THEN
    RAISE EXCEPTION 'SYNC_CURSOR_LEASE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_prefix := 'r4:' || p_idempotency_key || ':';
  INSERT INTO public.sync_cursor_allocators (company_id)
  VALUES (p_company_id)
  ON CONFLICT (company_id) DO NOTHING;

  -- Sequence and slot are allocated together under this short allocator transaction.
  SELECT allocator.next_seq
    INTO v_next_seq
    FROM public.sync_cursor_allocators AS allocator
   WHERE allocator.company_id = p_company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SYNC_CURSOR_ALLOCATOR_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT slot.cursor_seq, slot.status, slot.lease_until, slot.reservation_token
    INTO v_existing_seq, v_existing_status, v_existing_lease, v_existing_token
    FROM public.sync_cursor_slots AS slot
   WHERE slot.company_id = p_company_id
     AND left(slot.reservation_token, length(v_prefix)) = v_prefix
   ORDER BY slot.cursor_seq DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing_status = 'COMMITTED' THEN
      RETURN QUERY SELECT v_existing_seq, v_existing_token, true;
      RETURN;
    END IF;
    IF v_existing_status = 'PENDING' AND v_existing_lease > clock_timestamp() THEN
      RETURN QUERY SELECT v_existing_seq, v_existing_token, false;
      RETURN;
    END IF;
    IF v_existing_status = 'PENDING' THEN
      -- The row lock proves there is no writer still publishing this slot.
      UPDATE public.sync_cursor_slots AS slot
         SET status = 'SKIPPED', skipped_at = clock_timestamp()
       WHERE slot.company_id = p_company_id AND slot.cursor_seq = v_existing_seq
         AND slot.status = 'PENDING';
    END IF;
  END IF;

  SELECT (COALESCE(MAX(substring(slot.reservation_token FROM length(v_prefix) + 1)::NUMERIC), 0) + 1)::BIGINT
    INTO v_generation
    FROM public.sync_cursor_slots AS slot
   WHERE slot.company_id = p_company_id
     AND left(slot.reservation_token, length(v_prefix)) = v_prefix
     AND substring(slot.reservation_token FROM length(v_prefix) + 1) ~ '^[1-9][0-9]{0,17}$';
  v_new_token := v_prefix || v_generation::TEXT;
  v_now := clock_timestamp();

  UPDATE public.sync_cursor_allocators AS allocator
     SET next_seq = v_next_seq + 1,
         updated_at = v_now
   WHERE allocator.company_id = p_company_id;

  INSERT INTO public.sync_cursor_slots (
    company_id, cursor_seq, reservation_token, status, reserved_at, lease_until
  ) VALUES (
    p_company_id, v_next_seq, v_new_token, 'PENDING', v_now,
    v_now + make_interval(secs => p_lease_seconds::DOUBLE PRECISION)
  );

  RETURN QUERY SELECT v_next_seq, v_new_token, false;
END;
$reserve_item$;

CREATE OR REPLACE FUNCTION public.sync_cursor_skip(
  p_company_id TEXT,
  p_cursor_seq BIGINT,
  p_reservation_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $skip$
DECLARE
  v_status TEXT;
  v_token TEXT;
BEGIN
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM nullif(current_setting('app.company_id', true), '') THEN
    RAISE EXCEPTION 'SYNC_CURSOR_TENANT_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
  IF p_cursor_seq IS NULL OR p_cursor_seq <= 0 OR p_reservation_token IS NULL THEN
    RAISE EXCEPTION 'SYNC_CURSOR_SKIP_ARGUMENT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT slot.status, slot.reservation_token
    INTO v_status, v_token
    FROM public.sync_cursor_slots AS slot
   WHERE slot.company_id = p_company_id AND slot.cursor_seq = p_cursor_seq
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SYNC_CURSOR_SLOT_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_token IS DISTINCT FROM p_reservation_token THEN
    RAISE EXCEPTION 'SYNC_CURSOR_RESERVATION_TOKEN_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
  IF v_status = 'COMMITTED' THEN
    RETURN false;
  END IF;
  IF v_status = 'SKIPPED' THEN
    RETURN true;
  END IF;

  UPDATE public.sync_cursor_slots AS slot
     SET status = 'SKIPPED', skipped_at = clock_timestamp()
   WHERE slot.company_id = p_company_id AND slot.cursor_seq = p_cursor_seq
     AND slot.status = 'PENDING';
  RETURN true;
END;
$skip$;

REVOKE ALL ON FUNCTION public.sync_cursor_reserve_item(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_cursor_skip(TEXT, BIGINT, TEXT) FROM PUBLIC;

-- Owner confirmed R0 note data is not real data. R4 has a single cursor/workday protocol.
DROP TABLE IF EXISTS public.sync_items;

INSERT INTO public.schema_migrations (name)
VALUES ('20261110160000_r4_scoped_sync')
ON CONFLICT DO NOTHING;
COMMIT;
