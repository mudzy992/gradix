-- R4 popravka (staging, 2026-11-07): sync_cursor_pull je na vec primijenjenim bazama ostao
-- u prvoj verziji, gdje ne-kvalifikovani `cursor_floor` u SELECT-u iz sync_cursor_allocators
-- PL/pgSQL prijavljuje kao "column reference \"cursor_floor\" is ambiguous" (sudar s izlaznim
-- parametrom funkcije), pa svaki sync pull pada. Prvobitna migracija se NE dira (primijenjena
-- je po imenu, bez checksuma) — ova nova migracija samo zamjenjuje definiciju funkcije
-- ispravnom, kvalifikovanom verzijom. Na svjezim bazama je rezultat isti.
BEGIN;

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

  SELECT allocator.next_seq, allocator.cursor_floor
    INTO v_next_seq, v_floor
    FROM public.sync_cursor_allocators AS allocator
   WHERE allocator.company_id = p_company_id;
  IF FOUND THEN
    v_head := v_next_seq - 1;
  ELSE
    -- SELECT INTO clears targets on no row, so restore the empty-tenant floor explicitly.
    v_next_seq := 1;
    v_floor := 0;
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

INSERT INTO public.schema_migrations (name)
VALUES ('20261110170000_r4_sync_pull_floor_fix')
ON CONFLICT DO NOTHING;
COMMIT;
