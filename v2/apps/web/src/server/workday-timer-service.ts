/**
 * Modul 3 — servis radnog vremena: timer, zaboravljen dan, vrsta dana, sedmica, grupna potvrda.
 *
 * Tri stvari koje ovaj servis drži na jednom mjestu:
 *
 *  1. **Timer je idempotentan po `localId`.** Telefon šalje isti događaj više puta (mreža,
 *     retry, dupli tap). Segment nosi `localId` kroz `work_entries.id`, pa drugi `start` vraća
 *     isto stanje umjesto da otvori drugi segment.
 *  2. **Zaboravljen dan se ne zatvara sam.** Prag iz `companies.forgotten_day_hours` samo
 *     obavještava; `UNKNOWN_END` je izričit odgovor radnika i posao za šefa.
 *  3. **Zaokruživanje je po segmentu** (`@gradix/domain` `sumSegmentMinutes`) — servis ne
 *     računa sate ručno, jer bi se pravilo tiho razišlo sa obrascem.
 *
 * Sve pod `withCompany`; svaki upit nosi `company_id` u WHERE (B1).
 */
import type { Pool, PoolClient } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import {
  obligationState,
  forgottenDayOutcome,
  isAbsenceDay,
  safeTimezone,
  sumSegmentMinutes,
  workdayReviewState,
  type DayKind,
  type RoundingMinutes,
  type RoundingMode,
  type WorkdayReviewState,
} from "@gradix/domain";
import { writeAudit } from "./audit";

export type ServiceActor = { userId: string; companyId: CompanyId; roles: readonly string[] };

export type ServiceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; status: number; code: string; message: string };

export type TimerSegment = {
  id: string;
  kind: "WORK" | "BREAK";
  startedAt: string;
  endedAt: string | null;
  endState: "OPEN" | "KNOWN_END" | "UNKNOWN_END";
  projectId: string | null;
  projectName: string | null;
  machineId: string | null;
  machineName: string | null;
  segmentSource: "TIMER" | "MANUAL" | "SYNC";
};

export type TimerDay = {
  id: string;
  workerId: string;
  workDate: string;
  status: "DRAFT" | "SUBMITTED";
  approvalStatus: string;
  dayKind: DayKind;
  absenceNote: string | null;
  assignmentWarning: boolean;
  segments: TimerSegment[];
  minutes: number;
  rawMinutes: number;
  openSegments: number;
  reviewState: WorkdayReviewState;
};

type CompanyPolicy = {
  timezone: string;
  forgottenDayHours: number;
  roundingMinutes: RoundingMinutes;
  roundingMode: RoundingMode;
};

async function companyPolicy(client: PoolClient, companyId: string): Promise<CompanyPolicy> {
  const row = await client.query<{
    timezone: string | null;
    forgotten_day_hours: number;
    rounding_minutes: number;
    rounding_mode: string;
  }>(
    `SELECT timezone, forgotten_day_hours, rounding_minutes, rounding_mode
       FROM companies WHERE id = $1 AND company_id = COALESCE(company_id, $1)`.replace(
      " AND company_id = COALESCE(company_id, $1)",
      "",
    ),
    [companyId],
  );
  const settings = row.rows[0];
  return {
    timezone: safeTimezone(settings?.timezone ?? null),
    forgottenDayHours: Number(settings?.forgotten_day_hours ?? 16),
    roundingMinutes: (Number(settings?.rounding_minutes ?? 0) as RoundingMinutes) ?? 0,
    roundingMode: (settings?.rounding_mode as RoundingMode) ?? "NEAREST",
  };
}

/** Radnikov `workers.id` za prijavljeni nalog; `null` ako nalog nije vezan za radnika. */
export async function workerIdForUser(
  client: PoolClient,
  companyId: string,
  userId: string,
): Promise<string | null> {
  const row = await client.query<{ id: string }>(
    "SELECT id FROM workers WHERE company_id = $1 AND user_id = $2 AND is_active",
    [companyId, userId],
  );
  return row.rows[0]?.id ?? null;
}

function businessDateIn(timezone: string, at: Date): string {
  // `en-CA` daje ISO oblik (gggg-mm-dd) bez ručnog sastavljanja.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

async function loadDay(
  client: PoolClient,
  companyId: string,
  dayId: string,
  policy: CompanyPolicy,
  now: Date,
): Promise<TimerDay | null> {
  return loadDayBy(client, companyId, "id", dayId, policy, now);
}

/** Isti dan, ali tražen po radniku i datumu — za „Moj dan“ gdje se id još ne zna. */
export async function myDayForWorker(
  client: PoolClient,
  companyId: string,
  workerId: string,
  workDate: string,
  now: Date,
): Promise<TimerDay | null> {
  const policy = await companyPolicy(client, companyId);
  return loadDayBy(client, companyId, "worker_date", { workerId, workDate }, policy, now);
}

/**
 * Jedno mjesto za oba načina traženja dana (`id` ili `worker + datum`).
 *
 * Namjerno jedan čitač: prikaz dana mora biti ISTI bez obzira otkud je otvoren, inače bi
 * mobilni ekran i uredski pokazivali različite sate za isti dan.
 */
type DayHeaderRow = {
  id: string;
  worker_id: string;
  work_date: string;
  status: string;
  approval_status: string;
  day_kind: string;
  absence_note: string | null;
  assignment_warning: boolean;
};

const DAY_HEADER_SELECT = `SELECT id, worker_id, work_date, status, approval_status, day_kind, absence_note, assignment_warning
   FROM workdays`;

async function loadDayBy(
  client: PoolClient,
  companyId: string,
  by: "id" | "worker_date",
  key: string | { workerId: string; workDate: string },
  policy: CompanyPolicy,
  now: Date,
): Promise<TimerDay | null> {
  /*
   * Dvije grane, a ne jedan dinamički `WHERE`: `check-tenant-sql` čita TEKST upita i mora u
   * njemu vidjeti `company_id`. Upit sastavljen iz promjenljive bio bi nevidljiv provjeri, pa bi
   * jedina odbrana ostala RLS — a ona je druga linija, ne prva.
   */
  const dayRow =
    by === "id"
      ? await client.query<DayHeaderRow>(
          `${DAY_HEADER_SELECT} WHERE company_id = $1 AND id = $2`,
          [companyId, key],
        )
      : await client.query<DayHeaderRow>(
          `${DAY_HEADER_SELECT} WHERE company_id = $1 AND worker_id = $2 AND work_date = $3`,
          [companyId, (key as { workerId: string }).workerId, (key as { workDate: string }).workDate],
        );
  const day = dayRow.rows[0];
  if (!day) return null;

  const entries = await client.query<{
    id: string;
    kind: "WORK" | "BREAK";
    started_at: Date;
    ended_at: Date | null;
    end_state: "OPEN" | "KNOWN_END" | "UNKNOWN_END";
    project_id: string | null;
    project_name: string | null;
    machine_id: string | null;
    machine_name: string | null;
    segment_source: "TIMER" | "MANUAL" | "SYNC";
  }>(
    `SELECT e.id, e.kind, e.started_at, e.ended_at, e.end_state,
            e.project_id, p.name AS project_name,
            e.machine_id, m.name AS machine_name,
            e.segment_source
       FROM work_entries e
       LEFT JOIN projects p ON p.company_id = e.company_id AND p.id = e.project_id
       LEFT JOIN machines m ON m.company_id = e.company_id AND m.id = e.machine_id
      WHERE e.company_id = $1 AND e.workday_id = $2
      ORDER BY e.started_at, e.id`,
    [companyId, day.id],
  );

  const segments: TimerSegment[] = entries.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    endState: row.end_state,
    projectId: row.project_id,
    projectName: row.project_name,
    machineId: row.machine_id,
    machineName: row.machine_name,
    segmentSource: row.segment_source,
  }));

  // Izostanak nema sate, i to je pravilo, ne posljedica prazne liste: dan sa `day_kind = SICK`
  // koji bi imao segmente je greška u podacima, pa se sate ne prikazuju.
  const dayKind = day.day_kind as DayKind;
  const counted = isAbsenceDay(dayKind)
    ? { minutes: 0, rawMinutes: 0 }
    : (() => {
        const rounded = sumSegmentMinutes(segments, {
          step: policy.roundingMinutes,
          mode: policy.roundingMode,
        });
        const raw = sumSegmentMinutes(segments, { step: 0 });
        return { minutes: rounded.minutes, rawMinutes: raw.minutes };
      })();

  const open = segments.find((segment) => segment.endState === "OPEN");
  const reviewState = workdayReviewState({
    openStartedAt: open?.startedAt ?? null,
    hasUnknownEnd: segments.some((segment) => segment.endState === "UNKNOWN_END"),
    now,
    thresholdHours: policy.forgottenDayHours,
  });

  return {
    id: day.id,
    workerId: day.worker_id,
    workDate: typeof day.work_date === "string" ? day.work_date : String(day.work_date).slice(0, 10),
    status: day.status as "DRAFT" | "SUBMITTED",
    approvalStatus: day.approval_status,
    dayKind,
    absenceNote: day.absence_note,
    assignmentWarning: day.assignment_warning,
    segments,
    minutes: counted.minutes,
    rawMinutes: counted.rawMinutes,
    openSegments: segments.filter((segment) => segment.endState === "OPEN").length,
    reviewState,
  };
}

/** Dodjele radnika koje timer može ponuditi (samo aktivne na današnji datum). */
export async function assignmentsForWorker(
  client: PoolClient,
  companyId: string,
  workerId: string,
): Promise<{
  assignments: { projectId: string; projectName: string; machineId: string | null; machineName: string | null }[];
  hasAssignmentToday: boolean;
}> {
  const rows = await client.query<{
    project_id: string;
    project_name: string;
    machine_id: string | null;
    machine_name: string | null;
  }>(
    `SELECT a.project_id, p.name AS project_name, a.machine_id, m.name AS machine_name
       FROM project_assignments a
       JOIN projects p ON p.company_id = a.company_id AND p.id = a.project_id
       LEFT JOIN machines m ON m.company_id = a.company_id AND m.id = a.machine_id
       JOIN companies c ON c.id = a.company_id
      WHERE a.company_id = $1 AND a.worker_id = $2
        AND a.voided_at IS NULL
        AND a.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
        AND (a.to_date IS NULL OR a.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)
        AND p.status IN ('PLANNED', 'ACTIVE', 'PAUSED')
      ORDER BY p.name, m.name`,
    [companyId, workerId],
  );
  return {
    assignments: rows.rows.map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      machineId: row.machine_id,
      machineName: row.machine_name,
    })),
    hasAssignmentToday: rows.rows.length > 0,
  };
}

/*
 * Nema `canReportFor(actor, workerId)`: radnik za koga se piše dan NIKAD ne dolazi iz zahtjeva,
 * nego iz veze `workers.user_id`. Provjera koja prima `workerId` kao parametar bi bila poziv da
 * se nekome drugom upiše dan — a granica je upravo to što se ne prima.
 */

/**
 * Nahvataj/zatvori današnji dan (kanonski po firmi, radniku i datumu).
 *
 * `INSERT ... ON CONFLICT DO NOTHING` + ponovno čitanje: dva paralelna `start` zahtjeva ne
 * smiju pasti na unique indeksu `workdays_one_canonical_day`.
 */
async function ensureDay(
  client: PoolClient,
  companyId: string,
  workerId: string,
  workDate: string,
  actorId: string,
): Promise<string> {
  await client.query(
    `INSERT INTO workdays (id, company_id, worker_id, work_date, created_by, updated_by)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $4)
     ON CONFLICT (company_id, worker_id, work_date) DO NOTHING`,
    [companyId, workerId, workDate, actorId],
  );
  const row = await client.query<{ id: string }>(
    "SELECT id FROM workdays WHERE company_id = $1 AND worker_id = $2 AND work_date = $3",
    [companyId, workerId, workDate],
  );
  return row.rows[0]!.id;
}

export type TimerInput = {
  action: "start" | "pause" | "resume" | "finish";
  localId?: string;
  projectId?: string | null;
  machineId?: string | null;
  at?: string;
  tzOffsetMinutes?: number;
  note?: string | null;
};

/**
 * Jedna akcija timera. Vraća stanje dana i crvenu traku (`blockers`), nikad blokadu.
 *
 * `start`/`resume` otvaraju `WORK` segment; `pause` zatvara tekući `WORK` i otvara `BREAK`
 * (pauza ne nosi projekat, po CHECK-u u bazi); `finish` zatvara sve otvorene segmente.
 */
export async function applyTimer(
  pool: Pool,
  actor: ServiceActor,
  input: TimerInput,
  now = new Date(),
): Promise<ServiceResult<{ day: TimerDay; blockers: Blocker[] }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const policy = await companyPolicy(client, actor.companyId);
    const workerId = await workerIdForUser(client, actor.companyId, actor.userId);
    if (!workerId) {
      return {
        ok: false as const,
        status: 403,
        code: "FORBIDDEN",
        message: "Nalog nije vezan za radnika, pa nema radnog dana za prijavu.",
      };
    }

    const workDate = businessDateIn(policy.timezone, input.at ? new Date(input.at) : now);
    const dayId = await ensureDay(client, actor.companyId, workerId, workDate, actor.userId);

    // Idempotencija: isti `localId` je već obrađen → vraćamo stanje, bez nove promjene.
    if (input.localId) {
      const seen = await client.query<{ id: string }>(
        "SELECT id FROM work_entries WHERE company_id = $1 AND id = $2",
        [actor.companyId, input.localId],
      );
      if ((seen.rowCount ?? 0) > 0) {
        const day = await loadDay(client, actor.companyId, dayId, policy, now);
        return { ok: true as const, day: day!, blockers: await blockersFor(client, actor.companyId, workerId) };
      }
    }

    const open = await client.query<{ id: string; kind: "WORK" | "BREAK"; started_at: Date; project_id: string | null }>(
      `SELECT id, kind, started_at, project_id FROM work_entries
        WHERE company_id = $1 AND worker_id = $2 AND end_state = 'OPEN'
        ORDER BY started_at DESC LIMIT 1`,
      [actor.companyId, workerId],
    );
    const current = open.rows[0] ?? null;

    if (input.action === "start" || input.action === "resume") {
      if (current?.kind === "WORK") {
        return {
          ok: false as const,
          status: 409,
          code: "WORKDAY_ALREADY_OPEN",
          message: "Dan je već otvoren. Završite tekući segment ili pritisnite „Pauza“.",
        };
      }
      const { assignments, hasAssignmentToday } = await assignmentsForWorker(client, actor.companyId, workerId);

      // Pauza se zatvara prije nego što se otvori novi rad: `finish`-ana pauza nije posao.
      if (current?.kind === "BREAK") {
        await client.query(
          `UPDATE work_entries SET ended_at = $3, end_state = 'KNOWN_END', updated_by = $4, updated_at = clock_timestamp()
            WHERE company_id = $1 AND id = $2`,
          [actor.companyId, current.id, input.at ?? now.toISOString(), actor.userId],
        );
      }

      let projectId = input.projectId ?? null;
      let machineId = input.machineId ?? null;
      if (!projectId) {
        // Jedna dodjela → ne pitaj ništa (spec 03 §1.1.2). Više njih → klijent mora poslati izbor.
        const uniqueProjects = [...new Set(assignments.map((a) => a.projectId))];
        if (uniqueProjects.length === 1) {
          projectId = uniqueProjects[0]!;
          const match = assignments.find((a) => a.projectId === projectId);
          machineId = machineId ?? match?.machineId ?? null;
        } else if (uniqueProjects.length > 1) {
          return {
            ok: false as const,
            status: 400,
            code: "VALIDATION_FAILED",
            message: "Imate više dodjela — izaberite projekat prije početka rada.",
          };
        } else {
          return {
            ok: false as const,
            status: 400,
            code: "VALIDATION_FAILED",
            message: "Danas nemate aktivnu dodjelu na projektu, pa nema šta da se počne.",
          };
        }
      }

      const entryId = input.localId ?? `we_${globalThis.crypto.randomUUID()}`;
      await client.query(
        `INSERT INTO work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, end_state, project_id, machine_id,
            note, segment_source, tz_offset_minutes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'WORK', $5, 'OPEN', $6, $7, $8, 'TIMER', $9, $10, $10)`,
        [
          entryId,
          actor.companyId,
          dayId,
          workerId,
          input.at ?? now.toISOString(),
          projectId,
          machineId,
          input.note ?? null,
          input.tzOffsetMinutes ?? null,
          actor.userId,
        ],
      );
      // Rad bez važeće dodjele: upozorenje u zapisu, ne blokada (spec 03 §1.6.25).
      if (!hasAssignmentToday) {
        await client.query(
          "UPDATE workdays SET assignment_warning = true, updated_at = clock_timestamp() WHERE company_id = $1 AND id = $2",
          [actor.companyId, dayId],
        );
      }
    } else if (input.action === "pause") {
      if (!current || current.kind !== "WORK") {
        return {
          ok: false as const,
          status: 409,
          code: "WORKDAY_ALREADY_OPEN",
          message: "Nema otvorenog rada za pauzu.",
        };
      }
      const at = input.at ?? now.toISOString();
      await client.query(
        `UPDATE work_entries SET ended_at = $3, end_state = 'KNOWN_END', updated_by = $4, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [actor.companyId, current.id, at, actor.userId],
      );
      await client.query(
        `INSERT INTO work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, end_state, segment_source, tz_offset_minutes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'BREAK', $5, 'OPEN', 'TIMER', $6, $7, $7)`,
        [`we_${globalThis.crypto.randomUUID()}`, actor.companyId, dayId, workerId, at, input.tzOffsetMinutes ?? null, actor.userId],
      );
    } else {
      // finish: zatvaraju se SVI otvoreni segmenti (i rad i pauza).
      const at = input.at ?? now.toISOString();
      const closed = await client.query(
        `UPDATE work_entries SET ended_at = $3, end_state = 'KNOWN_END', updated_by = $4, updated_at = clock_timestamp()
          WHERE company_id = $1 AND worker_id = $2 AND end_state = 'OPEN'`,
        [actor.companyId, workerId, at, actor.userId],
      );
      if ((closed.rowCount ?? 0) === 0) {
        return {
          ok: false as const,
          status: 409,
          code: "WORKDAY_ALREADY_OPEN",
          message: "Nema otvorenog segmenta za završetak.",
        };
      }
    }

    await client.query(
      `UPDATE workdays SET header_version = header_version + 1, updated_by = $3, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, dayId, actor.userId],
    );

    const day = await loadDay(client, actor.companyId, dayId, policy, now);
    return { ok: true as const, day: day!, blockers: await blockersFor(client, actor.companyId, workerId) };
  });
}

export type Blocker = { typeId: string; typeLabel: string; state: string; message: string };

/**
 * Crvena traka iz `canUseEntity` (spec 03 §1.6.28): samo obavještava.
 *
 * Namjerno ne vraća grešku i ne blokira prijavu dana — radnik koji je fizički na gradilištu
 * mora moći da upiše sate i kad mu je ljekarski istekao. Ured vidi isto i rješava.
 */
export async function blockersFor(
  client: PoolClient,
  companyId: string,
  workerId: string,
): Promise<Blocker[]> {
  const rows = await client.query<{
    type_id: string;
    label: string;
    expires_at: string | null;
    review_at: string | null;
    reminder_days: number[] | null;
    review_state: string | null;
    superseded: boolean;
  }>(
    `SELECT o.type_id, t.label, o.expires_at::text AS expires_at, o.review_at::text AS review_at,
            o.reminder_days, o.review_state, (o.superseded_by IS NOT NULL) AS superseded
       FROM obligations o
       JOIN obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
      WHERE o.company_id = $1 AND o.worker_id = $2`,
    [companyId, workerId],
  );

  // Ista formula kao `obligation_state()` u bazi, kroz domenu — nikad druga kopija pravila.
  const today = new Date().toISOString().slice(0, 10);
  return rows.rows
    .map((row) => ({
      row,
      state: obligationState({
        expiresAt: row.expires_at,
        reviewAt: row.review_at,
        thresholds: row.reminder_days ?? [],
        reviewState: (row.review_state as "none" | "pending_review" | "rejected" | null) ?? "none",
        superseded: row.superseded,
        today,
      }),
    }))
    .filter(({ state }) => state === "expired" || state === "rejected")
    .map(({ row, state }) => ({
      typeId: row.type_id,
      typeLabel: row.label,
      state,
      message:
        state === "rejected"
          ? `${row.label}: dokument je odbijen. Ured ga mora ponovo provjeriti.`
          : `${row.label}: rok je istekao. Ured treba da ga obnovi.`,
    }));
}

// ---------------------------------------------------------------------------
// Zaboravljen dan
// ---------------------------------------------------------------------------

export type CloseForgottenInput = {
  kind: "TIME" | "LAST_PING" | "UNKNOWN";
  endedAt?: string;
  lastPingAt?: string;
  note?: string | null;
};

/**
 * Zatvaranje zaboravljenog dana (spec 03 §1.2.8–9).
 *
 * `UNKNOWN` NE izmišlja vrijeme: segment ide u `UNKNOWN_END`, dan postaje „za provjeru" i to
 * je posao za šefa. Bolje priznati da se ne zna nego upisati osam sati koje niko nije radio.
 */
export async function closeForgottenDay(
  pool: Pool,
  actor: ServiceActor,
  input: CloseForgottenInput,
  now = new Date(),
): Promise<ServiceResult<{ day: TimerDay; blockers: Blocker[] }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const policy = await companyPolicy(client, actor.companyId);
    const workerId = await workerIdForUser(client, actor.companyId, actor.userId);
    if (!workerId) {
      return { ok: false as const, status: 403, code: "FORBIDDEN", message: "Nalog nije vezan za radnika." };
    }

    const open = await client.query<{ id: string; workday_id: string; started_at: Date }>(
      `SELECT id, workday_id, started_at FROM work_entries
        WHERE company_id = $1 AND worker_id = $2 AND end_state = 'OPEN'
        ORDER BY started_at ASC LIMIT 1`,
      [actor.companyId, workerId],
    );
    const segment = open.rows[0];
    if (!segment) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Nema otvorenog dana za zatvaranje." };
    }

    const outcome = forgottenDayOutcome({
      kind: input.kind,
      startedAt: segment.started_at.toISOString(),
      endedAt: input.endedAt ?? null,
      lastPingAt: input.lastPingAt ?? null,
    });
    if ("error" in outcome) {
      return { ok: false as const, status: 400, code: "VALIDATION_FAILED", message: outcome.error };
    }

    await client.query(
      `UPDATE work_entries
          SET ended_at = $3, end_state = $4, note = COALESCE($5, note), updated_by = $6, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, segment.id, outcome.endedAt, outcome.endState, input.note ?? null, actor.userId],
    );

    if (outcome.endState === "UNKNOWN_END") {
      await writeAudit(client, {
        companyId: actor.companyId,
        actorId: actor.userId,
        actorEmail: null,
        action: "workday.unknown_end",
        entityType: "workday",
        entityId: segment.workday_id,
        metadata: { segmentId: segment.id, kind: input.kind },
      });
    }

    const day = await loadDay(client, actor.companyId, segment.workday_id, policy, now);
    return { ok: true as const, day: day!, blockers: await blockersFor(client, actor.companyId, workerId) };
  });
}

// ---------------------------------------------------------------------------
// Vrsta dana (izostanak)
// ---------------------------------------------------------------------------

/**
 * Promjena vrste dana.
 *
 * Izostanak je **dan bez vremena** (spec 03 §1.3.14): kad dan prelazi u izostanak, otvoreni
 * segmenti se odbijaju, a ne tiho brišu — brisanje bi izgubilo dokaz da je radnik tog dana
 * ipak nešto radio, a to je tačno slučaj koji ured mora vidjeti.
 */
export async function setDayKind(
  pool: Pool,
  actor: ServiceActor,
  dayId: string,
  input: { dayKind: DayKind; absenceNote?: string; reason?: string },
  now = new Date(),
): Promise<ServiceResult<{ day: TimerDay; blockers: Blocker[] }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const policy = await companyPolicy(client, actor.companyId);
    const day = await client.query<{ id: string; worker_id: string; day_kind: string; approval_status: string }>(
      "SELECT id, worker_id, day_kind, approval_status FROM workdays WHERE company_id = $1 AND id = $2",
      [actor.companyId, dayId],
    );
    const row = day.rows[0];
    if (!row) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Radni dan ne postoji." };
    }
    if (row.approval_status === "LOCKED") {
      return {
        ok: false as const,
        status: 422,
        code: "WORKDAY_LOCKED",
        message: "Zaključan dan se mijenja samo revizijom, ne izmjenom vrste dana.",
      };
    }

    const absence = isAbsenceDay(input.dayKind);
    if (absence && !input.absenceNote?.trim()) {
      return {
        ok: false as const,
        status: 400,
        code: "VALIDATION_FAILED",
        message: "Izostanak traži napomenu (npr. „bolovanje do 25.11.“).",
      };
    }
    if (row.day_kind !== input.dayKind && !input.reason?.trim()) {
      // Ispravka već upisane vrste dana je revizija; bez razloga se ne može objasniti.
      return {
        ok: false as const,
        status: 400,
        code: "VALIDATION_FAILED",
        message: "Izmjena već upisane vrste dana traži razlog.",
      };
    }

    if (absence) {
      const open = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM work_entries
          WHERE company_id = $1 AND workday_id = $2 AND end_state = 'OPEN'`,
        [actor.companyId, dayId],
      );
      if (Number(open.rows[0]?.n ?? 0) > 0) {
        return {
          ok: false as const,
          status: 409,
          code: "CONFLICT",
          message: "Dan ima otvoren segment. Završite ga prije nego dan proglasite izostankom.",
        };
      }
    }

    await client.query(
      `UPDATE workdays
          SET day_kind = $3, absence_note = $4, updated_by = $5,
              header_version = header_version + 1, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, dayId, input.dayKind, absence ? input.absenceNote!.trim() : null, actor.userId],
    );

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "workday.kind_changed",
      entityType: "workday",
      entityId: dayId,
      metadata: { from: row.day_kind, to: input.dayKind, reason: input.reason ?? null },
    });

    const loaded = await loadDay(client, actor.companyId, dayId, policy, now);
    return { ok: true as const, day: loaded!, blockers: await blockersFor(client, actor.companyId, row.worker_id) };
  });
}

// ---------------------------------------------------------------------------
// Sedmični pregled i grupna potvrda
// ---------------------------------------------------------------------------

function weekBounds(weekStart: string): { start: string; end: string } {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: weekStart, end: end.toISOString().slice(0, 10) };
}

export type WeekView = {
  weekStart: string;
  weekEnd: string;
  rows: {
    workerId: string;
    workerName: string;
    days: Record<
      string,
      {
        workdayId: string | null;
        minutes: number;
        dayKind: DayKind;
        approvalStatus: string;
        reviewState: WorkdayReviewState;
      }
    >;
    totalMinutes: number;
  }[];
  totals: { minutes: number; byDayKind: Record<string, number> };
  openConflicts: number;
};

/**
 * Sedmični pregled: tabela radnik × dan, sa sumama (spec 03 §1.5.22).
 *
 * Dani bez zapisa se NE izostavljaju iz reda — prazna ćelija je podatak („tog dana nema
 * ničega"), a izostavljanje bi izgledalo isto kao dan sa nulom.
 */
export async function weekView(
  pool: Pool,
  actor: ServiceActor,
  weekStart: string,
  options: { workerIds?: readonly string[] | null } = {},
): Promise<ServiceResult<{ week: WeekView }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return { ok: false as const, status: 400, code: "VALIDATION_FAILED", message: "weekStart mora biti gggg-mm-dd." };
  }
  const { start, end } = weekBounds(weekStart);

  return withCompany(pool, actor.companyId, async (client) => {
    const policy = await companyPolicy(client, actor.companyId);
    const scope = options.workerIds && options.workerIds.length > 0 ? [...options.workerIds] : null;

    const workers = await client.query<{ id: string; first_name: string; last_name: string }>(
      `SELECT w.id, w.first_name, w.last_name
         FROM workers w
        WHERE w.company_id = $1 AND w.ended_at IS NULL
          AND ($2::text[] IS NULL OR w.id = ANY($2::text[]))
        ORDER BY w.last_name, w.first_name`,
      [actor.companyId, scope],
    );

    const days = await client.query<{
      id: string;
      worker_id: string;
      work_date: string;
      day_kind: string;
      approval_status: string;
      unknown_end: string;
      open_started_at: Date | null;
      minutes: string;
      raw_minutes: string;
    }>(
      `SELECT d.id, d.worker_id, d.work_date::text AS work_date, d.day_kind, d.approval_status,
              (SELECT count(*)::text FROM work_entries e
                WHERE e.company_id = d.company_id AND e.workday_id = d.id AND e.end_state = 'UNKNOWN_END') AS unknown_end,
              (SELECT min(e.started_at) FROM work_entries e
                WHERE e.company_id = d.company_id AND e.workday_id = d.id AND e.end_state = 'OPEN') AS open_started_at,
              (SELECT count(*)::text FROM work_entries e
                WHERE e.company_id = d.company_id AND e.workday_id = d.id AND e.end_state = 'KNOWN_END') AS minutes,
              '0' AS raw_minutes
         FROM workdays d
        WHERE d.company_id = $1 AND d.work_date BETWEEN $2 AND $3
        ORDER BY d.work_date`,
      [actor.companyId, start, end],
    );

    // Zbir segmenata po danu računa DOMENA (zaokruživanje po segmentu), ne SQL — pravilo mora
    // biti jedno. Zato se segmenti čitaju gruppo, a ne po danu.
    const segments = await client.query<{
      workday_id: string;
      started_at: Date;
      ended_at: Date | null;
    }>(
      `SELECT e.workday_id, e.started_at, e.ended_at
         FROM work_entries e
         JOIN workdays d ON d.company_id = e.company_id AND d.id = e.workday_id
        WHERE e.company_id = $1 AND d.work_date BETWEEN $2 AND $3`,
      [actor.companyId, start, end],
    );

    const byDay = new Map<string, { startedAt: string; endedAt: string | null }[]>();
    for (const segment of segments.rows) {
      const list = byDay.get(segment.workday_id) ?? [];
      list.push({ startedAt: segment.started_at.toISOString(), endedAt: segment.ended_at?.toISOString() ?? null });
      byDay.set(segment.workday_id, list);
    }

    const timezone = policy.timezone;
    const now = new Date();
    const rows = workers.rows.map((worker) => {
      const daysForWorker: WeekView["rows"][number]["days"] = {};
      let total = 0;
      for (const day of days.rows.filter((entry) => entry.worker_id === worker.id)) {
        const daySegments = byDay.get(day.id) ?? [];
        const dayKind = day.day_kind as DayKind;
        const counted = isAbsenceDay(dayKind)
          ? { minutes: 0 }
          : { minutes: sumSegmentMinutes(daySegments, { step: policy.roundingMinutes, mode: policy.roundingMode }).minutes };
        const open = daySegments.find((segment) => segment.endedAt === null);
        const reviewState = workdayReviewState({
          openStartedAt: open?.startedAt ?? null,
          hasUnknownEnd: Number(day.unknown_end) > 0,
          now,
          thresholdHours: policy.forgottenDayHours,
        });
        daysForWorker[day.work_date] = {
          workdayId: day.id,
          minutes: counted.minutes,
          dayKind,
          approvalStatus: day.approval_status,
          reviewState,
        };
        total += counted.minutes;
      }
      return {
        workerId: worker.id,
        workerName: `${worker.first_name} ${worker.last_name}`.trim(),
        days: daysForWorker,
        totalMinutes: total,
      };
    });

    const byDayKind: Record<string, number> = {};
    for (const row of rows) {
      for (const day of Object.values(row.days)) {
        byDayKind[day.dayKind] = (byDayKind[day.dayKind] ?? 0) + day.minutes;
      }
    }

    const conflicts = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sync_conflicts
        WHERE company_id = $1 AND status = 'OPEN' AND created_at >= $2::date AND created_at < ($3::date + 1)`,
      [actor.companyId, start, end],
    );

    void timezone; // zona je već primijenjena na datume kroz `work_date`, koja je kalendarski dan
    return {
      ok: true as const,
      week: {
        weekStart: start,
        weekEnd: end,
        rows,
        totals: { minutes: rows.reduce((sum, row) => sum + row.totalMinutes, 0), byDayKind },
        openConflicts: Number(conflicts.rows[0]?.n ?? 0),
      },
    };
  });
}

/**
 * Grupna potvrda šefa za projekat + datum (spec 03 §1.5.21).
 *
 * Potvrđuje SAMO dane radnika koji na taj datum imaju dodjelu na tom projektu. Tuđi dan nije
 * dirnut — ni slučajno, jer bi jedan klik inače potvrdio sate cijele firme.
 */
export async function bulkConfirm(
  pool: Pool,
  actor: ServiceActor,
  input: { projectId: string; workDate: string; workerIds?: string[] },
): Promise<ServiceResult<{ confirmed: number; skipped: { workerId: string; workerName: string; reason: string }[] }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const assigned = await client.query<{ worker_id: string; name: string }>(
      `SELECT a.worker_id, (w.first_name || ' ' || w.last_name) AS name
         FROM project_assignments a
         JOIN workers w ON w.company_id = a.company_id AND w.id = a.worker_id
        WHERE a.company_id = $1 AND a.project_id = $2
          AND a.voided_at IS NULL
          AND a.from_date <= $3::date
          AND (a.to_date IS NULL OR a.to_date >= $3::date)
          AND ($4::text[] IS NULL OR a.worker_id = ANY($4::text[]))`,
      [actor.companyId, input.projectId, input.workDate, input.workerIds?.length ? input.workerIds : null],
    );

    let confirmed = 0;
    const skipped: { workerId: string; workerName: string; reason: string }[] = [];

    for (const row of assigned.rows) {
      const day = await client.query<{ id: string; approval_status: string }>(
        "SELECT id, approval_status FROM workdays WHERE company_id = $1 AND worker_id = $2 AND work_date = $3",
        [actor.companyId, row.worker_id, input.workDate],
      );
      const existing = day.rows[0];
      if (!existing) {
        skipped.push({ workerId: row.worker_id, workerName: row.name, reason: "Nema radnog dana za taj datum." });
        continue;
      }
      if (existing.approval_status !== "SUBMITTED") {
        skipped.push({
          workerId: row.worker_id,
          workerName: row.name,
          reason:
            existing.approval_status === "FOREMAN_CONFIRMED"
              ? "Dan je već potvrđen."
              : "Dan nije predan, pa se ne može potvrditi.",
        });
        continue;
      }
      await client.query(
        `UPDATE workdays SET approval_status = 'FOREMAN_CONFIRMED', updated_by = $3, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [actor.companyId, existing.id, actor.userId],
      );
      confirmed += 1;
    }

    if (confirmed > 0) {
      await writeAudit(client, {
        companyId: actor.companyId,
        actorId: actor.userId,
        actorEmail: null,
        action: "workday.bulk_confirmed",
        entityType: "project",
        entityId: input.projectId,
        metadata: { workDate: input.workDate, confirmed, skipped: skipped.length },
      });
    }

    return { ok: true as const, confirmed, skipped };
  });
}
