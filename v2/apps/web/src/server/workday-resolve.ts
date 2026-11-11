/**
 * R4a-2 korak 2b: razrješenje sukoba radnih dana na serveru.
 *
 * Pravila (odobren dizajn + izmjene vlasnika):
 *  - jedna transakcija: zaključavanje reda sukoba (FOR UPDATE), primjena,
 *    audit i change-log događaj; drugi istovremeni razrješavalac dobija
 *    „već razriješeno" s ishodom prvog (ko/kada/šta), bez ponovne primjene.
 *  - „razlog" (vidljiv autoru unosa, obavezan, >= 10 znakova, validacija i na
 *    serveru i u bazi) i „internal_note" (interna napomena ureda) su dva
 *    odvojena polja; interna napomena NIKAD ne ulazi u događaj za uređaj ni
 *    u bilo koji payload namijenjen telefonu (dokaz: buildDeviceResolutionPayload
 *    je jedini izvor payload-a događaja i test ga provjerava).
 *  - ništa se ne briše: odbačen server-unos ostaje red u work_entries sa
 *    resolution_state='REJECTED', razlogom i autorom odluke.
 *  - ispravka vremena prolazi iste provjere kao svaki unos (trigger za
 *    preklapanje); greška preklapanja se vraća kao jasan ishod, transakcija
 *    se ne ruši neobjašnjeno (SAVEPOINT).
 *  - strana u sukobu ne razrješava; OWNER smije, ali razrješenje nosi oznaku
 *    resolved_by_party u bazi, auditu i uredskom prikazu.
 */
import { createHash, randomUUID } from "node:crypto";
import { companyId as toCompanyId, withCompany, type CompanyId } from "@gradix/db";
import type { Pool, PoolClient } from "pg";
import { writeAudit } from "./audit";
import { canResolveConflict, isConflictParty, workdayResolveScopeFor } from "./workday-review";

export type ResolutionKind = "ACCEPT_SERVER" | "ACCEPT_RECEIVED" | "CORRECTED_TIMES" | "REJECTED";
export type CorrectedTarget = "SERVER" | "RECEIVED";

export type EntryTimes = { startedAt: string; endedAt: string | null; endState: string };

export type ResolveActor = {
  userId: string;
  companyId: CompanyId;
  roles: readonly string[];
  email: string | null;
};

export type ResolveConflictInput = {
  conflictId: string;
  kind: ResolutionKind;
  /** Razlog vidljiv autoru odbačenog/ispravljenog unosa. Obavezan, >= 10 znakova. */
  reason: string;
  /** Interna napomena ureda. Nikad ne ide na uređaj. */
  internalNote?: string | null;
  idempotencyKey: string;
  correctedTimes?: EntryTimes;
  correctedTarget?: CorrectedTarget;
};

export type ResolveOutcome = {
  outcome: "RESOLVED" | "ALREADY_RESOLVED" | "VALIDATION_FAILED" | "FORBIDDEN" | "NOT_FOUND";
  conflictId: string;
  kind?: ResolutionKind;
  resolvedBy?: string;
  resolvedAt?: string;
  reason?: string;
  resolvedByParty?: boolean;
  oldTimes?: EntryTimes | null;
  newTimes?: EntryTimes | null;
  rejectedEntryId?: string | null;
  acceptedEntryId?: string | null;
  code?: string;
};

export function validateResolutionReason(reason: string): boolean {
  return reason.trim().length >= 10 && reason.trim().length <= 500;
}

/**
 * Jedini payload koji smije prema uređaju (change-log događaj / pull).
 * Interna napomena se ovdje NE prima kao argument — ne može procuriti.
 */
export function buildDeviceResolutionPayload(args: {
  conflictId: string;
  kind: ResolutionKind;
  reason: string;
  resolvedByParty: boolean;
  workEntryId: string | null;
  oldTimes: EntryTimes | null;
  newTimes: EntryTimes | null;
  rejectedEntryId: string | null;
  acceptedEntryId: string | null;
}): Record<string, unknown> {
  return {
    id: args.conflictId,
    status: "RESOLVED",
    kind: args.kind,
    reason: args.reason,
    resolvedByParty: args.resolvedByParty,
    workEntryId: args.workEntryId,
    oldTimes: args.oldTimes,
    newTimes: args.newTimes,
    rejectedEntryId: args.rejectedEntryId,
    acceptedEntryId: args.acceptedEntryId,
  };
}

type ConflictRow = {
  id: string;
  actor_id: string;
  work_entry_id: string | null;
  received_payload: Record<string, unknown> | null;
  status: string;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_reason: string | null;
  resolution_kind: ResolutionKind | null;
  resolution_payload: Record<string, unknown> | null;
  resolved_by_party: boolean;
};

type EntryRow = {
  id: string;
  workday_id: string;
  worker_id: string;
  kind: string;
  started_at: Date;
  ended_at: Date | null;
  end_state: string;
  project_id: string | null;
  machine_id: string | null;
  note: string | null;
  version: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timesOf(entry: EntryRow): EntryTimes {
  return {
    startedAt: entry.started_at.toISOString(),
    endedAt: entry.ended_at?.toISOString() ?? null,
    endState: entry.end_state,
  };
}

function receivedTimes(payload: Record<string, unknown> | null): EntryTimes | null {
  if (!payload || typeof payload.startedAt !== "string") return null;
  return {
    startedAt: payload.startedAt,
    endedAt: typeof payload.endedAt === "string" ? payload.endedAt : null,
    endState: typeof payload.endState === "string" ? payload.endState : "KNOWN_END",
  };
}

function validTimes(times: EntryTimes): boolean {
  if (!Number.isFinite(Date.parse(times.startedAt))) return false;
  if (times.endState === "OPEN" || times.endState === "UNKNOWN_END") return times.endedAt === null;
  if (times.endState === "KNOWN_END") {
    return times.endedAt !== null && Date.parse(times.endedAt) > Date.parse(times.startedAt);
  }
  return false;
}

function storedOutcome(conflict: ConflictRow): ResolveOutcome {
  const payload = conflict.resolution_payload ?? {};
  const pick = (key: string) => (payload[key] === undefined ? undefined : (payload[key] as never));
  return {
    outcome: "ALREADY_RESOLVED",
    conflictId: conflict.id,
    kind: conflict.resolution_kind ?? undefined,
    resolvedBy: conflict.resolved_by ?? undefined,
    resolvedAt: conflict.resolved_at?.toISOString(),
    reason: conflict.resolution_reason ?? undefined,
    resolvedByParty: conflict.resolved_by_party,
    oldTimes: (pick("oldTimes") as EntryTimes | null | undefined) ?? null,
    newTimes: (pick("newTimes") as EntryTimes | null | undefined) ?? null,
    rejectedEntryId: (pick("rejectedEntryId") as string | null | undefined) ?? null,
    acceptedEntryId: (pick("acceptedEntryId") as string | null | undefined) ?? null,
  };
}

async function skipReservation(client: PoolClient, company: string, seq: string, token: string): Promise<void> {
  await client.query("SELECT public.sync_cursor_skip($1, $2::bigint, $3)", [company, seq, token]);
}

/** Podsjetnik bez pozadinskog posla: otvoreni sukobi i oni stariji od praga firme. */
export async function countOpenConflicts(
  client: PoolClient,
  companyId: string,
  scope: ReturnType<typeof workdayResolveScopeFor>,
): Promise<{ open: number; olderThanThreshold: number; thresholdDays: number }> {
  if (scope.kind === "none") return { open: 0, olderThanThreshold: 0, thresholdDays: 3 };
  const result = await client.query<{ open: string; older: string; threshold: number }>(
    `SELECT count(conflict.id)::text AS open,
            count(conflict.id) FILTER (
              WHERE conflict.created_at < clock_timestamp() - make_interval(days => company.conflict_reminder_days)
            )::text AS older,
            company.conflict_reminder_days AS threshold
       FROM public.companies company
       LEFT JOIN public.sync_conflicts conflict
         ON conflict.company_id = company.id AND conflict.status = 'OPEN'
        AND (
          $2::text = 'company'
          OR (
            $3::text IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM public.work_entries entry
               WHERE entry.company_id = conflict.company_id AND entry.id = conflict.work_entry_id
                 AND EXISTS (
                   SELECT 1
                     FROM public.project_assignments va
                     JOIN public.project_assignments ta
                       ON ta.company_id = va.company_id AND ta.project_id = va.project_id
                    WHERE va.company_id = conflict.company_id AND ta.company_id = conflict.company_id
                      AND va.worker_id = $3 AND ta.worker_id = entry.worker_id
                      AND va.voided_at IS NULL AND ta.voided_at IS NULL
                 )
            )
          )
        )
      WHERE company.id = $1
      GROUP BY company.conflict_reminder_days`,
    [companyId, scope.kind, scope.kind === "assignments" ? scope.viewerWorkerId : null],
  );
  const row = result.rows[0];
  return {
    open: Number(row?.open ?? 0),
    olderThanThreshold: Number(row?.older ?? 0),
    thresholdDays: row?.threshold ?? 3,
  };
}

export async function resolveWorkdayConflict(
  pool: Pool,
  actor: ResolveActor,
  input: ResolveConflictInput,
): Promise<ResolveOutcome> {
  if (!validateResolutionReason(input.reason)) {
    return { outcome: "VALIDATION_FAILED", conflictId: input.conflictId, code: "RESOLUTION_REASON_TOO_SHORT" };
  }
  if (input.internalNote != null && (input.internalNote.length < 1 || input.internalNote.length > 2000)) {
    return { outcome: "VALIDATION_FAILED", conflictId: input.conflictId, code: "INTERNAL_NOTE_INVALID" };
  }
  if (input.kind === "CORRECTED_TIMES" && (!input.correctedTimes || !validTimes(input.correctedTimes))) {
    return { outcome: "VALIDATION_FAILED", conflictId: input.conflictId, code: "CORRECTED_TIMES_INVALID" };
  }

  const company = actor.companyId as unknown as string;
  const reservationKey = sha256(`${company}\u0000resolve\u0000${input.conflictId}\u0000${input.idempotencyKey}`);
  const requestHash = sha256(`resolve:${input.conflictId}:${input.idempotencyKey}`);
  const reservation = await withCompany(pool, actor.companyId, async (client) => {
    const result = await client.query<{ cursor_seq: string; reservation_token: string; already_committed: boolean }>(
      "SELECT cursor_seq::text, reservation_token, already_committed FROM public.sync_cursor_reserve_item($1, $2, 300)",
      [company, reservationKey],
    );
    return result.rows[0]!;
  });

  return withCompany(pool, actor.companyId, async (client) => {
    const fail = async (outcome: ResolveOutcome): Promise<ResolveOutcome> => {
      await skipReservation(client, company, reservation.cursor_seq, reservation.reservation_token);
      return outcome;
    };

    const found = await client.query<ConflictRow>(
      `SELECT id, actor_id, work_entry_id, received_payload, status, resolved_by, resolved_at,
              resolution_reason, resolution_kind, resolution_payload, resolved_by_party
         FROM public.sync_conflicts
        WHERE company_id = $1 AND id = $2
        FOR UPDATE`,
      [company, input.conflictId],
    );
    const conflict = found.rows[0];
    if (!conflict) return fail({ outcome: "NOT_FOUND", conflictId: input.conflictId });

    // Idempotentnost: već razriješen sukob vraća pohranjeni ishod, bez ponovne primjene.
    if (conflict.status === "RESOLVED") return fail(storedOutcome(conflict));

    const serverEntry = conflict.work_entry_id
      ? (await client.query<EntryRow>(
          `SELECT id, workday_id, worker_id, kind, started_at, ended_at, end_state,
                  project_id, machine_id, note, version
             FROM public.work_entries WHERE company_id = $1 AND id = $2 FOR UPDATE`,
          [company, conflict.work_entry_id],
        )).rows[0] ?? null
      : null;

    const actorWorker = (await client.query<{ id: string }>(
      "SELECT id FROM public.workers WHERE company_id = $1 AND user_id = $2 AND is_active",
      [company, conflict.actor_id],
    )).rows[0]?.id ?? null;

    const resolverWorkerId = (await client.query<{ id: string }>(
      "SELECT id FROM public.workers WHERE company_id = $1 AND user_id = $2 AND is_active",
      [company, actor.userId],
    )).rows[0]?.id ?? null;

    // Opseg: PM/šef smiju razriješiti samo sukobe radnika iz svog R3 opsega.
    const scope = workdayResolveScopeFor(actor.roles, resolverWorkerId);
    if (scope.kind === "none") {
      return fail({ outcome: "FORBIDDEN", conflictId: input.conflictId, code: "RESOLVE_FORBIDDEN" });
    }
    const targetWorkerId = serverEntry?.worker_id ?? actorWorker;
    if (scope.kind === "assignments") {
      if (!scope.viewerWorkerId || !targetWorkerId) {
        return fail({ outcome: "FORBIDDEN", conflictId: input.conflictId, code: "RESOLVE_OUT_OF_SCOPE" });
      }
      const inScope = await client.query<{ allowed: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM public.project_assignments va
             JOIN public.project_assignments ta
               ON ta.company_id = va.company_id AND ta.project_id = va.project_id
            WHERE va.company_id = $1 AND ta.company_id = $1
              AND va.worker_id = $2 AND ta.worker_id = $3
              AND va.voided_at IS NULL AND ta.voided_at IS NULL
         ) AS allowed`,
        [company, scope.viewerWorkerId, targetWorkerId],
      );
      if (!inScope.rows[0]?.allowed) {
        return fail({ outcome: "FORBIDDEN", conflictId: input.conflictId, code: "RESOLVE_OUT_OF_SCOPE" });
      }
    }

    const partyWorkerIds = [serverEntry?.worker_id ?? null, actorWorker];
    const party = isConflictParty(resolverWorkerId, partyWorkerIds);
    if (!canResolveConflict({ roles: actor.roles, resolverWorkerId, partyWorkerIds })) {
      return fail({ outcome: "FORBIDDEN", conflictId: input.conflictId, code: "RESOLVER_IS_PARTY" });
    }
    // OWNER koji je strana u sukobu smije razriješiti, ali s izričitom oznakom.
    const resolvedByParty = party && actor.roles.includes("OWNER");

    const received = receivedTimes(conflict.received_payload);
    const oldTimes = serverEntry ? timesOf(serverEntry) : received;
    let newTimes: EntryTimes | null = null;
    let rejectedEntryId: string | null = null;
    let acceptedEntryId: string | null = serverEntry?.id ?? null;

    const markServerRejected = async (): Promise<void> => {
      if (!serverEntry) return;
      await client.query(
        `UPDATE public.work_entries
            SET resolution_state = 'REJECTED', rejected_at = clock_timestamp(),
                rejected_by = $3, rejection_reason = $4, version = version + 1,
                updated_by = $3, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [company, serverEntry.id, actor.userId, input.reason.trim()],
      );
      rejectedEntryId = serverEntry.id;
    };

    const insertReceived = async (times: EntryTimes): Promise<string | null> => {
      const payload = conflict.received_payload ?? {};
      const workerId = targetWorkerId;
      if (!workerId || typeof payload.kind !== "string") return null;
      const dateRow = await client.query<{ work_date: string }>(
        `SELECT ($1::timestamptz AT TIME ZONE c.timezone)::date::text AS work_date
           FROM public.companies c WHERE c.id = $2`,
        [times.startedAt, company],
      );
      const workDate = dateRow.rows[0]?.work_date;
      if (!workDate) return null;
      let day = (await client.query<{ id: string }>(
        "SELECT id FROM public.workdays WHERE company_id = $1 AND worker_id = $2 AND work_date = $3::date",
        [company, workerId, workDate],
      )).rows[0];
      if (!day) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO public.workdays (id, company_id, worker_id, work_date, created_by, updated_by)
           VALUES ($1, $2, $3, $4::date, $5, $5) RETURNING id`,
          [randomUUID(), company, workerId, workDate, actor.userId],
        );
        day = created.rows[0]!;
      }
      const entryId = randomUUID();
      await client.query(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state,
            project_id, machine_id, note, version, review_flags, created_by, updated_by, office_corrected)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, 1, '{}'::text[], $12, $13, $14)`,
        [entryId, company, day.id, workerId, payload.kind, times.startedAt, times.endedAt, times.endState,
          typeof payload.projectId === "string" ? payload.projectId : null,
          typeof payload.machineId === "string" ? payload.machineId : null,
          typeof payload.note === "string" ? payload.note : null,
          conflict.actor_id, actor.userId, input.kind === "CORRECTED_TIMES"],
      );
      return entryId;
    };

    // Primjena u SAVEPOINT-u: preklapanje/open-segment greške postaju jasan
    // ishod (VALIDATION_FAILED), a ne pad cijele transakcije bez objašnjenja.
    await client.query("SAVEPOINT resolution_apply");
    try {
      if (input.kind === "ACCEPT_SERVER") {
        newTimes = oldTimes;
      } else if (input.kind === "REJECTED") {
        await markServerRejected();
        acceptedEntryId = null;
        newTimes = null;
      } else if (input.kind === "ACCEPT_RECEIVED") {
        if (!received) throw Object.assign(new Error("RECEIVED_PAYLOAD_MISSING"), { code: "22023" });
        await markServerRejected();
        acceptedEntryId = await insertReceived(received);
        if (!acceptedEntryId) throw Object.assign(new Error("RECEIVED_NOT_APPLICABLE"), { code: "22023" });
        newTimes = received;
      } else if (input.kind === "CORRECTED_TIMES") {
        const corrected = input.correctedTimes!;
        const target = input.correctedTarget ?? (serverEntry ? "SERVER" : "RECEIVED");
        if (target === "SERVER" && serverEntry) {
          await client.query(
            `UPDATE public.work_entries
                SET started_at = $3::timestamptz, ended_at = $4::timestamptz, end_state = $5,
                    office_corrected = true, version = version + 1,
                    updated_by = $6, updated_at = clock_timestamp()
              WHERE company_id = $1 AND id = $2`,
            [company, serverEntry.id, corrected.startedAt, corrected.endedAt, corrected.endState, actor.userId],
          );
          acceptedEntryId = serverEntry.id;
        } else {
          if (!received) throw Object.assign(new Error("RECEIVED_PAYLOAD_MISSING"), { code: "22023" });
          await markServerRejected();
          acceptedEntryId = await insertReceived(corrected);
          if (!acceptedEntryId) throw Object.assign(new Error("RECEIVED_NOT_APPLICABLE"), { code: "22023" });
        }
        newTimes = corrected;
      }
      await client.query("RELEASE SAVEPOINT resolution_apply");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT resolution_apply");
      await client.query("RELEASE SAVEPOINT resolution_apply");
      const dbCode = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code) : "";
      const message = error instanceof Error ? error.message : "";
      const code = dbCode === "23P01" || message.includes("WORK_ENTRY_OVERLAP")
        ? "WORK_ENTRY_OVERLAP"
        : message.includes("one_open") ? "WORK_ENTRY_OPEN_EXISTS" : "RESOLUTION_NOT_APPLICABLE";
      return fail({ outcome: "VALIDATION_FAILED", conflictId: input.conflictId, code, oldTimes });
    }

    const devicePayload = buildDeviceResolutionPayload({
      conflictId: conflict.id,
      kind: input.kind,
      reason: input.reason.trim(),
      resolvedByParty,
      workEntryId: conflict.work_entry_id,
      oldTimes,
      newTimes,
      rejectedEntryId,
      acceptedEntryId,
    });

    const updated = await client.query<{ resolved_at: Date }>(
      `UPDATE public.sync_conflicts
          SET status = 'RESOLVED', resolved_by = $3, resolution_reason = $4,
              resolution_kind = $5, internal_note = $6, resolved_by_party = $7,
              resolution_key = $8, resolution_payload = $9::jsonb
        WHERE company_id = $1 AND id = $2 AND status = 'OPEN'
        RETURNING resolved_at`,
      [company, conflict.id, actor.userId, input.reason.trim(), input.kind,
        input.internalNote ?? null, resolvedByParty, input.idempotencyKey, JSON.stringify(devicePayload)],
    );
    const resolvedAt = updated.rows[0]?.resolved_at;

    // Audit u ISTOJ transakciji: ko, šta, kada (resolved_at), razlog, stara i
    // nova vremena, oznaka strane u sukobu. Interna napomena se ne upisuje.
    await writeAudit(client, {
      companyId: toCompanyId(company),
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "workday.conflict_resolved",
      entityType: "sync_conflict",
      entityId: conflict.id,
      metadata: {
        kind: input.kind,
        reason: input.reason.trim(),
        oldTimes,
        newTimes,
        resolvedByParty,
        rejectedEntryId,
        acceptedEntryId,
        resolvedAt: resolvedAt?.toISOString() ?? null,
      },
    });

    // Change-log događaj u istoj transakciji: pull ga isporučuje tačno jednom,
    // a sadržaj je isključivo device-payload (bez interne napomene).
    await client.query(
      `SELECT public.sync_cursor_publish($1, $2::bigint, $3, $4, 'sync_conflict', $5, 2, $6::jsonb, false)`,
      [company, reservation.cursor_seq, reservation.reservation_token, requestHash,
        conflict.id, JSON.stringify(devicePayload)],
    );

    return {
      outcome: "RESOLVED",
      conflictId: conflict.id,
      kind: input.kind,
      resolvedBy: actor.userId,
      resolvedAt: resolvedAt?.toISOString(),
      reason: input.reason.trim(),
      resolvedByParty,
      oldTimes,
      newTimes,
      rejectedEntryId,
      acceptedEntryId,
    };
  });
}

export type ConflictListItem = {
  id: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
  ageDays: number;
  workerName: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  workDate: string | null;
  serverTimes: EntryTimes | null;
  receivedTimes: EntryTimes | null;
  resolutionKind: ResolutionKind | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolvedByParty: boolean;
};

export type ConflictListFilters = {
  status?: "OPEN" | "RESOLVED";
  projectId?: string;
  olderThanDays?: number;
  limit?: number;
  offset?: number;
};

const CONFLICT_SELECT = `
  SELECT conflict.id, conflict.status, conflict.created_at,
         floor(extract(epoch FROM (clock_timestamp() - conflict.created_at)) / 86400)::int AS age_days,
         (w.first_name || ' ' || w.last_name) AS worker_name,
         p.code AS project_code, p.name AS project_name,
         d.work_date::text AS work_date,
         e.started_at AS server_started, e.ended_at AS server_ended, e.end_state AS server_end_state,
         conflict.received_payload,
         conflict.resolution_kind,
         (ru.first_name || ' ' || ru.last_name) AS resolved_by_name,
         conflict.resolved_at, conflict.resolved_by_party,
         e.review_flags AS server_flags,
         conflict.resolution_reason, conflict.internal_note,
         e.kind AS server_kind, e.project_id AS server_project, e.machine_id AS server_machine,
         e.created_at AS server_created, e.worker_id AS server_worker_id,
         (aw.first_name || ' ' || aw.last_name) AS server_author_name,
         (cw.first_name || ' ' || cw.last_name) AS received_author_name,
         m.code AS server_machine_code, m.name AS server_machine_name
    FROM public.sync_conflicts conflict
    LEFT JOIN public.work_entries e
      ON e.company_id = conflict.company_id AND e.id = conflict.work_entry_id
    LEFT JOIN public.workdays d
      ON d.company_id = conflict.company_id AND d.id = e.workday_id
    LEFT JOIN public.workers w ON w.company_id = conflict.company_id AND w.id = e.worker_id
    LEFT JOIN public.projects p
      ON p.company_id = conflict.company_id
     AND p.id = COALESCE(e.project_id, conflict.received_payload->>'projectId')
    LEFT JOIN public.machines m
      ON m.company_id = conflict.company_id AND m.id = e.machine_id
    LEFT JOIN public.users ru ON ru.id = conflict.resolved_by
    LEFT JOIN public.users au ON au.id = e.created_by
    LEFT JOIN public.workers aw ON aw.company_id = conflict.company_id AND aw.user_id = au.id
    LEFT JOIN public.users cu ON cu.id = conflict.actor_id
    LEFT JOIN public.workers cw ON cw.company_id = conflict.company_id AND cw.user_id = cu.id`;

function scopeClause(scope: ReturnType<typeof workdayResolveScopeFor>): string {
  if (scope.kind === "company") return "TRUE";
  if (scope.kind === "assignments") {
    return `(e.worker_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.project_assignments va
        JOIN public.project_assignments ta
          ON ta.company_id = va.company_id AND ta.project_id = va.project_id
       WHERE va.company_id = conflict.company_id AND ta.company_id = conflict.company_id
         AND va.worker_id = $SCOPE AND ta.worker_id = e.worker_id
         AND va.voided_at IS NULL AND ta.voided_at IS NULL))`;
  }
  return "FALSE";
}

type ConflictDbRow = {
  id: string; status: string; created_at: Date; age_days: number;
  worker_name: string | null; project_code: string | null; project_name: string | null;
  work_date: string | null;
  server_started: Date | null; server_ended: Date | null; server_end_state: string | null;
  received_payload: Record<string, unknown> | null;
  resolution_kind: ResolutionKind | null; resolved_by_name: string | null;
  resolved_at: Date | null; resolved_by_party: boolean;
  server_flags: string[] | null; resolution_reason: string | null; internal_note: string | null;
  server_kind: string | null; server_project: string | null; server_machine: string | null;
  server_created: Date | null; server_worker_id: string | null;
  server_author_name: string | null; received_author_name: string | null;
  server_machine_code: string | null; server_machine_name: string | null;
};

function toListItem(row: ConflictDbRow): ConflictListItem {
  return {
    id: row.id,
    status: row.status === "RESOLVED" ? "RESOLVED" : "OPEN",
    createdAt: row.created_at.toISOString(),
    ageDays: row.age_days,
    workerName: row.worker_name ?? row.received_author_name,
    projectId: row.server_project ?? (typeof row.received_payload?.projectId === "string" ? row.received_payload.projectId : null),
    projectCode: row.project_code,
    projectName: row.project_name,
    workDate: row.work_date,
    serverTimes: row.server_started ? {
      startedAt: row.server_started.toISOString(),
      endedAt: row.server_ended?.toISOString() ?? null,
      endState: row.server_end_state ?? "KNOWN_END",
    } : null,
    receivedTimes: receivedTimes(row.received_payload),
    resolutionKind: row.resolution_kind,
    resolvedByName: row.resolved_by_name,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolvedByParty: row.resolved_by_party,
  };
}

export async function listConflicts(
  client: PoolClient,
  companyId: string,
  scope: ReturnType<typeof workdayResolveScopeFor>,
  filters: ConflictListFilters = {},
): Promise<{ conflicts: ConflictListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const scopeSql = scopeClause(scope).replace("$SCOPE", "$2");
  const rows = await client.query<ConflictDbRow>(
    `${CONFLICT_SELECT}
      WHERE conflict.company_id = $1
        AND ${scopeSql}
        AND ($3::text IS NULL OR conflict.status = $3)
        AND ($4::text IS NULL OR COALESCE(e.project_id, conflict.received_payload->>'projectId') = $4)
        AND ($5::int IS NULL OR conflict.created_at < clock_timestamp() - make_interval(days => $5))
      ORDER BY conflict.status, conflict.created_at ASC
      LIMIT $6 OFFSET $7`,
    [companyId, scope.kind === "assignments" ? scope.viewerWorkerId : null,
      filters.status ?? null, filters.projectId ?? null, filters.olderThanDays ?? null, limit, offset],
  );
  const total = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.sync_conflicts conflict
       LEFT JOIN public.work_entries e
         ON e.company_id = conflict.company_id AND e.id = conflict.work_entry_id
      WHERE conflict.company_id = $1
        AND ${scopeSql}
        AND ($3::text IS NULL OR conflict.status = $3)
        AND ($4::text IS NULL OR COALESCE(e.project_id, conflict.received_payload->>'projectId') = $4)
        AND ($5::int IS NULL OR conflict.created_at < clock_timestamp() - make_interval(days => $5))`,
    [companyId, scope.kind === "assignments" ? scope.viewerWorkerId : null,
      filters.status ?? null, filters.projectId ?? null, filters.olderThanDays ?? null],
  );
  return { conflicts: rows.rows.map(toListItem), total: Number(total.rows[0]?.n ?? 0) };
}

export type ConflictDetail = ConflictListItem & {
  reason: string | null;
  /** Samo uredski API (workdays.resolve); nikad se ne šalje uređaju. */
  internalNote: string | null;
  clockSkewMinutes: number | null;
  server: {
    authorName: string | null; source: "server";
    receivedAt: string | null; kind: string | null;
    projectId: string | null; machineLabel: string | null; times: EntryTimes | null;
  } | null;
  received: {
    authorName: string | null; source: "telefon";
    receivedAt: string; kind: string | null;
    projectId: string | null; machineId: string | null; times: EntryTimes | null;
  } | null;
};

export async function getConflictDetail(
  client: PoolClient,
  companyId: string,
  scope: ReturnType<typeof workdayResolveScopeFor>,
  conflictId: string,
): Promise<ConflictDetail | null> {
  const scopeSql = scopeClause(scope).replace("$SCOPE", "$2");
  const rows = await client.query<ConflictDbRow>(
    `${CONFLICT_SELECT}
      WHERE conflict.company_id = $1 AND conflict.id = $3 AND ${scopeSql}`,
    [companyId, scope.kind === "assignments" ? scope.viewerWorkerId : null, conflictId],
  );
  const row = rows.rows[0];
  if (!row) return null;
  const base = toListItem(row);
  const payload = row.received_payload ?? {};
  const skew = typeof payload.deviceClockSkewMinutes === "number"
    ? payload.deviceClockSkewMinutes
    : (row.server_flags ?? []).includes("DEVICE_CLOCK_SKEW") ? 0 : null;
  return {
    ...base,
    reason: row.resolution_reason,
    internalNote: row.internal_note,
    clockSkewMinutes: skew,
    server: row.server_started ? {
      authorName: row.server_author_name,
      source: "server",
      receivedAt: row.server_created?.toISOString() ?? null,
      kind: row.server_kind,
      projectId: row.server_project,
      machineLabel: row.server_machine_code ? `${row.server_machine_code} · ${row.server_machine_name ?? ""}`.trim() : null,
      times: base.serverTimes,
    } : null,
    received: {
      authorName: row.received_author_name,
      source: "telefon",
      receivedAt: row.created_at.toISOString(),
      kind: typeof payload.kind === "string" ? payload.kind : null,
      projectId: typeof payload.projectId === "string" ? payload.projectId : null,
      machineId: typeof payload.machineId === "string" ? payload.machineId : null,
      times: base.receivedTimes,
    },
  };
}
