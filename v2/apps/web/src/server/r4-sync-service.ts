/** R4 item-scoped sync writes. Every database transaction is tenant-scoped through withCompany. */
import { createHash, randomUUID } from "node:crypto";
import { withCompany, type CompanyId } from "@gradix/db";
import { hasControlChars } from "@gradix/contracts";
import {
  R4_SYNC_CLOCK_SKEW_SECONDS,
  type R4SyncPushItem,
  type R4SyncPushItemResult,
} from "@gradix/domain";
import type { Pool, PoolClient } from "pg";
import { encodeSyncCursor } from "./sync-cursor";

export type SyncPushActor = { userId: string; companyId: CompanyId; roles: readonly string[] };

/**
 * A1: kontrolni znakovi (npr. NUL) bilo gdje u stavci — string kolone i jsonb u
 * Postgresu ih odbijaju (22P05). Provjera ide kroz cijelu stavku, uključujući
 * ugniježđene zapise (workday header, note), da se loša stavka odbije PO STAVKI
 * umjesto da sruši cijeli batch.
 */
function itemHasControlChars(value: unknown): boolean {
  if (typeof value === "string") return hasControlChars(value);
  if (Array.isArray(value)) return value.some(itemHasControlChars);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(itemHasControlChars);
  }
  return false;
}

export class SyncPushAccessError extends Error {
  constructor(readonly code: "FORBIDDEN" | "NOT_FOUND") {
    super(code);
    this.name = "SyncPushAccessError";
  }
}

type Reservation = { cursor_seq: string; reservation_token: string; already_committed: boolean };
type WorkdayRow = { id: string; worker_id: string; status: "DRAFT" | "SUBMITTED"; header_version: number; work_date: string };
type CanonicalWorkday = { day: WorkdayRow; created: boolean };
type WorkEntryRow = {
  id: string;
  workday_id: string;
  worker_id: string;
  version: number;
  started_at: Date;
  ended_at: Date | null;
  end_state: "OPEN" | "KNOWN_END" | "UNKNOWN_END";
  kind: "WORK" | "BREAK";
  project_id: string | null;
  machine_id: string | null;
  note: string | null;
  review_flags: string[];
};

type StoredReceipt = { request_hash: string; result: R4SyncPushItemResult | null };
type Worker = { id: string; first_name: string; last_name: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function reservationKey(company: string, actor: string, localId: string, purpose: "operation" | "workday"): string {
  return sha256(`${company}\u0000${actor}\u0000${localId}\u0000${purpose}`);
}

function asResult(value: unknown): R4SyncPushItemResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<R4SyncPushItemResult>;
  if (
    typeof result.localId !== "string" ||
    !["APPLIED", "DUPLICATE", "CONFLICT", "REJECTED"].includes(String(result.status)) ||
    !(typeof result.entityId === "string" || result.entityId === null) ||
    !(typeof result.version === "number" || result.version === null) ||
    !(typeof result.cursor === "string" || result.cursor === null)
  ) return null;
  return result as R4SyncPushItemResult;
}

function repeatReceipt(receipt: StoredReceipt, item: R4SyncPushItem, requestHash: string): R4SyncPushItemResult | null {
  if (receipt.request_hash !== requestHash) {
    return {
      localId: item.localId,
      status: "REJECTED",
      entityId: null,
      version: null,
      cursor: null,
      code: "SYNC_LOCAL_ID_REUSED",
    };
  }
  const saved = asResult(receipt.result);
  if (!saved) {
    return {
      localId: item.localId,
      status: "REJECTED",
      entityId: null,
      version: null,
      cursor: null,
      code: "SYNC_ITEM_REJECTED",
    };
  }
  return saved.status === "APPLIED" ? { ...saved, status: "DUPLICATE" } : saved;
}

async function readReceipt(
  pool: Pool,
  actor: SyncPushActor,
  item: R4SyncPushItem,
  requestHash: string,
): Promise<R4SyncPushItemResult | null> {
  return withCompany(pool, actor.companyId, async (client) => {
    const found = await client.query<StoredReceipt>(
      `SELECT request_hash, result
         FROM public.sync_receipts
        WHERE company_id = $1 AND actor_id = $2 AND local_id = $3`,
      [actor.companyId, actor.userId, item.localId],
    );
    return found.rows[0] ? repeatReceipt(found.rows[0], item, requestHash) : null;
  });
}

async function reserveSlot(
  pool: Pool,
  actor: SyncPushActor,
  item: R4SyncPushItem,
  purpose: "operation" | "workday" = "operation",
): Promise<Reservation> {
  const rows = await withCompany(pool, actor.companyId, async (client) => {
    const result = await client.query<Reservation>(
      `SELECT cursor_seq::text, reservation_token, already_committed
         FROM public.sync_cursor_reserve_item($1, $2, 300)`,
      [actor.companyId, reservationKey(actor.companyId, actor.userId, item.localId, purpose)],
    );
    return result.rows[0];
  });
  if (!rows) throw new Error("SYNC_CURSOR_RESERVATION_FAILED");
  return rows;
}

async function readWorker(pool: Pool, actor: SyncPushActor): Promise<Worker | null> {
  return withCompany(pool, actor.companyId, async (client) => {
    const result = await client.query<Worker>(
      `SELECT id, first_name, last_name
         FROM public.workers
        WHERE company_id = $1 AND user_id = $2 AND is_active`,
      [actor.companyId, actor.userId],
    );
    return result.rows[0] ?? null;
  });
}

async function readTargetWorker(pool: Pool, actor: SyncPushActor, workerId: string): Promise<Worker | null> {
  return withCompany(pool, actor.companyId, async (client) => {
    const result = await client.query<Worker>(
      `SELECT id, first_name, last_name
         FROM public.workers
        WHERE company_id = $1 AND id = $2 AND is_active`,
      [actor.companyId, workerId],
    );
    return result.rows[0] ?? null;
  });
}

async function foremanHasAssignmentScope(
  client: PoolClient,
  actor: SyncPushActor,
  foremanWorkerId: string,
  targetWorkerId: string,
  workDate: string,
  projectId: string | null,
): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM public.project_assignments foreman_assignment
         JOIN public.project_assignments worker_assignment
           ON worker_assignment.company_id = foreman_assignment.company_id
          AND worker_assignment.project_id = foreman_assignment.project_id
        WHERE foreman_assignment.company_id = $1
          AND foreman_assignment.worker_id = $2
          AND worker_assignment.worker_id = $3
          AND EXISTS (
            SELECT 1 FROM public.workers supervisor_worker
             WHERE supervisor_worker.company_id = $1
               AND supervisor_worker.id = $2
               AND supervisor_worker.user_id = $6
               AND supervisor_worker.is_active
          )
          AND EXISTS (
            SELECT 1 FROM public.workers target_worker
             WHERE target_worker.company_id = $1
               AND target_worker.id = $3
               AND target_worker.is_active
          )
          AND ($5::text IS NULL OR foreman_assignment.project_id = $5)
          AND foreman_assignment.voided_at IS NULL
          AND foreman_assignment.from_date <= $4::date
          AND (foreman_assignment.to_date IS NULL OR foreman_assignment.to_date >= $4::date)
          AND worker_assignment.voided_at IS NULL
          AND worker_assignment.from_date <= $4::date
          AND (worker_assignment.to_date IS NULL OR worker_assignment.to_date >= $4::date)
     ) AS allowed`,
    [actor.companyId, foremanWorkerId, targetWorkerId, workDate, projectId, actor.userId],
  );
  return result.rows[0]?.allowed === true;
}

async function businessDate(client: PoolClient, company: CompanyId, instant: string): Promise<string | null> {
  const result = await client.query<{ work_date: string }>(
    `SELECT ($1::timestamptz AT TIME ZONE c.timezone)::date::text AS work_date
       FROM public.companies c WHERE c.id = $2`,
    [instant, company],
  );
  return result.rows[0]?.work_date ?? null;
}

async function getOrCreateWorkday(
  client: PoolClient,
  actor: SyncPushActor,
  worker: Worker,
  item: Extract<R4SyncPushItem, { entityType: "work_entry" }>,
): Promise<CanonicalWorkday | null> {
  const workDate = await businessDate(client, actor.companyId, item.entry.startedAt);
  if (!workDate) return null;

  const sameId = await client.query<WorkdayRow>(
    `SELECT id, worker_id, status, header_version, work_date::text
       FROM public.workdays WHERE company_id = $1 AND id = $2`,
    [actor.companyId, item.workdayId],
  );
  if (sameId.rows[0] && (sameId.rows[0].work_date !== workDate || sameId.rows[0].worker_id !== worker.id)) return null;

  const inserted = await client.query<WorkdayRow>(
    `INSERT INTO public.workdays
       (id, company_id, worker_id, work_date, created_by, updated_by)
     VALUES ($1, $2, $3, $4::date, $5, $5)
     ON CONFLICT DO NOTHING
     RETURNING id, worker_id, status, header_version, work_date::text`,
    [item.workdayId, actor.companyId, worker.id, workDate, actor.userId],
  );
  if (inserted.rows[0]) return { day: inserted.rows[0], created: true };

  // Covers both the canonical-day race and a client UUID collision with another tenant. The
  // latter remains invisible under RLS and returns null rather than leaking a global PK error.
  const canonicalDay = await client.query<WorkdayRow>(
    `SELECT id, worker_id, status, header_version, work_date::text
       FROM public.workdays WHERE company_id = $1 AND worker_id = $2 AND work_date = $3::date
       FOR UPDATE`,
    [actor.companyId, worker.id, workDate],
  );
  const row = canonicalDay.rows[0];
  return row ? { day: row, created: false } : null;
}

async function assignmentReviewFlags(
  client: PoolClient,
  actor: SyncPushActor,
  workerId: string,
  item: Extract<R4SyncPushItem, { entityType: "work_entry" }>,
  workDate: string,
  now: Date,
): Promise<string[]> {
  const flags = new Set<string>();
  if (item.entry.endState === "UNKNOWN_END") flags.add("UNKNOWN_END");
  if (Math.abs(now.getTime() - Date.parse(item.deviceSentAt)) > R4_SYNC_CLOCK_SKEW_SECONDS * 1000) {
    flags.add("DEVICE_CLOCK_SKEW");
  }

  if (item.entry.kind === "WORK" && item.entry.projectId) {
    const project = await client.query<{
      is_active: boolean;
      status: string;
      starts_on: string | null;
      ends_on: string | null;
    }>(
      `SELECT is_active, status, starts_on::text, ends_on::text
         FROM public.projects WHERE company_id = $1 AND id = $2`,
      [actor.companyId, item.entry.projectId],
    );
    const row = project.rows[0];
    if (!row) return ["PROJECT_NOT_FOUND"];
    if (!row.is_active || row.status === "FINISHED" || row.status === "CANCELLED") flags.add("PROJECT_INACTIVE");
    if (row.starts_on && row.starts_on > workDate) flags.add("PROJECT_OUTSIDE_DATES");
    if (row.ends_on && row.ends_on < workDate) flags.add("PROJECT_OUTSIDE_DATES");
    const assigned = await client.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM public.project_assignments a
          WHERE a.company_id = $1 AND a.project_id = $2 AND a.worker_id = $3
            AND a.voided_at IS NULL AND a.from_date <= $4::date
            AND (a.to_date IS NULL OR a.to_date >= $4::date)
       ) AS allowed`,
      [actor.companyId, item.entry.projectId, workerId, workDate],
    );
    if (!assigned.rows[0]?.allowed) flags.add("PROJECT_NOT_ASSIGNED_ON_WORK_DATE");
  }

  if (item.entry.machineId) {
    const machine = await client.query<{ is_active: boolean }>(
      `SELECT is_active FROM public.machines WHERE company_id = $1 AND id = $2`,
      [actor.companyId, item.entry.machineId],
    );
    if (!machine.rows[0]) flags.add("MACHINE_NOT_FOUND");
    else if (!machine.rows[0].is_active) flags.add("MACHINE_INACTIVE");
    const assigned = await client.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM public.project_assignments a
          WHERE a.company_id = $1 AND a.machine_id = $2 AND a.project_id = $3
            AND a.voided_at IS NULL AND a.from_date <= $4::date
            AND (a.to_date IS NULL OR a.to_date >= $4::date)
       ) AS allowed`,
      [actor.companyId, item.entry.machineId, item.entry.projectId, workDate],
    );
    if (!assigned.rows[0]?.allowed) flags.add("MACHINE_NOT_ASSIGNED_ON_WORK_DATE");
  }
  return [...flags].sort();
}

async function findExistingEntry(
  client: PoolClient,
  actor: SyncPushActor,
  workerId: string,
  entryId: string,
): Promise<WorkEntryRow | null> {
  const result = await client.query<WorkEntryRow>(
    `SELECT id, workday_id, worker_id, version, started_at, ended_at, end_state,
            kind, project_id, machine_id, note, review_flags
       FROM public.work_entries
      WHERE company_id = $1 AND worker_id = $2 AND id = $3
      FOR UPDATE`,
    [actor.companyId, workerId, entryId],
  );
  return result.rows[0] ?? null;
}

function invalidItem(item: R4SyncPushItem, code = "SYNC_ITEM_REJECTED"): R4SyncPushItemResult {
  return { localId: item.localId, status: "REJECTED", entityId: null, version: null, cursor: null, code };
}

async function saveReceipt(
  client: PoolClient,
  actor: SyncPushActor,
  item: R4SyncPushItem,
  requestHash: string,
  result: R4SyncPushItemResult,
): Promise<void> {
  await client.query(
    `INSERT INTO public.sync_receipts (id, company_id, actor_id, local_id, request_hash, result)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::jsonb)`,
    [actor.companyId, actor.userId, item.localId, requestHash, JSON.stringify(result)],
  );
}

async function skipReservationInTransaction(
  client: PoolClient,
  actor: SyncPushActor,
  reservation: Reservation,
): Promise<void> {
  await client.query(
    "SELECT public.sync_cursor_skip($1, $2::bigint, $3)",
    [actor.companyId, reservation.cursor_seq, reservation.reservation_token],
  );
}

async function publishEvent(
  client: PoolClient,
  actor: SyncPushActor,
  reservation: Reservation,
  requestHash: string,
  entityType: "workday" | "work_entry" | "sync_conflict",
  entityId: string,
  version: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `SELECT public.sync_cursor_publish(
       $1, $2::bigint, $3, $4, $5, $6, $7, $8::jsonb, false
     )`,
    [actor.companyId, reservation.cursor_seq, reservation.reservation_token, requestHash,
      entityType, entityId, version, JSON.stringify(payload)],
  );
}

async function rejectInTransaction(
  client: PoolClient,
  actor: SyncPushActor,
  item: R4SyncPushItem,
  requestHash: string,
  reservation: Reservation,
  result: R4SyncPushItemResult,
  additionalReservation?: Reservation,
): Promise<R4SyncPushItemResult> {
  await skipReservationInTransaction(client, actor, reservation);
  if (additionalReservation) await skipReservationInTransaction(client, actor, additionalReservation);
  await saveReceipt(client, actor, item, requestHash, result);
  return result;
}

async function createConflict(
  client: PoolClient,
  actor: SyncPushActor,
  worker: Worker,
  item: R4SyncPushItem,
  workDate: string,
  requestHash: string,
  reservation: Reservation,
  workEntryId: string | null,
  serverVersion: number | null,
  reason: string,
  additionalReservation?: Reservation,
): Promise<R4SyncPushItemResult> {
  const conflictId = randomUUID();
  const receivedPayload = item.entityType === "work_entry" ? item.entry : item;
  await client.query(
    `INSERT INTO public.sync_conflicts
       (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [conflictId, actor.companyId, actor.userId, item.localId, workEntryId,
      JSON.stringify(receivedPayload), requestHash, serverVersion],
  );
  const payload = {
    id: conflictId,
    localId: item.localId,
    workEntryId,
    workerId: worker.id,
    workerName: `${worker.first_name} ${worker.last_name}`.trim(),
    workDate,
    reason,
    receivedPayload,
    serverVersion,
  };
  await publishEvent(client, actor, reservation, requestHash, "sync_conflict", conflictId, 1, payload);
  if (additionalReservation) await skipReservationInTransaction(client, actor, additionalReservation);
  const result: R4SyncPushItemResult = {
    localId: item.localId,
    status: "CONFLICT",
    entityId: workEntryId,
    version: serverVersion,
    cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
    conflictId,
    code: reason,
  };
  await saveReceipt(client, actor, item, requestHash, result);
  return result;
}

function eventEntry(
  entry: R4SyncPushItem & { entityType: "work_entry" },
  row: WorkEntryRow,
  day: WorkdayRow,
  worker: Worker,
): Record<string, unknown> {
  return {
    id: row.id,
    workdayId: row.workday_id,
    workerId: row.worker_id,
    workerName: `${worker.first_name} ${worker.last_name}`.trim(),
    workDate: day.work_date,
    workdayStatus: day.status,
    workdayVersion: day.header_version,
    kind: row.kind,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    endState: row.end_state,
    projectId: row.project_id,
    machineId: row.machine_id,
    note: row.note,
    reviewFlags: row.review_flags,
    version: row.version,
    clientLocalId: entry.localId,
  };
}

async function applyItem(
  client: PoolClient,
  actor: SyncPushActor,
  worker: Worker,
  foremanWorkerId: string | null,
  item: R4SyncPushItem,
  requestHash: string,
  reservation: Reservation,
  now: Date,
  workdayReservation?: Reservation,
): Promise<R4SyncPushItemResult> {
  if (item.entityType === "workday") {
    const current = await client.query<WorkdayRow>(
      `SELECT id, worker_id, status, header_version, work_date::text
         FROM public.workdays
        WHERE company_id = $1 AND worker_id = $2 AND id = $3
        FOR UPDATE`,
      [actor.companyId, worker.id, item.workdayId],
    );
    const day = current.rows[0];
    if (!day) return rejectInTransaction(client, actor, item, requestHash, reservation, invalidItem(item));
    if (foremanWorkerId && !(await foremanHasAssignmentScope(
      client, actor, foremanWorkerId, worker.id, day.work_date, null,
    ))) {
      return rejectInTransaction(
        client, actor, item, requestHash, reservation, invalidItem(item, "FOREMAN_SCOPE_FORBIDDEN"),
      );
    }
    if (day.header_version !== item.baseVersion || day.status !== "DRAFT") {
      return rejectInTransaction(client, actor, item, requestHash, reservation, {
        ...invalidItem(item),
        entityId: day.id,
        version: day.header_version,
        canonicalWorkdayId: day.id,
        code: "SYNC_ITEM_REJECTED",
      });
    }
    const openEntry = await client.query<{ id: string }>(
      `SELECT id FROM public.work_entries
        WHERE company_id = $1 AND worker_id = $2 AND workday_id = $3
          AND end_state = 'OPEN'
        LIMIT 1`,
      [actor.companyId, worker.id, day.id],
    );
    if (openEntry.rows[0]) {
      return rejectInTransaction(client, actor, item, requestHash, reservation, {
        ...invalidItem(item),
        entityId: day.id,
        version: day.header_version,
        canonicalWorkdayId: day.id,
        code: "SYNC_ITEM_REJECTED",
      });
    }
    const updated = await client.query<WorkdayRow>(
      `UPDATE public.workdays
          SET status = 'SUBMITTED', header_version = header_version + 1,
              updated_by = $4, updated_at = clock_timestamp()
        WHERE company_id = $1 AND worker_id = $2 AND id = $3
        RETURNING id, worker_id, status, header_version, work_date::text`,
      [actor.companyId, worker.id, item.workdayId, actor.userId],
    );
    const submitted = updated.rows[0]!;
    const payload = {
      id: submitted.id,
      workerId: worker.id,
      workerName: `${worker.first_name} ${worker.last_name}`.trim(),
      workDate: submitted.work_date,
      status: submitted.status,
      headerVersion: submitted.header_version,
    };
    await publishEvent(client, actor, reservation, requestHash, "workday", submitted.id, submitted.header_version, payload);
    const result: R4SyncPushItemResult = {
      localId: item.localId,
      status: "APPLIED",
      entityId: submitted.id,
      version: submitted.header_version,
      cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
      canonicalWorkdayId: submitted.id,
    };
    await saveReceipt(client, actor, item, requestHash, result);
    return result;
  }

  const workdaySlot = workdayReservation;
  if (!workdaySlot) throw new Error("SYNC_WORKDAY_RESERVATION_MISSING");
  const reject = (result = invalidItem(item)) =>
    rejectInTransaction(client, actor, item, requestHash, reservation, result, workdaySlot);

  const date = await businessDate(client, actor.companyId, item.entry.startedAt);
  if (!date) return reject();
  const projectId = item.entry.kind === "WORK" ? item.entry.projectId : null;
  if (foremanWorkerId && !(await foremanHasAssignmentScope(
    client, actor, foremanWorkerId, worker.id, date, projectId,
  ))) {
    return reject(invalidItem(item, "FOREMAN_SCOPE_FORBIDDEN"));
  }
  const existing = await findExistingEntry(client, actor, worker.id, item.workEntryId);

  if (item.baseVersion !== undefined) {
    if (!existing) {
      return createConflict(client, actor, worker, item, date, requestHash, reservation,
        null, null, "SYNC_VERSION_CONFLICT", workdaySlot);
    }
    const currentDay = await client.query<{ work_date: string; status: "DRAFT" | "SUBMITTED" }>(
      `SELECT work_date::text, status FROM public.workdays
        WHERE company_id = $1 AND worker_id = $2 AND id = $3`,
      [actor.companyId, worker.id, existing.workday_id],
    );
    if (existing.workday_id !== item.workdayId || currentDay.rows[0]?.work_date !== date) {
      return reject();
    }
    if (existing.version !== item.baseVersion) {
      return createConflict(client, actor, worker, item, date, requestHash, reservation,
        existing.id, existing.version, "SYNC_VERSION_CONFLICT", workdaySlot);
    }
    if (currentDay.rows[0]?.status === "SUBMITTED") {
      return reject({
        ...invalidItem(item), entityId: existing.id, version: existing.version,
        canonicalWorkdayId: existing.workday_id,
      });
    }
  } else if (existing) {
    return reject({
      ...invalidItem(item), entityId: existing.id, version: existing.version,
      canonicalWorkdayId: existing.workday_id,
    });
  }

  // A same-company project/machine must exist; cross-company or missing IDs fail closed. Existing
  // but inactive/unassigned resources are accepted and persisted with an office review flag.
  if (item.entry.kind === "WORK") {
    const project = await client.query<{ id: string }>(
      "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, item.entry.projectId],
    );
    if (!project.rows[0]) return reject();
  }
  if (item.entry.machineId) {
    const machine = await client.query<{ id: string }>(
      "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2",
      [actor.companyId, item.entry.machineId],
    );
    if (!machine.rows[0]) return reject();
  }

  const reviewFlags = await assignmentReviewFlags(client, actor, worker.id, item, date, now);
  if (reviewFlags.includes("PROJECT_NOT_FOUND") || reviewFlags.includes("MACHINE_NOT_FOUND")) return reject();

  // The workday and its entry are one business transaction. This savepoint lets an overlapping
  // rejected entry leave neither an empty workday nor an orphan workday event behind.
  await client.query("SAVEPOINT sync_workday_apply");
  const canonical = await getOrCreateWorkday(client, actor, worker, item);
  if (!canonical || canonical.day.work_date !== date || canonical.day.status === "SUBMITTED") {
    await client.query("ROLLBACK TO SAVEPOINT sync_workday_apply");
    await client.query("RELEASE SAVEPOINT sync_workday_apply");
    return reject(canonical?.day.status === "SUBMITTED"
      ? { ...invalidItem(item), entityId: item.workEntryId, canonicalWorkdayId: canonical.day.id }
      : invalidItem(item));
  }
  const day = canonical.day;
  let changed: WorkEntryRow | null = null;
  try {
    if (item.baseVersion === undefined) {
      const inserted = await client.query<WorkEntryRow>(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state,
            project_id, machine_id, note, version, review_flags, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8,
                 $9, $10, $11, 1, $12::text[], $13, $13)
         RETURNING id, workday_id, worker_id, version, started_at, ended_at, end_state,
                   kind, project_id, machine_id, note, review_flags`,
        [item.workEntryId, actor.companyId, day.id, worker.id, item.entry.kind,
          item.entry.startedAt, item.entry.endedAt, item.entry.endState, item.entry.projectId,
          item.entry.machineId, item.entry.note, reviewFlags, actor.userId],
      );
      changed = inserted.rows[0] ?? null;
    } else {
      const updated = await client.query<WorkEntryRow>(
        `UPDATE public.work_entries
            SET kind = $5, started_at = $6::timestamptz, ended_at = $7::timestamptz,
                end_state = $8, project_id = $9, machine_id = $10, note = $11,
                version = version + 1, review_flags = $12::text[],
                updated_by = $13, updated_at = clock_timestamp()
          WHERE company_id = $1 AND worker_id = $2 AND id = $3
            AND workday_id = $4 AND version = $14
          RETURNING id, workday_id, worker_id, version, started_at, ended_at, end_state,
                    kind, project_id, machine_id, note, review_flags`,
        [actor.companyId, worker.id, item.workEntryId, day.id, item.entry.kind,
          item.entry.startedAt, item.entry.endedAt, item.entry.endState, item.entry.projectId,
          item.entry.machineId, item.entry.note, reviewFlags, actor.userId, item.baseVersion],
      );
      changed = updated.rows[0] ?? null;
    }
  } catch (error) {
    const databaseCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
    const constraint = typeof error === "object" && error !== null && "constraint" in error
      ? String((error as { constraint: unknown }).constraint)
      : "";
    await client.query("ROLLBACK TO SAVEPOINT sync_workday_apply");
    await client.query("RELEASE SAVEPOINT sync_workday_apply");
    if (databaseCode === "23P01" || constraint === "work_entries_one_open_per_worker"
        || (error instanceof Error && error.message.includes("WORK_ENTRY_OVERLAP"))) {
      return createConflict(client, actor, worker, item, date, requestHash, reservation,
        item.baseVersion === undefined ? null : item.workEntryId,
        existing?.version ?? null,
        constraint === "work_entries_one_open_per_worker" ? "WORK_ENTRY_OPEN_EXISTS" : "WORK_ENTRY_OVERLAP",
        workdaySlot);
    }
    if (databaseCode.startsWith("23")) {
      return rejectInTransaction(client, actor, item, requestHash, reservation, invalidItem(item), workdaySlot);
    }
    throw error;
  }

  if (!changed) {
    await client.query("ROLLBACK TO SAVEPOINT sync_workday_apply");
    await client.query("RELEASE SAVEPOINT sync_workday_apply");
    return reject();
  }
  await client.query("RELEASE SAVEPOINT sync_workday_apply");
  if (canonical.created) {
    await publishEvent(client, actor, workdaySlot, requestHash, "workday", day.id, day.header_version, {
      id: day.id,
      workerId: worker.id,
      workerName: `${worker.first_name} ${worker.last_name}`.trim(),
      workDate: day.work_date,
      status: day.status,
      headerVersion: day.header_version,
    });
  } else {
    await skipReservationInTransaction(client, actor, workdaySlot);
  }
  const eventPayload = eventEntry(item, changed, day, worker);
  await publishEvent(client, actor, reservation, requestHash, "work_entry", changed.id, changed.version, eventPayload);
  const result: R4SyncPushItemResult = {
    localId: item.localId,
    status: "APPLIED",
    entityId: changed.id,
    version: changed.version,
    cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
    canonicalWorkdayId: day.id,
  };
  await saveReceipt(client, actor, item, requestHash, result);
  return result;
}

async function applyReservedItem(
  pool: Pool,
  actor: SyncPushActor,
  worker: Worker,
  foremanWorkerId: string | null,
  item: R4SyncPushItem,
  requestHash: string,
  reservation: Reservation,
  workdayReservation?: Reservation,
): Promise<R4SyncPushItemResult> {
  return withCompany(pool, actor.companyId, async (client) => {
    // Serializes the same actor/localId without holding the allocator lock or serializing other
    // items. A second payload under the same localId observes the first committed receipt.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [reservationKey(actor.companyId, actor.userId, item.localId, "operation")],
    );
    const prior = await client.query<StoredReceipt>(
      `SELECT request_hash, result FROM public.sync_receipts
        WHERE company_id = $1 AND actor_id = $2 AND local_id = $3`,
      [actor.companyId, actor.userId, item.localId],
    );
    if (prior.rows[0]) {
      // A racing retry may already have allocated a fresh generation after an earlier rejected
      // operation skipped its slot. Retire any new pending reservations before replaying receipt.
      await skipReservationInTransaction(client, actor, reservation);
      if (workdayReservation) await skipReservationInTransaction(client, actor, workdayReservation);
      return repeatReceipt(prior.rows[0], item, requestHash)!;
    }
    if (reservation.already_committed) {
      if (workdayReservation) await skipReservationInTransaction(client, actor, workdayReservation);
      return invalidItem(item, "SYNC_ITEM_REJECTED");
    }
    return applyItem(client, actor, worker, foremanWorkerId, item, requestHash, reservation, new Date(), workdayReservation);
  });
}

/** Process independent idempotent operations; request validation happens in the route first. */
export async function pushR4SyncItems(
  pool: Pool,
  actor: SyncPushActor,
  items: readonly R4SyncPushItem[],
): Promise<R4SyncPushItemResult[]> {
  const isWorker = actor.roles.includes("WORKER");
  const isForeman = actor.roles.includes("SITE_SUPERVISOR");
  if (!isWorker && !isForeman) throw new SyncPushAccessError("FORBIDDEN");
  const actorWorker = await readWorker(pool, actor);
  if (!actorWorker) throw new SyncPushAccessError("NOT_FOUND");
  await withCompany(pool, actor.companyId, async (client) => {
    await client.query("SELECT public.sync_cursor_sweep($1, 100)", [actor.companyId]);
  });

  const results: R4SyncPushItemResult[] = [];
  for (const item of items) {
    // A1: stavka s kontrolnim znakom dobija svoj ishod; ostatak batcha se obrađuje normalno.
    if (itemHasControlChars(item)) {
      results.push(invalidItem(item));
      continue;
    }
    let worker: Worker;
    let foremanWorkerId: string | null = null;
    if (item.workerId !== undefined) {
      if (!isForeman) {
        results.push(invalidItem(item, "WORKER_TARGET_FORBIDDEN"));
        continue;
      }
      const target = await readTargetWorker(pool, actor, item.workerId);
      if (!target) {
        results.push(invalidItem(item, "FOREMAN_SCOPE_FORBIDDEN"));
        continue;
      }
      worker = target;
      foremanWorkerId = actorWorker.id;
    } else {
      if (!isWorker) {
        results.push(invalidItem(item, "FOREMAN_WORKER_REQUIRED"));
        continue;
      }
      worker = actorWorker;
    }

    const requestHash = sha256(canonical(item));
    const prior = await readReceipt(pool, actor, item, requestHash);
    if (prior) {
      results.push(prior);
      continue;
    }
    // Each potential canonical-day insert has its own slot so both the day and the entry can
    // emit an event atomically. If the canonical day already exists this slot is SKIPPED.
    const workdayReservation = item.entityType === "work_entry"
      ? await reserveSlot(pool, actor, item, "workday")
      : undefined;
    const reservation = await reserveSlot(pool, actor, item);
    // Failed or ambiguous business transactions intentionally leave slots PENDING. The lease
    // sweeper can mark them SKIPPED only after expiry and a successful row lock.
    results.push(await applyReservedItem(
      pool, actor, worker, foremanWorkerId, item, requestHash, reservation, workdayReservation,
    ));
  }
  return results;
}

/** Runtime guard in addition to the domain validator; prevents accidentally bypassing it. */
export function assertR4SyncItems(items: readonly R4SyncPushItem[]): void {
  if (items.length < 1 || items.length > 100) throw new Error("SYNC_BATCH_TOO_LARGE");
}
