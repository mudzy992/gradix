/** GET /api/sync/pull?cursor=<opaque>&limit=<n> — scoped R4 change feed. */
import type { NextRequest } from "next/server";
import type { SyncPullEvent } from "@gradix/contracts";
import { R4_SYNC_PULL_MAX_ITEMS, isValidCursorSequence } from "@gradix/domain";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { decodeSyncCursor, encodeSyncCursor, SyncCursorError } from "@/server/sync-cursor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 100;

type DbEvent = {
  id: string;
  cursorSeq: string;
  entityType: "workday" | "work_entry" | "sync_conflict";
  entityId: string;
  version: number;
  payload: Record<string, unknown> | null;
  tombstone: boolean;
  createdAt: string;
};

function isDbEvent(value: unknown): value is DbEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<DbEvent>;
  return typeof event.id === "string"
    && typeof event.cursorSeq === "string"
    && isValidCursorSequence(event.cursorSeq)
    && ["workday", "work_entry", "sync_conflict"].includes(String(event.entityType))
    && typeof event.entityId === "string"
    && Number.isInteger(event.version)
    && (event.payload === null || (!!event.payload && typeof event.payload === "object"))
    && typeof event.tombstone === "boolean"
    && typeof event.createdAt === "string";
}

function messageIncludes(error: unknown, token: string): boolean {
  return error instanceof Error && error.message.includes(token);
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some((key) => key !== "cursor" && key !== "limit")) {
      return fail("SYNC_CURSOR_INVALID", "Podržani su samo cursor i limit; R0 since watermark nije podržan.");
    }
    if (params.getAll("cursor").length > 1 || params.getAll("limit").length > 1) {
      return fail("SYNC_CURSOR_INVALID", "Sync cursor ili limit nije ispravan.");
    }

    const limitRaw = params.get("limit");
    const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > R4_SYNC_PULL_MAX_ITEMS) {
      return fail("SYNC_CURSOR_INVALID", "Limit mora biti između 1 i 200.");
    }
    let cursor: string;
    try {
      cursor = decodeSyncCursor(params.get("cursor"), ctx.companyId).sequence;
    } catch (error) {
      if (error instanceof SyncCursorError) {
        return fail("SYNC_CURSOR_INVALID", "Sync cursor nije ispravan za ovu firmu.");
      }
      throw error;
    }

    const officeRead = ctx.roles.includes("OWNER") || ctx.roles.includes("ADMIN");
    const isWorker = ctx.roles.includes("WORKER");
    if (!officeRead && !isWorker) {
      return fail("FORBIDDEN", "Ovaj nalog nema pristup radnom sync toku.");
    }

    const pool = await getVerifiedPool();
    const result = await withCompany(pool, ctx.companyId, async (client) => {
      let workerId: string | null = null;
      if (!officeRead) {
        const worker = await client.query<{ id: string }>(
          `SELECT id FROM public.workers
            WHERE company_id = $1 AND user_id = $2 AND is_active`,
          [ctx.companyId, ctx.userId],
        );
        workerId = worker.rows[0]?.id ?? null;
        if (!workerId) return { forbidden: true as const };
      }

      // Lease expiry alone cannot prove a writer is gone; this definer function takes each
      // expired slot's row lock with SKIP LOCKED before marking it SKIPPED.
      await client.query("SELECT public.sync_cursor_sweep($1, 100)", [ctx.companyId]);
      const pulled = await client.query<{
        events: unknown;
        next_cursor: string;
        cursor_floor: string;
        has_more: boolean;
      }>(
        `SELECT events, next_cursor::text, cursor_floor::text, has_more
           FROM public.sync_cursor_pull($1, $2::bigint, $3)`,
        [ctx.companyId, cursor, limit],
      );
      const page = pulled.rows[0];
      if (!page || !Array.isArray(page.events) || !isValidCursorSequence(page.next_cursor)
          || !isValidCursorSequence(page.cursor_floor)) {
        throw new Error("SYNC_PULL_RESPONSE_INVALID");
      }
      const events = page.events.filter(isDbEvent);
      if (events.length !== page.events.length) throw new Error("SYNC_PULL_RESPONSE_INVALID");

      let visible: DbEvent[] = events;
      if (!officeRead && workerId) {
        const workdayIds = events.filter((event) => event.entityType === "workday").map((event) => event.entityId);
        const workEntryIds = events.filter((event) => event.entityType === "work_entry").map((event) => event.entityId);
        const conflictIds = events.filter((event) => event.entityType === "sync_conflict").map((event) => event.entityId);
        const [days, entries, conflicts] = await Promise.all([
          workdayIds.length ? client.query<{ id: string }>(
            "SELECT id FROM public.workdays WHERE company_id = $1 AND worker_id = $2 AND id = ANY($3::text[])",
            [ctx.companyId, workerId, workdayIds],
          ) : Promise.resolve({ rows: [] as { id: string }[] }),
          workEntryIds.length ? client.query<{ id: string }>(
            "SELECT id FROM public.work_entries WHERE company_id = $1 AND worker_id = $2 AND id = ANY($3::text[])",
            [ctx.companyId, workerId, workEntryIds],
          ) : Promise.resolve({ rows: [] as { id: string }[] }),
          conflictIds.length ? client.query<{ id: string }>(
            "SELECT id FROM public.sync_conflicts WHERE company_id = $1 AND actor_id = $2 AND id = ANY($3::text[])",
            [ctx.companyId, ctx.userId, conflictIds],
          ) : Promise.resolve({ rows: [] as { id: string }[] }),
        ]);
        const allowed = new Set([
          ...days.rows.map((row) => `workday:${row.id}`),
          ...entries.rows.map((row) => `work_entry:${row.id}`),
          ...conflicts.rows.map((row) => `sync_conflict:${row.id}`),
        ]);
        visible = events.filter((event) => allowed.has(`${event.entityType}:${event.entityId}`));
      }

      return {
        forbidden: false as const,
        events: visible.map((event): SyncPullEvent => ({
          id: event.id,
          cursorSeq: event.cursorSeq,
          entityType: event.entityType,
          entityId: event.entityId,
          entityVersion: event.version,
          payload: event.payload,
          tombstone: event.tombstone,
          createdAt: event.createdAt,
        })),
        cursor: encodeSyncCursor(ctx.companyId, page.next_cursor),
        cursorFloor: encodeSyncCursor(ctx.companyId, page.cursor_floor),
        hasMore: page.has_more,
      };
    });

    if (result.forbidden) return fail("FORBIDDEN", "Ovaj nalog nema aktivnu vezu s radnikom.");
    return ok(result);
  } catch (error) {
    if (messageIncludes(error, "SYNC_CURSOR_EXPIRED")) {
      return fail("SYNC_CURSOR_EXPIRED", "Lokalni cursor je istekao; potrebno je obnoviti serverski keš.");
    }
    if (messageIncludes(error, "SYNC_CURSOR_INVALID") || messageIncludes(error, "SYNC_CURSOR_CROSSES_PENDING_SLOT")) {
      return fail("SYNC_CURSOR_INVALID", "Sync cursor nije ispravan.");
    }
    return internal(error, "sync.pull");
  }
}
