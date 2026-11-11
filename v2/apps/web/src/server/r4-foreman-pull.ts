import { isOffsetDateTime } from "@gradix/domain";
import type { PoolClient } from "pg";

type ForemanPullEvent = {
  id: string;
  entityType: "workday" | "work_entry" | "sync_conflict";
  entityId: string;
  payload: Record<string, unknown> | null;
  tombstone: boolean;
};

type WorkEntryCandidate = {
  eventId: string;
  entityId: string;
  workdayId: string;
  workerId: string;
  workDate: string;
  projectId: string;
};

type ConflictCandidate = {
  eventId: string;
  entityId: string;
  workerId: string;
  workDate: string;
  projectId: string;
  receivedPayload: Record<string, unknown>;
  /** R4a-2: ishod razrješenja smije vidjeti i šef u čijem je opsegu radnik,
      ne samo pošiljalac primljenog unosa (autor server unosa je često šef). */
  resolved: boolean;
};

type WorkdayCandidate = {
  eventId: string;
  workdayId: string;
  workerId: string;
  workDate: string;
};

const WORK_ENTRY_FIELDS = [
  "id", "workdayId", "workerId", "workerName", "workDate", "kind", "startedAt", "endedAt",
  "endState", "projectId", "machineId", "note", "reviewFlags", "version", "clientLocalId",
] as const;
const WORKDAY_FIELDS = ["id", "workerId", "workerName", "workDate", "status", "headerVersion"] as const;
const CONFLICT_FIELDS = [
  "id", "localId", "workEntryId", "workerId", "workerName", "workDate", "reason", "serverVersion",
  // R4a-2 ishod razrješenja (device-payload iz workday-resolve): bez interne napomene,
  // koja se u ovaj payload nikad i ne upisuje.
  "status", "kind", "oldTimes", "newTimes", "rejectedEntryId", "acceptedEntryId", "correctedTarget",
] as const;
const RECEIVED_WORK_FIELDS = [
  "kind", "startedAt", "endedAt", "endState", "projectId", "machineId", "note",
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pick(value: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(value, field)) safe[field] = value[field];
  }
  return safe;
}

/** Never let additions to an internal event payload turn into new foreman-visible personal fields. */
export function sanitizeForemanPullPayload(
  entityType: ForemanPullEvent["entityType"],
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const source = record(payload);
  if (!source) return null;
  if (entityType === "work_entry") return pick(source, WORK_ENTRY_FIELDS);
  if (entityType === "workday") return pick(source, WORKDAY_FIELDS);
  const safe = pick(source, CONFLICT_FIELDS);
  const received = record(source.receivedPayload);
  if (received) safe.receivedPayload = pick(received, RECEIVED_WORK_FIELDS);
  return safe;
}

function realWorkDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function workEntryCandidate(event: ForemanPullEvent): WorkEntryCandidate | null {
  if (event.entityType !== "work_entry" || event.tombstone) return null;
  const payload = record(event.payload);
  if (!payload || payload.id !== event.entityId || payload.kind !== "WORK"
      || !validId(payload.workdayId) || !validId(payload.workerId)
      || !validId(payload.projectId) || !realWorkDate(payload.workDate)) return null;
  return {
    eventId: event.id,
    entityId: event.entityId,
    workdayId: payload.workdayId,
    workerId: payload.workerId,
    projectId: payload.projectId,
    workDate: payload.workDate,
  };
}

function workdayCandidate(event: ForemanPullEvent): WorkdayCandidate | null {
  if (event.entityType !== "workday" || event.tombstone) return null;
  const payload = record(event.payload);
  if (!payload || payload.id !== event.entityId || !validId(payload.workerId)
      || !realWorkDate(payload.workDate)) return null;
  return {
    eventId: event.id,
    workdayId: event.entityId,
    workerId: payload.workerId,
    workDate: payload.workDate,
  };
}

function conflictCandidate(event: ForemanPullEvent): ConflictCandidate | null {
  if (event.entityType !== "sync_conflict" || event.tombstone) return null;
  const payload = record(event.payload);
  const receivedPayload = record(payload?.receivedPayload);
  if (!payload || payload.id !== event.entityId || !receivedPayload
      || receivedPayload.kind !== "WORK" || !validId(payload.workerId)
      || !validId(receivedPayload.projectId) || !isOffsetDateTime(receivedPayload.startedAt)
      || !realWorkDate(payload.workDate)) return null;
  return {
    eventId: event.id,
    entityId: event.entityId,
    workerId: payload.workerId,
    projectId: receivedPayload.projectId,
    workDate: payload.workDate,
    receivedPayload,
    resolved: payload.status === "RESOLVED",
  };
}

const WORK_ENTRY_SCOPE_SQL = `
  SELECT candidate.event_id
    FROM jsonb_to_recordset($3::jsonb)
      AS candidate(event_id text, entity_id text, workday_id text, worker_id text, work_date date, project_id text)
    JOIN public.work_entries source_entry
      ON source_entry.company_id = $1
     AND source_entry.id = candidate.entity_id
     AND source_entry.workday_id = candidate.workday_id
     AND source_entry.worker_id = candidate.worker_id
    JOIN public.workdays source_day
      ON source_day.company_id = source_entry.company_id
     AND source_day.id = source_entry.workday_id
     AND source_day.worker_id = source_entry.worker_id
     AND source_day.work_date = candidate.work_date
   WHERE EXISTS (
     SELECT 1
       FROM public.project_assignments foreman_assignment
       JOIN public.project_assignments worker_assignment
         ON worker_assignment.company_id = foreman_assignment.company_id
        AND worker_assignment.project_id = foreman_assignment.project_id
      WHERE foreman_assignment.company_id = $1
        AND foreman_assignment.worker_id = $2
        AND worker_assignment.worker_id = candidate.worker_id
        AND foreman_assignment.project_id = candidate.project_id
        AND foreman_assignment.voided_at IS NULL
        AND foreman_assignment.from_date <= candidate.work_date
        AND (foreman_assignment.to_date IS NULL OR foreman_assignment.to_date >= candidate.work_date)
        AND worker_assignment.voided_at IS NULL
        AND worker_assignment.from_date <= candidate.work_date
        AND (worker_assignment.to_date IS NULL OR worker_assignment.to_date >= candidate.work_date)
   )`;

const CONFLICT_SCOPE_SQL = `
  SELECT candidate.event_id
    FROM jsonb_to_recordset($4::jsonb)
      AS candidate(event_id text, entity_id text, worker_id text, work_date date,
                   project_id text, received_payload jsonb, resolved boolean)
    JOIN public.sync_conflicts conflict
      ON conflict.company_id = $1
     AND conflict.id = candidate.entity_id
     AND (conflict.actor_id = $3 OR candidate.resolved)
     AND conflict.received_payload = candidate.received_payload
   WHERE EXISTS (
     SELECT 1
       FROM public.project_assignments foreman_assignment
       JOIN public.project_assignments worker_assignment
         ON worker_assignment.company_id = foreman_assignment.company_id
        AND worker_assignment.project_id = foreman_assignment.project_id
      WHERE foreman_assignment.company_id = $1
        AND foreman_assignment.worker_id = $2
        AND worker_assignment.worker_id = candidate.worker_id
        AND foreman_assignment.project_id = candidate.project_id
        AND foreman_assignment.voided_at IS NULL
        AND foreman_assignment.from_date <= candidate.work_date
        AND (foreman_assignment.to_date IS NULL OR foreman_assignment.to_date >= candidate.work_date)
        AND worker_assignment.voided_at IS NULL
        AND worker_assignment.from_date <= candidate.work_date
        AND (worker_assignment.to_date IS NULL OR worker_assignment.to_date >= candidate.work_date)
   )`;

const WORKDAY_SCOPE_SQL = `
  WITH candidates AS (
    SELECT * FROM jsonb_to_recordset($3::jsonb)
      AS candidate(event_id text, workday_id text, worker_id text, work_date date)
  )
  SELECT candidate.event_id
    FROM candidates candidate
    JOIN public.workdays day
      ON day.company_id = $1
     AND day.id = candidate.workday_id
     AND day.worker_id = candidate.worker_id
     AND day.work_date = candidate.work_date
   WHERE EXISTS (
     SELECT 1
       FROM public.work_entries entry
       JOIN public.project_assignments foreman_assignment
         ON foreman_assignment.company_id = day.company_id
        AND foreman_assignment.worker_id = $2
        AND foreman_assignment.project_id = entry.project_id
       JOIN public.project_assignments worker_assignment
         ON worker_assignment.company_id = foreman_assignment.company_id
        AND worker_assignment.project_id = foreman_assignment.project_id
        AND worker_assignment.worker_id = day.worker_id
      WHERE entry.company_id = day.company_id
        AND entry.workday_id = day.id
        AND entry.worker_id = day.worker_id
        AND entry.kind = 'WORK'
        AND entry.project_id IS NOT NULL
        AND foreman_assignment.voided_at IS NULL
        AND foreman_assignment.from_date <= day.work_date
        AND (foreman_assignment.to_date IS NULL OR foreman_assignment.to_date >= day.work_date)
        AND worker_assignment.voided_at IS NULL
        AND worker_assignment.from_date <= day.work_date
        AND (worker_assignment.to_date IS NULL OR worker_assignment.to_date >= day.work_date)
   )`;

/**
 * Filter the company-wide change page to a foreman's historical R3 scope. Work entries are checked
 * against their tenant-owned row and workday, then against both assignment histories for work_date.
 * Conflicts are visible only to their actor. Conflicts are visible to their actor;
 * a RESOLVED outcome is additionally visible to a foreman whose R3 scope covers
 * the worker/project/date (the server entry's author is often the foreman).
 * Breaks and tombstones (whose scope metadata is absent)
 * fail closed; no payload is guessed into scope.
 */
export async function foremanVisibleR4EventIds(
  client: PoolClient,
  companyId: string,
  foremanWorkerId: string,
  foremanUserId: string,
  events: readonly ForemanPullEvent[],
): Promise<Set<string>> {
  const visible = new Set<string>();
  const workEntryCandidates = events.map(workEntryCandidate)
    .filter((row): row is WorkEntryCandidate => row !== null);
  const conflictCandidates = events.map(conflictCandidate)
    .filter((row): row is ConflictCandidate => row !== null);
  const workdayCandidates = events.map(workdayCandidate)
    .filter((row): row is WorkdayCandidate => row !== null);

  if (workEntryCandidates.length > 0) {
    const result = await client.query<{ event_id: string }>(
      WORK_ENTRY_SCOPE_SQL,
      [companyId, foremanWorkerId, JSON.stringify(workEntryCandidates.map((candidate) => ({
        event_id: candidate.eventId,
        entity_id: candidate.entityId,
        workday_id: candidate.workdayId,
        worker_id: candidate.workerId,
        work_date: candidate.workDate,
        project_id: candidate.projectId,
      })))],
    );
    for (const row of result.rows) visible.add(row.event_id);
  }

  if (conflictCandidates.length > 0) {
    const result = await client.query<{ event_id: string }>(
      CONFLICT_SCOPE_SQL,
      [companyId, foremanWorkerId, foremanUserId, JSON.stringify(conflictCandidates.map((candidate) => ({
        event_id: candidate.eventId,
        entity_id: candidate.entityId,
        worker_id: candidate.workerId,
        work_date: candidate.workDate,
        project_id: candidate.projectId,
        received_payload: candidate.receivedPayload,
        resolved: candidate.resolved,
      })))],
    );
    for (const row of result.rows) visible.add(row.event_id);
  }

  if (workdayCandidates.length > 0) {
    const result = await client.query<{ event_id: string }>(
      WORKDAY_SCOPE_SQL,
      [companyId, foremanWorkerId, JSON.stringify(workdayCandidates.map((candidate) => ({
        event_id: candidate.eventId,
        workday_id: candidate.workdayId,
        worker_id: candidate.workerId,
        work_date: candidate.workDate,
      })))],
    );
    for (const row of result.rows) visible.add(row.event_id);
  }

  return visible;
}
