/** GET /api/sync/pull?cursor=<opaque>&limit=<n> — scoped R4 change feed. */
import type { NextRequest } from "next/server";
import type { SyncPullEvent } from "@gradix/contracts";
import { R4_SYNC_PULL_MAX_ITEMS, isValidCursorSequence } from "@gradix/domain";
import { foremanVisibleR4EventIds, sanitizeForemanPullPayload } from "@/server/r4-foreman-pull";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { activityScope, equipmentScope } from "@/server/equipment-scope";
import { decodeSyncCursor, encodeSyncCursor, SyncCursorError } from "@/server/sync-cursor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 100;

/**
 * F9 — dnevnik i HSE putuju istim feedom kao radni dani (spec 10 §1.8). Telefon šefa mora dobiti
 * i dnevnik i HSE događaje, inače offline ekran nikad ne vidi šta je ured promijenio.
 */
const F9_PULL_TYPES = ["site_diary", "hse_incident", "hse_action", "hse_training"] as const;

type DbEvent = {
  id: string;
  cursorSeq: string;
  entityType: "workday" | "work_entry" | "sync_conflict" | "machine_fault" | "haul" | "machine_daily_check" | (typeof F9_PULL_TYPES)[number];
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
    && ["workday", "work_entry", "sync_conflict", "machine_fault", "haul", "machine_daily_check", ...F9_PULL_TYPES].includes(String(event.entityType))
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
    // Terenske role koriste isti ograničeni feed vlastitog radnika; nisu šefov opseg.
    const isWorker = ctx.roles.some((role) => ["WORKER", "DRIVER", "MACHINE_OPERATOR", "MECHANIC"].includes(role));
    const isForeman = ctx.roles.includes("SITE_SUPERVISOR");
    if (!officeRead && !isWorker && !isForeman) {
      return fail("FORBIDDEN", "Ovaj nalog nema pristup radnom sync toku.");
    }

    const pool = await getVerifiedPool();
    const result = await withCompany(pool, ctx.companyId, async (client) => {
      let workerId: string | null = null;
      let foremanWorkerId: string | null = null;
      if (!officeRead && isWorker) {
        const worker = await client.query<{ id: string }>(
          `SELECT id FROM public.workers
            WHERE company_id = $1 AND user_id = $2 AND is_active`,
          [ctx.companyId, ctx.userId],
        );
        workerId = worker.rows[0]?.id ?? null;
      }
      if (!officeRead && isForeman) {
        const worker = await client.query<{ id: string }>(
          `SELECT id FROM public.workers
            WHERE company_id = $1 AND user_id = $2 AND is_active`,
          [ctx.companyId, ctx.userId],
        );
        foremanWorkerId = worker.rows[0]?.id ?? null;
      }
      if (!officeRead && !workerId && !foremanWorkerId) return { forbidden: true as const };

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
      if (!officeRead) {
        const allowedEntityKeys = new Set<string>();
        if (workerId) {
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
              // Autor primljenog unosa ILI radnik čiji je server-unos u sukobu:
              // ishod razrješenja moraju vidjeti obje strane, ne samo pošiljalac.
              `SELECT id FROM public.sync_conflicts
                WHERE company_id = $1 AND id = ANY($3::text[])
                  AND (actor_id = $2 OR work_entry_id IN (
                    SELECT id FROM public.work_entries WHERE company_id = $1 AND worker_id = $4
                  ))`,
              [ctx.companyId, ctx.userId, conflictIds, workerId],
            ) : Promise.resolve({ rows: [] as { id: string }[] }),
          ]);
          for (const row of days.rows) allowedEntityKeys.add(`workday:${row.id}`);
          for (const row of entries.rows) allowedEntityKeys.add(`work_entry:${row.id}`);
          for (const row of conflicts.rows) allowedEntityKeys.add(`sync_conflict:${row.id}`);
        }
        const allowedEventIds = new Set(
          events.filter((event) => allowedEntityKeys.has(`${event.entityType}:${event.entityId}`))
            .map((event) => event.id),
        );
        /* F9 događaji su na nivou firme: `hse.view` ima svaka rola, a dnevnik vidi šef gradilišta.
           Ne prolaze kroz opseg radnika jer ne pripadaju jednom radniku. */
        const f9Ids = new Set(
          events.filter((event) => (F9_PULL_TYPES as readonly string[]).includes(event.entityType))
            .map((event) => event.id),
        );
        if (isForeman) for (const id of f9Ids) allowedEventIds.add(id);
        for (const event of events) if (["machine_fault", "haul", "machine_daily_check"].includes(event.entityType)) allowedEventIds.add(event.id);
        if (foremanWorkerId) {
          const scopedIds = await foremanVisibleR4EventIds(
            client, ctx.companyId, foremanWorkerId, ctx.userId, events,
          );
          for (const eventId of scopedIds) allowedEventIds.add(eventId);
        }
        visible = events.filter((event) => allowedEventIds.has(event.id));
      }

      // Diary events are project-wide data, including for OWNER/ADMIN with a restricted scope.
      // Resolve against the authoritative row, not the client-controlled event payload.
      const diaryIds = visible.filter((event) => event.entityType === "site_diary").map((event) => event.entityId);
      const allowedDiaries = new Set<string>();
      if (diaryIds.length && can(ctx.roles, "diary.view") && ctx.scope !== "SELF") {
        const rows = await client.query<{ id: string }>(
          `SELECT id FROM public.site_diaries WHERE company_id = $1 AND id = ANY($2::text[])
             AND ($3::boolean OR project_id = ANY($4::text[]))`,
          [ctx.companyId, diaryIds, ctx.scope === "COMPANY", ctx.projectIds ?? []],
        );
        for (const row of rows.rows) allowedDiaries.add(row.id);
      }
      visible = visible.filter((event) => event.entityType !== "site_diary" || allowedDiaries.has(event.entityId));
      const faultIds = visible.filter((event) => event.entityType === "machine_fault").map((event) => event.entityId);
      const allowedFaults = new Set<string>();
      if (faultIds.length && can(ctx.roles, "machines.fault.view")) {
        const values: unknown[] = [ctx.companyId, faultIds];
        const predicate = equipmentScope(ctx, values, "f", "fault");
        const fieldOnly = ctx.roles.some((role) => ["MACHINE_OPERATOR", "MECHANIC"].includes(role))
          && !ctx.roles.some((role) => ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"].includes(role));
        if (fieldOnly) values.push(ctx.userId);
        const fieldPredicate = fieldOnly ? `AND f.reporter_worker_id IN (SELECT w.id FROM public.workers w WHERE w.company_id=f.company_id AND w.user_id=$${values.length} AND w.is_active)` : "";
        const rows = await client.query<{ id: string }>(`SELECT f.id FROM public.machine_faults f
          WHERE f.company_id=$1 AND f.id=ANY($2::text[]) AND ${predicate} ${fieldPredicate}`, values);
        for (const row of rows.rows) allowedFaults.add(row.id);
      }
      visible = visible.filter((event) => event.entityType !== "machine_fault" || allowedFaults.has(event.entityId));
      for (const [entityType, table, workerColumn] of [
        ["haul", "hauls", "driver_worker_id"], ["machine_daily_check", "machine_daily_checks", "worker_id"],
      ] as const) {
        const ids = visible.filter(event => event.entityType === entityType).map(event => event.entityId);
        const allowed = new Set<string>();
        const permission = entityType === "haul" ? "machines.haul.view" : "machines.check.view";
        if (ids.length && can(ctx.roles, permission)) {
          const values: unknown[] = [ctx.companyId, ids];
          const predicate = activityScope(ctx, values, "a", workerColumn);
          const rows = await client.query<{id: string}>(`SELECT a.id FROM public.${table} a
            WHERE a.company_id=$1 AND a.id=ANY($2::text[]) AND ${predicate}`, values);
          for (const row of rows.rows) allowed.add(row.id);
        }
        visible = visible.filter(event => event.entityType !== entityType || allowed.has(event.entityId));
      }
      // Office role does not override a restricted session. Re-check the authoritative
      // conflict and both project references; never authorize using the event payload.
      if (ctx.scope !== "COMPANY") {
        const conflictIds = visible.filter(event => event.entityType === "sync_conflict").map(event => event.entityId);
        const allowed = new Set<string>();
        if (conflictIds.length && ctx.scope === "PROJECTS") {
          const rows = await client.query<{ id: string }>(`SELECT c.id FROM public.sync_conflicts c
            LEFT JOIN public.work_entries e ON e.company_id=c.company_id AND e.id=c.work_entry_id
            WHERE c.company_id=$1 AND c.id=ANY($2::text[])
              AND (e.project_id=ANY($3::text[]) OR (c.work_entry_id IS NULL AND c.actor_id=$4
                AND c.received_payload->>'projectId'=ANY($3::text[])))
              AND (c.received_payload->>'projectId' IS NULL OR c.received_payload->>'projectId'=ANY($3::text[]))`,
            [ctx.companyId, conflictIds, ctx.projectIds ?? [], ctx.userId]);
          for (const row of rows.rows) allowed.add(row.id);
        } else if (conflictIds.length && ctx.scope === "SELF") {
          const rows = await client.query<{ id: string }>(`SELECT c.id FROM public.sync_conflicts c
            LEFT JOIN public.work_entries e ON e.company_id=c.company_id AND e.id=c.work_entry_id
            WHERE c.company_id=$1 AND c.id=ANY($2::text[]) AND (c.actor_id=$3 OR e.worker_id IN
              (SELECT w.id FROM public.workers w WHERE w.company_id=c.company_id AND w.user_id=$3 AND w.is_active))`,
            [ctx.companyId, conflictIds, ctx.userId]);
          for (const row of rows.rows) allowed.add(row.id);
        }
        visible = visible.filter(event => event.entityType !== "sync_conflict" || allowed.has(event.entityId));
      }
      // Legacy conflict rows do not reliably identify their source entity. Do not expose
      // historical diary/fault conflict payloads after an actor loses company scope.
      if (ctx.scope !== "COMPANY") visible = visible.filter((event) => {
        if (event.entityType !== "sync_conflict") return true;
        const reason = event.payload?.reason;
        return typeof reason !== "string" || (!reason.startsWith("DIARY_") && !reason.startsWith("MACHINE_FAULT_"));
      });

      return {
        forbidden: false as const,
        events: visible.map((event): SyncPullEvent => ({
          id: event.id,
          cursorSeq: event.cursorSeq,
          entityType: event.entityType,
          entityId: event.entityId,
          entityVersion: event.version,
          payload: foremanWorkerId && !officeRead
            && (event.entityType === "workday" || event.entityType === "work_entry" || event.entityType === "sync_conflict")
            ? sanitizeForemanPullPayload(event.entityType, event.payload)
            : event.payload,
          tombstone: event.tombstone,
          createdAt: event.createdAt,
        })),
        cursor: encodeSyncCursor(ctx.companyId, page.next_cursor),
        cursorFloor: encodeSyncCursor(ctx.companyId, page.cursor_floor),
        hasMore: page.has_more,
      };
    });

    if (result.forbidden) return fail("FORBIDDEN", "Nalog nema aktivnu vezu s radnikom ili šefom gradilišta.");
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
