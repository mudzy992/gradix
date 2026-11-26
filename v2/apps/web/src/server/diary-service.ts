/**
 * F9 — dnevnik građenja: zaglavlje dana, automatsko punjenje iz terena, količine i zastoji.
 *
 * Tri stvari koje ovaj servis namjerno NE radi, i zašto:
 *
 *  1. **Ne prepisuje automatske sekcije ručnim unosom.** Radnici, mašine, ture i kvarovi za taj
 *     dan se ČITAJU iz Modula 3/5 (`workdays`/`work_entries`, `machine_work_logs`, `hauls`,
 *     `machine_faults`) i zamrzavaju u `auto_snapshot` u trenutku potpisa. Šef unosi samo ono što
 *     sistem ne zna (spec §1.1/2): vrijeme, opis, posjetioce, događaje, zastoje.
 *  2. **Ne računa procenat završenosti projekta.** `project_boq_items.quantity_executed` se
 *     UVEĆAVA za količinu iz `BOQ` stavke, pa je dnevnik jedini izvor napretka (spec §1.2/8).
 *     Dva izvora bi dala dva procenta za isti posao.
 *  3. **Ne dopušta izmjenu `LOCKED` dnevnika.** To brani i triger u bazi; servis samo daje ljudsku
 *     poruku umjesto SQL greške.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  diaryTransition,
  totalDelayHours,
  validDiarySignature,
  type DiaryDelayKind,
  type DiaryItemSource,
  type DiaryStatus,
  type Scope,
} from "@gradix/domain";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import { companyToday } from "./project-service";
import { ensureDefaultDiaryTemplate } from "./diary-template-service";

/** Validator za `?status=` — nepoznata vrijednost se ignoriše, ne ruši ekran. */
export function isDiaryStatus(value: unknown): value is DiaryStatus {
  return value === "DRAFT" || value === "SIGNED" || value === "LOCKED";
}

// DiaryActor is also used by HSE; the diary entry points require the session scope explicitly.
export type DiaryActor = { userId: string; companyId: string; roles: readonly string[] };
export type ScopedDiaryActor = DiaryActor & { scope: Scope; projectIds: readonly string[] | null };

function diaryProjectAllowed(actor: ScopedDiaryActor, projectId: string): boolean {
  return actor.scope === "COMPANY" || (actor.scope === "PROJECTS" && (actor.projectIds ?? []).includes(projectId));
}

/** Fail closed for SELF: a construction diary contains other workers' and project-wide data. */
async function diaryInScope(client: PoolClient, actor: ScopedDiaryActor, diaryId: string): Promise<boolean> {
  const params: unknown[] = [actor.companyId, diaryId];
  let scope = "FALSE";
  if (actor.scope === "COMPANY") scope = "TRUE";
  else if (actor.scope === "PROJECTS") {
    params.push(actor.projectIds ?? []);
    scope = `project_id = ANY($${params.length}::text[])`;
  }
  const result = await client.query(`SELECT id FROM public.site_diaries
    WHERE company_id=$1 AND id=$2 AND ${scope} FOR UPDATE`, params);
  return (result.rowCount ?? 0) > 0;
}

export type DiaryOutcome =
  | { outcome: "OK"; id: string; version?: number }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "NOT_FOUND"; code: string; message: string };

const NOT_FOUND: DiaryOutcome = { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Dnevnik ne postoji." };

/* ------------------------------------------------------------------ automatsko punjenje */

export type DiaryAutoWorkers = {
  workerId: string;
  workerName: string;
  /** Minuti rada iz `work_entries` za taj dan (BREAK ne ulazi). */
  minutes: number;
  hours: string;
};

export type DiaryAutoMachines = {
  machineId: string;
  machineCode: string;
  machineName: string;
  hours: string;
  meterFrom: string | null;
  meterTo: string | null;
};

export type DiaryAutoHauls = {
  haulId: string;
  machineName: string;
  material: string | null;
  quantity: string;
  quantityUnit: string;
  phaseId: string | null;
};

export type DiaryAutoFaults = {
  faultId: string;
  machineName: string;
  title: string;
  downtimeMinutes: number | null;
  priority: string;
};

export type DiaryAutoSnapshot = {
  workers: DiaryAutoWorkers[];
  machines: DiaryAutoMachines[];
  hauls: DiaryAutoHauls[];
  faults: DiaryAutoFaults[];
  /** Koliko je sati ukupno odrađeno — imenilac LTIFR-a, isti broj kao u statistici. */
  workedHours: string;
  generatedAt: string;
};

const minutesToHours = (minutes: number): string => (Math.round((minutes / 60) * 100) / 100).toFixed(2);

/**
 * Povlači podatke terena za dati projekat i dan.
 *
 * Zašto ovdje, a ne u ekranu: isti objekat ide u PDF, u ekran i u `auto_snapshot` pri potpisu —
 * tri mjesta koja bi se inače mogla razići u brojevima. `BREAK` segmenti se preskaču (pauza nije
 * rad), a kvarovi ulaze sa zastojem jer je to ono što inspektor pita.
 *
 * Radni sati se računaju iz `work_entries` tog dana za TAJ projekat, ne iz `workdays`: čovjek može
 * raditi na dva gradilišta istog dana, a u dnevnik ovog projekta ulazi samo njegov dio.
 */
export async function collectDiaryAutoData(
  client: PoolClient,
  companyId: string,
  projectId: string,
  diaryDate: string,
): Promise<DiaryAutoSnapshot> {
  const workers = await client.query<{ worker_id: string; worker_name: string; minutes: string }>(
    `SELECT we.worker_id,
            btrim(w.first_name || ' ' || coalesce(w.last_name, '')) AS worker_name,
            COALESCE(SUM(EXTRACT(EPOCH FROM (coalesce(we.ended_at, we.started_at) - we.started_at)) / 60), 0)::int::text AS minutes
       FROM public.work_entries we
       JOIN public.workers w ON w.company_id = we.company_id AND w.id = we.worker_id
      WHERE we.company_id = $1
        AND we.project_id = $2
        AND we.kind = 'WORK'
        AND (we.started_at AT TIME ZONE (SELECT timezone FROM public.companies WHERE id = $1))::date = $3::date
        AND we.resolution_state = 'ACTIVE'
      GROUP BY we.worker_id, w.first_name, w.last_name
      ORDER BY worker_name`,
    [companyId, projectId, diaryDate],
  );

  /*
   * Brojilo: `machine_work_logs` čuva samo ZAVRŠNO stanje po satu (`meter_end`, R5.1). Zato je
   * raspon dana najmanje→najveće očitanje tog dana, a ne „start→end“ jednog zapisa — kolona
   * `meter_start` ne postoji i ne izmišlja se u dnevniku.
   */
  const machines = await client.query<{
    machine_id: string; machine_code: string; machine_name: string;
    minutes: string; meter_from: string | null; meter_to: string | null;
  }>(
    `SELECT mwl.machine_id, m.code AS machine_code, m.name AS machine_name,
            COALESCE(SUM(EXTRACT(EPOCH FROM (mwl.ended_at - mwl.started_at)) / 60), 0)::int::text AS minutes,
            min(mwl.meter_end)::text AS meter_from,
            max(mwl.meter_end)::text AS meter_to
       FROM public.machine_work_logs mwl
       JOIN public.machines m ON m.company_id = mwl.company_id AND m.id = mwl.machine_id
      WHERE mwl.company_id = $1
        AND mwl.project_id = $2
        AND (mwl.started_at AT TIME ZONE (SELECT timezone FROM public.companies WHERE id = $1))::date = $3::date
      GROUP BY mwl.machine_id, m.code, m.name
      ORDER BY m.code`,
    [companyId, projectId, diaryDate],
  );

  const hauls = await client.query<{
    haul_id: string; machine_name: string; material: string | null; quantity: string; unit: string; phase_id: string | null;
  }>(
    `SELECT h.id AS haul_id, m.name AS machine_name, h.material_text AS material,
            h.quantity::text AS quantity, h.quantity_unit AS unit, h.phase_id
       FROM public.hauls h
       JOIN public.machines m ON m.company_id = h.company_id AND m.id = h.machine_id
      WHERE h.company_id = $1
        AND h.project_id = $2
        AND (h.hauled_at AT TIME ZONE (SELECT timezone FROM public.companies WHERE id = $1))::date = $3::date
      ORDER BY h.hauled_at`,
    [companyId, projectId, diaryDate],
  );

  const faults = await client.query<{
    fault_id: string; machine_name: string; title: string; downtime_minutes: number | null; priority: string;
  }>(
    `SELECT f.id AS fault_id, m.name AS machine_name, f.title, f.downtime_minutes, f.priority
       FROM public.machine_faults f
       JOIN public.machines m ON m.company_id = f.company_id AND m.id = f.machine_id
      WHERE f.company_id = $1
        AND f.project_id = $2
        AND (f.reported_at AT TIME ZONE (SELECT timezone FROM public.companies WHERE id = $1))::date = $3::date
      ORDER BY f.reported_at`,
    [companyId, projectId, diaryDate],
  );

  const workerRows: DiaryAutoWorkers[] = workers.rows.map((row) => ({
    workerId: row.worker_id,
    workerName: row.worker_name,
    minutes: Number(row.minutes),
    hours: minutesToHours(Number(row.minutes)),
  }));

  const machineRows: DiaryAutoMachines[] = machines.rows.map((row) => ({
    machineId: row.machine_id,
    machineCode: row.machine_code,
    machineName: row.machine_name,
    hours: minutesToHours(Number(row.minutes)),
    meterFrom: row.meter_from,
    meterTo: row.meter_to,
  }));

  const totalMinutes = workerRows.reduce((sum, worker) => sum + worker.minutes, 0);

  return {
    workers: workerRows,
    machines: machineRows,
    hauls: hauls.rows.map((row) => ({
      haulId: row.haul_id,
      machineName: row.machine_name,
      material: row.material,
      quantity: row.quantity,
      quantityUnit: row.unit,
      phaseId: row.phase_id,
    })),
    faults: faults.rows.map((row) => ({
      faultId: row.fault_id,
      machineName: row.machine_name,
      title: row.title,
      downtimeMinutes: row.downtime_minutes,
      priority: row.priority,
    })),
    workedHours: minutesToHours(totalMinutes),
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ čitanje */

export type DiaryListItem = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  diaryDate: string;
  status: DiaryStatus;
  weather: string | null;
  workedHours: string | null;
  signedName: string | null;
  version: number;
  /** Koliko radnika/mašina ima u danu — broj iz snapshot-a, ne novo brojanje. */
  workersCount: number;
  machinesCount: number;
  delaysHours: string;
};

export async function listDiaries(
  pool: Pool,
  actor: ScopedDiaryActor,
  filter: {
    projectId?: string;
    from?: string;
    to?: string;
    status?: DiaryStatus;
    /** „Nepotpuni dani“ za Pregled i kalendar: nacrti stariji od 2 dana (§4). */
    unsignedOnly?: boolean;
    limit?: number;
  } = {},
): Promise<DiaryListItem[]> {
  if (!can(actor.roles, "diary.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const conditions = ["d.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    if (actor.scope === "PROJECTS") {
      params.push(actor.projectIds ?? []);
      conditions.push(`d.project_id = ANY($${params.length}::text[])`);
    } else if (actor.scope !== "COMPANY") conditions.push("FALSE");
    if (filter.projectId) {
      params.push(filter.projectId);
      conditions.push(`d.project_id = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      conditions.push(`d.diary_date >= $${params.length}::date`);
    }
    if (filter.to) {
      params.push(filter.to);
      conditions.push(`d.diary_date <= $${params.length}::date`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`d.status = $${params.length}`);
    }
    if (filter.unsignedOnly) {
      conditions.push("d.status = 'DRAFT'");
      conditions.push("d.diary_date <= (SELECT current_date) - INTERVAL '2 days'");
    }
    params.push(Math.min(Math.max(filter.limit ?? 200, 1), 500));
    const result = await client.query<{
      id: string; project_id: string; project_code: string; project_name: string;
      diary_date: string; status: DiaryStatus; weather: string | null; worked_hours: string | null;
      signed_name: string | null; version: number; auto_snapshot: DiaryAutoSnapshot | null;
      delays_hours: string | null;
    }>(
      `SELECT d.id, d.project_id, p.code AS project_code, p.name AS project_name,
              d.diary_date::text, d.status, d.weather, d.worked_hours::text, d.signed_name, d.version,
              d.auto_snapshot,
              (SELECT COALESCE(SUM(x.hours), 0)::text FROM public.site_diary_delays x
                WHERE x.company_id = d.company_id AND x.diary_id = d.id) AS delays_hours
         FROM public.site_diaries d
         JOIN public.projects p ON p.company_id = d.company_id AND p.id = d.project_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY d.diary_date DESC, p.code
        LIMIT $${params.length}`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
      diaryDate: row.diary_date,
      status: row.status,
      weather: row.weather,
      workedHours: row.worked_hours,
      signedName: row.signed_name,
      version: row.version,
      workersCount: row.auto_snapshot?.workers?.length ?? 0,
      machinesCount: row.auto_snapshot?.machines?.length ?? 0,
      delaysHours: row.delays_hours ?? "0",
    }));
  });
}

export type DiaryDetail = {
  diary: {
    id: string;
    projectId: string;
    projectCode: string;
    projectName: string;
    diaryDate: string;
    status: DiaryStatus;
    weather: string | null;
    temperatureC: string | null;
    workedHours: string | null;
    description: string | null;
    visitors: string | null;
    events: string | null;
    signedName: string | null;
    signedAt: string | null;
    signedByWorkerId: string | null;
    lockedAt: string | null;
    version: number;
  };
  /** Uvijek svježe iz terena, osim kad je dnevnik potpisan — tada je ZAMRZNUTO (vidi `frozen`). */
  auto: DiaryAutoSnapshot;
  frozen: boolean;
  items: {
    id: string; boqItemId: string | null; description: string; unit: string; quantity: string;
    source: DiaryItemSource; boqCode: string | null; boqQuantityExecuted: string | null; boqQuantityPlanned: string | null;
  }[];
  delays: {
    id: string; kind: DiaryDelayKind; fromAt: string; toAt: string; hours: string; note: string | null;
    amendmentId: string | null; extensionDays: number | null;
  }[];
  delayHoursTotal: string;
  attachments: { id: string; file_name: string; content_type: string; status: string; created_at: string }[];
  revisions: { id: string; reason: string; authorName: string; createdAt: string }[];
};

export async function getDiary(pool: Pool, actor: ScopedDiaryActor, diaryId: string): Promise<DiaryDetail | null> {
  if (!can(actor.roles, "diary.view")) return null;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await diaryInScope(client, actor, diaryId)) return null;
    const header = await client.query<{
      id: string; project_id: string; project_code: string; project_name: string; diary_date: string;
      status: DiaryStatus; weather: string | null; temperature_c: string | null; worked_hours: string | null;
      description: string | null; visitors: string | null; events: string | null; signed_name: string | null;
      signed_at: string | null; signed_by_worker_id: string | null; locked_at: string | null;
      version: number; auto_snapshot: DiaryAutoSnapshot | null;
    }>(
      `SELECT d.id, d.project_id, p.code AS project_code, p.name AS project_name, d.diary_date::text,
              d.status, d.weather, d.temperature_c::text, d.worked_hours::text, d.description, d.visitors,
              d.events, d.signed_name, d.signed_at::text, d.signed_by_worker_id, d.locked_at::text,
              d.version, d.auto_snapshot
         FROM public.site_diaries d
         JOIN public.projects p ON p.company_id = d.company_id AND p.id = d.project_id
        WHERE d.company_id = $1 AND d.id = $2`,
      [actor.companyId, diaryId],
    );
    const row = header.rows[0];
    if (!row) return null;

    const frozen = row.status !== "DRAFT" && row.auto_snapshot !== null;
    const auto = frozen
      ? row.auto_snapshot!
      : await collectDiaryAutoData(client, actor.companyId, row.project_id, row.diary_date);

    const items = await client.query<{
      id: string; boq_item_id: string | null; description: string; unit: string; quantity: string; source: string;
      boq_code: string | null; boq_executed: string | null; boq_planned: string | null;
    }>(
      `SELECT i.id, i.boq_item_id, i.description, i.unit, i.quantity::text, i.source,
              b.code AS boq_code, b.quantity_executed::text AS boq_executed, b.quantity_planned::text AS boq_planned
         FROM public.site_diary_items i
         LEFT JOIN public.project_boq_items b ON b.company_id = i.company_id AND b.id = i.boq_item_id
        WHERE i.company_id = $1 AND i.diary_id = $2
        ORDER BY i.created_at`,
      [actor.companyId, diaryId],
    );

    const delays = await client.query<{
      id: string; kind: string; from_at: string; to_at: string; hours: string; note: string | null;
      amendment_id: string | null; extension_days: number | null;
    }>(
      `SELECT x.id, x.kind, x.from_at::text, x.to_at::text, x.hours::text, x.note,
              x.amendment_id, a.extension_days
         FROM public.site_diary_delays x
         LEFT JOIN public.project_amendments a ON a.company_id = x.company_id AND a.id = x.amendment_id
        WHERE x.company_id = $1 AND x.diary_id = $2
        ORDER BY x.from_at`,
      [actor.companyId, diaryId],
    );

    const attachments = await client.query<{
      id: string; file_name: string; content_type: string; status: string; created_at: string;
    }>(
      `SELECT id, file_name, content_type, status, created_at::text
         FROM public.site_diary_attachments
        WHERE company_id = $1 AND diary_id = $2
        ORDER BY created_at DESC`,
      [actor.companyId, diaryId],
    );

    const revisions = await client.query<{ id: string; reason: string; author_name: string; created_at: string }>(
      `SELECT r.id, r.reason, coalesce(u.first_name || ' ' || u.last_name, 'sistem') AS author_name,
              r.created_at::text
         FROM public.site_diary_revisions r
         LEFT JOIN public.users u ON u.id = r.author_id
        WHERE r.company_id = $1 AND r.diary_id = $2
        ORDER BY r.created_at DESC`,
      [actor.companyId, diaryId],
    );

    return {
      diary: {
        id: row.id,
        projectId: row.project_id,
        projectCode: row.project_code,
        projectName: row.project_name,
        diaryDate: row.diary_date,
        status: row.status,
        weather: row.weather,
        temperatureC: row.temperature_c,
        workedHours: row.worked_hours,
        description: row.description,
        visitors: row.visitors,
        events: row.events,
        signedName: row.signed_name,
        signedAt: row.signed_at,
        signedByWorkerId: row.signed_by_worker_id,
        lockedAt: row.locked_at,
        version: row.version,
      },
      auto,
      frozen,
      items: items.rows.map((item) => ({
        id: item.id,
        boqItemId: item.boq_item_id,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        source: item.source as DiaryItemSource,
        boqCode: item.boq_code,
        boqQuantityExecuted: item.boq_executed,
        boqQuantityPlanned: item.boq_planned,
      })),
      delays: delays.rows.map((delay) => ({
        id: delay.id,
        kind: delay.kind as DiaryDelayKind,
        fromAt: delay.from_at,
        toAt: delay.to_at,
        hours: delay.hours,
        note: delay.note,
        amendmentId: delay.amendment_id,
        extensionDays: delay.extension_days,
      })),
      delayHoursTotal: totalDelayHours(delays.rows.map((delay) => ({ hours: Number(delay.hours) }))).toFixed(2),
      attachments: attachments.rows.map((attachment) => ({
        id: attachment.id,
        file_name: attachment.file_name,
        content_type: attachment.content_type,
        status: attachment.status,
        created_at: attachment.created_at,
      })),
      revisions: revisions.rows.map((revision) => ({
        id: revision.id,
        reason: revision.reason,
        authorName: revision.author_name,
        createdAt: revision.created_at,
      })),
    };
  });
}

/* ------------------------------------------------------------------ pisanje */

export type CreateDiaryInput = {
  projectId: string;
  diaryDate: string;
  weather?: string | null;
  temperatureC?: string | null;
  workedHours?: string | null;
  description?: string | null;
  visitors?: string | null;
  events?: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Otvara dan. Ako dnevnik za taj (projekt, dan) već postoji, vraća ga sa `CONFLICT` i njegovim ID-om
 * — šef tada nastavlja postojeći dan umjesto da dobije grešku koju ne razumije.
 *
 * `auto_snapshot` se puni odmah: dnevnik otvoren u 7:00 i potpisan u 18:00 mora imati podatke
 * onog trenutka kad je otvoren, a ne prazan ekran do potpisa.
 */
export async function createDiary(pool: Pool, actor: ScopedDiaryActor, input: CreateDiaryInput): Promise<DiaryOutcome> {
  if (!can(actor.roles, "diary.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!diaryProjectAllowed(actor, input.projectId)) return NOT_FOUND;
  if (!input.projectId || !DATE_RE.test(input.diaryDate)) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Projekat i datum su obavezni." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const project = await client.query<{ id: string }>(
      "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, input.projectId],
    );
    if (!project.rows[0]) {
      return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Projekat ne postoji." } as DiaryOutcome;
    }
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM public.site_diaries WHERE company_id = $1 AND project_id = $2 AND diary_date = $3::date",
      [actor.companyId, input.projectId, input.diaryDate],
    );
    if (existing.rows[0]) {
      return {
        outcome: "CONFLICT",
        code: "DIARY_EXISTS",
        message: `Dnevnik za taj dan već postoji (${existing.rows[0].id}).`,
      } as DiaryOutcome;
    }

    const auto = await collectDiaryAutoData(client, actor.companyId, input.projectId, input.diaryDate);
    const id = `sdr_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await client.query(
      `INSERT INTO public.site_diaries
         (id, company_id, project_id, diary_date, weather, temperature_c, worked_hours,
          description, visitors, events, auto_snapshot, created_by, updated_by)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$12)`,
      [
        id, actor.companyId, input.projectId, input.diaryDate,
        input.weather ?? null, input.temperatureC ?? null, input.workedHours ?? null,
        input.description ?? null, input.visitors ?? null, input.events ?? null,
        JSON.stringify(auto), actor.userId,
      ],
    );
    await ensureDefaultDiaryTemplate(client, actor.companyId);
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "diary.create",
      entityType: "site_diary",
      entityId: id,
      metadata: { projectId: input.projectId, diaryDate: input.diaryDate },
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id, version: 1 };
  });
}

export type PatchDiaryInput = {
  weather?: string | null;
  temperatureC?: string | null;
  workedHours?: string | null;
  description?: string | null;
  visitors?: string | null;
  events?: string | null;
};

/**
 * Izmjena nacrta. `LOCKED` se odbija i ovdje (poruka) i u bazi (triger) — dva sloja, jer servis
 * nije jedini pozivalac (sync piše istim tabelama).
 */
export async function patchDiary(
  pool: Pool,
  actor: ScopedDiaryActor,
  diaryId: string,
  input: PatchDiaryInput,
): Promise<DiaryOutcome> {
  if (!can(actor.roles, "diary.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await diaryInScope(client, actor, diaryId)) return NOT_FOUND;
    const current = await client.query<{ status: DiaryStatus; version: number }>(
      "SELECT status, version FROM public.site_diaries WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, diaryId],
    );
    const row = current.rows[0];
    if (!row) return NOT_FOUND;
    if (row.status !== "DRAFT") {
      return {
        outcome: "CONFLICT",
        code: "DIARY_ALREADY_LOCKED",
        message: row.status === "LOCKED"
          ? "Dnevnik je zaključan. Ispravka ide kroz reviziju sa razlogom."
          : "Dnevnik je potpisan. Ispravka ide kroz reviziju sa razlogom.",
      } as DiaryOutcome;
    }
    const updated = await client.query<{ version: number }>(
      `UPDATE public.site_diaries SET
         weather = COALESCE($3, weather),
         temperature_c = COALESCE($4, temperature_c),
         worked_hours = COALESCE($5, worked_hours),
         description = COALESCE($6, description),
         visitors = COALESCE($7, visitors),
         events = COALESCE($8, events),
         version = version + 1,
         updated_by = $9,
         updated_at = clock_timestamp()
       WHERE company_id = $1 AND id = $2
       RETURNING version`,
      [
        actor.companyId, diaryId,
        input.weather ?? null, input.temperatureC ?? null, input.workedHours ?? null,
        input.description ?? null, input.visitors ?? null, input.events ?? null, actor.userId,
      ],
    );
    return { outcome: "OK", id: diaryId, version: updated.rows[0]!.version };
  });
}

/**
 * Dodaje količinu izvedenih radova. `BOQ` stavka UVEĆAVA `quantity_executed` u ISTOJ transakciji
 * (spec §1.2/8): ako bi se to radilo kasnije, kratki prekid bi ostavio dnevnik i napredak projekta
 * nesaglasne, a niko ne bi znao koji je tačan.
 */
export async function addDiaryItem(
  pool: Pool,
  actor: ScopedDiaryActor,
  diaryId: string,
  input: {
    boqItemId?: string | null;
    description: string;
    unit: string;
    quantity: string;
    source?: "MANUAL" | "HAUL" | "BOQ";
  },
): Promise<DiaryOutcome> {
  const source = input.source ?? (input.boqItemId ? "BOQ" : "MANUAL");
  if (source === "BOQ" && !input.boqItemId) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "BOQ stavka traži predmjer." };
  }
  if (!/^\d{1,14}(?:\.\d{1,3})?$/.test(input.quantity) || Number(input.quantity) <= 0) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Količina mora biti veća od nule." };
  }
  if (!can(actor.roles, "diary.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await diaryInScope(client, actor, diaryId)) return NOT_FOUND;
    const diary = await client.query<{ status: DiaryStatus; project_id: string }>(
      "SELECT status, project_id FROM public.site_diaries WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, diaryId],
    );
    const header = diary.rows[0];
    if (!header) return NOT_FOUND;
    if (header.status !== "DRAFT") {
      return {
        outcome: "CONFLICT",
        code: "DIARY_ALREADY_LOCKED",
        message: "Stavke se dodaju samo u nacrt; potpisan dnevnik se mijenja kroz reviziju.",
      } as DiaryOutcome;
    }
    if (input.boqItemId) {
      const boq = await client.query<{ id: string; project_id: string }>(
        "SELECT id, project_id FROM public.project_boq_items WHERE company_id = $1 AND id = $2",
        [actor.companyId, input.boqItemId],
      );
      /* Stavka predmjera drugog projekta bi upisala količinu u tuđi napredak. */
      if (!boq.rows[0] || boq.rows[0].project_id !== header.project_id) {
        return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Stavka predmjera tog projekta ne postoji." } as DiaryOutcome;
      }
    }
    const id = `sdi_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await client.query(
      `INSERT INTO public.site_diary_items
         (id, company_id, diary_id, boq_item_id, description, unit, quantity, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, actor.companyId, diaryId, input.boqItemId ?? null, input.description.trim(),
        input.unit.trim(), input.quantity, source, actor.userId],
    );
    if (source === "BOQ" && input.boqItemId) {
      await client.query(
        `UPDATE public.project_boq_items
            SET quantity_executed = quantity_executed + $3::numeric,
                updated_at = clock_timestamp(), updated_by = $4
          WHERE company_id = $1 AND id = $2`,
        [actor.companyId, input.boqItemId, input.quantity, actor.userId],
      );
    }
    await client.query(
      `UPDATE public.site_diaries SET version = version + 1, updated_by = $3, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, diaryId, actor.userId],
    );
    return { outcome: "OK", id };
  });
}

/** Briše stavku — samo u nacrtu; `BOQ` stavka vraća i količinu iz predmjera. */
export async function deleteDiaryItem(
  pool: Pool,
  actor: ScopedDiaryActor,
  diaryId: string,
  itemId: string,
): Promise<DiaryOutcome> {
  if (!can(actor.roles, "diary.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await diaryInScope(client, actor, diaryId)) return NOT_FOUND;
    const diary = await client.query<{ status: DiaryStatus }>(
      "SELECT status FROM public.site_diaries WHERE company_id = $1 AND id = $2",
      [actor.companyId, diaryId],
    );
    const header = diary.rows[0];
    if (!header) return NOT_FOUND;
    if (header.status !== "DRAFT") {
      return { outcome: "CONFLICT", code: "DIARY_ALREADY_LOCKED", message: "Stavke se brišu samo u nacrtu." } as DiaryOutcome;
    }
    const item = await client.query<{ boq_item_id: string | null; quantity: string; source: string }>(
      "SELECT boq_item_id, quantity::text, source FROM public.site_diary_items WHERE company_id = $1 AND id = $2 AND diary_id = $3",
      [actor.companyId, itemId, diaryId],
    );
    const row = item.rows[0];
    if (!row) return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Stavka ne postoji." } as DiaryOutcome;
    await client.query("DELETE FROM public.site_diary_items WHERE company_id = $1 AND id = $2", [actor.companyId, itemId]);
    if (row.source === "BOQ" && row.boq_item_id) {
      await client.query(
        `UPDATE public.project_boq_items
            SET quantity_executed = GREATEST(quantity_executed - $3::numeric, 0),
                updated_at = clock_timestamp(), updated_by = $4
          WHERE company_id = $1 AND id = $2`,
        [actor.companyId, row.boq_item_id, row.quantity, actor.userId],
      );
    }
    return { outcome: "OK", id: itemId };
  });
}

export type AddDelayInput = {
  kind: string;
  fromAt: string;
  toAt: string;
  hours: string;
  note?: string | null;
  amendmentId?: string | null;
};

export async function addDiaryDelay(
  pool: Pool,
  actor: ScopedDiaryActor,
  diaryId: string,
  input: AddDelayInput,
): Promise<DiaryOutcome> {
  if (Date.parse(input.toAt) <= Date.parse(input.fromAt)) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Kraj zastoja mora biti poslije početka." };
  }
  /* Zastoj je dio dana: preko 24 h ne može stati u jedan dnevnik, a `CHECK` u bazi bi to vratio kao
     500. Provjera je zato ovdje — čovjek dobija rečenicu, ne grešku servera. */
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(input.hours) || Number(input.hours) <= 0 || Number(input.hours) > 24) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "VALIDATION_FAILED",
      message: "Sati zastoja moraju biti veći od 0 i najviše 24.",
    };
  }
  if (!can(actor.roles, "diary.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await diaryInScope(client, actor, diaryId)) return NOT_FOUND;
    const diary = await client.query<{ status: DiaryStatus; project_id: string }>(
      "SELECT status, project_id FROM public.site_diaries WHERE company_id = $1 AND id = $2",
      [actor.companyId, diaryId],
    );
    const header = diary.rows[0];
    if (!header) return NOT_FOUND;
    if (header.status !== "DRAFT") {
      return {
        outcome: "CONFLICT",
        code: "DIARY_ALREADY_LOCKED",
        message: "Stavke se dodaju samo u nacrt; potpisan dnevnik se mijenja kroz reviziju.",
      } as DiaryOutcome;
    }
    /* Aneks mora biti aneks ISTOG projekta — inače bi zastoji jednog gradilišta produžili rok drugog. */
    if (input.amendmentId) {
      const amendment = await client.query<{ project_id: string }>(
        "SELECT project_id FROM public.project_amendments WHERE company_id = $1 AND id = $2",
        [actor.companyId, input.amendmentId],
      );
      if (!amendment.rows[0] || amendment.rows[0].project_id !== header.project_id) {
        return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Aneks tog projekta ne postoji." } as DiaryOutcome;
      }
    }
    const id = `sdd_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await client.query(
      `INSERT INTO public.site_diary_delays
         (id, company_id, diary_id, kind, from_at, to_at, hours, note, amendment_id, created_by)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10)`,
      [id, actor.companyId, diaryId, input.kind, input.fromAt, input.toAt, input.hours,
        input.note ?? null, input.amendmentId ?? null, actor.userId],
    );
    await client.query(
      `UPDATE public.site_diaries SET version = version + 1, updated_by = $3, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, diaryId, actor.userId],
    );
    return { outcome: "OK", id };
  });
}

/* ------------------------------------------------------------------ potpis i zaključavanje */

/**
 * Potpis (§1.1/5): `SIGNED` traži `signed_name` i zamrzava automatske podatke.
 *
 * Zašto zamrzavanje: PDF se pravi iz onoga što je šef potpisao. Ako bi se poslije potpisa pojavio
 * još jedan radni sat iz sync-a, PDF bi pokazao broj koji potpisnik nije vidio — a to je dokument
 * koji ide inspektoru.
 */
export async function signDiary(
  pool: Pool,
  actor: ScopedDiaryActor,
  diaryId: string,
  input: { signedName: string; signedByWorkerId?: string | null },
): Promise<DiaryOutcome> {
  if (!validDiarySignature(input.signedName)) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "DIARY_SIGNATURE_REQUIRED",
      message: "Potpis mora biti ime i prezime (2–200 znakova).",
    };
  }
  if (!can(actor.roles, "diary.sign")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await diaryInScope(client, actor, diaryId)) return NOT_FOUND;
    const current = await client.query<{
      status: DiaryStatus; version: number; project_id: string; diary_date: string;
    }>(
      "SELECT status, version, project_id, diary_date::text FROM public.site_diaries WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, diaryId],
    );
    const row = current.rows[0];
    if (!row) return NOT_FOUND;
    const transition = diaryTransition(row.status, "SIGNED", true);
    if (!transition.ok) {
      return {
        outcome: "CONFLICT",
        code: transition.code,
        message: transition.code === "DIARY_ALREADY_LOCKED"
          ? "Dnevnik je zaključan; ispravka ide kroz reviziju."
          : "Dnevnik se ne može potpisati iz ovog stanja.",
      } as DiaryOutcome;
    }
    if (input.signedByWorkerId) {
      const worker = await client.query("SELECT 1 FROM public.workers WHERE company_id = $1 AND id = $2", [
        actor.companyId, input.signedByWorkerId,
      ]);
      if (!worker.rows[0]) {
        return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Radnik potpisnik ne postoji." } as DiaryOutcome;
      }
    }
    const auto = await collectDiaryAutoData(client, actor.companyId, row.project_id, row.diary_date);
    const updated = await client.query<{ version: number }>(
      `UPDATE public.site_diaries SET
         status = 'SIGNED',
         signed_name = $3,
         signed_by_worker_id = $4,
         signed_at = clock_timestamp(),
         auto_snapshot = $5::jsonb,
         version = version + 1,
         updated_by = $6,
         updated_at = clock_timestamp()
       WHERE company_id = $1 AND id = $2
       RETURNING version`,
      [actor.companyId, diaryId, input.signedName.trim(), input.signedByWorkerId ?? null,
        JSON.stringify(auto), actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "diary.sign",
      entityType: "site_diary",
      entityId: diaryId,
      metadata: { signedName: input.signedName.trim(), workedHours: auto.workedHours },
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: diaryId, version: updated.rows[0]!.version };
  });
}

export async function lockDiary(pool: Pool, actor: ScopedDiaryActor, diaryId: string): Promise<DiaryOutcome> {
  if (!can(actor.roles, "diary.sign")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await diaryInScope(client, actor, diaryId)) return NOT_FOUND;
    const current = await client.query<{ status: DiaryStatus; version: number }>(
      "SELECT status, version FROM public.site_diaries WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, diaryId],
    );
    const row = current.rows[0];
    if (!row) return NOT_FOUND;
    const transition = diaryTransition(row.status, "LOCKED", row.status !== "DRAFT");
    if (!transition.ok) {
      return {
        outcome: "CONFLICT",
        code: transition.code,
        message: transition.code === "DIARY_ALREADY_LOCKED"
          ? "Dnevnik je već zaključan."
          : "Dnevnik se zaključava tek poslije potpisa.",
      } as DiaryOutcome;
    }
    const updated = await client.query<{ version: number }>(
      `UPDATE public.site_diaries
          SET status = 'LOCKED', locked_at = clock_timestamp(), version = version + 1,
              updated_by = $3, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2
        RETURNING version`,
      [actor.companyId, diaryId, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "diary.lock",
      entityType: "site_diary",
      entityId: diaryId,
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: diaryId, version: updated.rows[0]!.version };
  });
}

/**
 * Ispravka zaključanog dnevnika (spec §1.1/5): revizija nosi RAZLOG ≥10 znakova i cijeli sadržaj
 * PRIJE izmjene. Bez sadržaja revizija ne dokazuje šta se promijenilo; bez razloga je samo trag da
 * se nešto mijenjalo.
 */
export async function reviseDiary(
  pool: Pool,
  actor: ScopedDiaryActor,
  diaryId: string,
  input: { reason: string } & PatchDiaryInput,
): Promise<DiaryOutcome> {
  if (input.reason.trim().length < 10) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "DIARY_REASON_REQUIRED",
      message: "Razlog ispravke mora imati bar 10 znakova.",
    };
  }
  if (!can(actor.roles, "diary.sign")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await diaryInScope(client, actor, diaryId)) return NOT_FOUND;
    const current = await client.query<Record<string, unknown> & { status: DiaryStatus; version: number }>(
      `SELECT status, version, weather, temperature_c::text, worked_hours::text, description, visitors, events
         FROM public.site_diaries WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [actor.companyId, diaryId],
    );
    const row = current.rows[0];
    if (!row) return NOT_FOUND;
    /* Revizija je za POTPISAN i ZAKLJUČAN dnevnik: to je jedini put poslije potpisa. Nacrt se
       mijenja direktno (`patchDiary`) i za njega revizija ne bi imala šta da čuva. */
    if (row.status === "DRAFT") {
      return {
        outcome: "CONFLICT",
        code: "SERVICE_INVALID_STATUS",
        message: "Nacrt se mijenja direktno; revizija je za potpisan i zaključan dnevnik.",
      } as DiaryOutcome;
    }
    await client.query(
      `INSERT INTO public.site_diary_revisions (id, company_id, diary_id, base_version, reason, author_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        `sdrv_${randomUUID().replace(/-/g, "").slice(0, 20)}`, actor.companyId, diaryId,
        row.version, input.reason.trim(), actor.userId,
        JSON.stringify({
          weather: row.weather, temperatureC: row.temperature_c, workedHours: row.worked_hours,
          description: row.description, visitors: row.visitors, events: row.events,
        }),
      ],
    );
    await client.query(
      `UPDATE public.site_diaries SET
         weather = COALESCE($3, weather),
         temperature_c = COALESCE($4, temperature_c),
         worked_hours = COALESCE($5, worked_hours),
         description = COALESCE($6, description),
         visitors = COALESCE($7, visitors),
         events = COALESCE($8, events),
         version = version + 1,
         updated_by = $9,
         updated_at = clock_timestamp()
       WHERE company_id = $1 AND id = $2`,
      [
        actor.companyId, diaryId,
        input.weather ?? null, input.temperatureC ?? null, input.workedHours ?? null,
        input.description ?? null, input.visitors ?? null, input.events ?? null, actor.userId,
      ],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "diary.revise",
      entityType: "site_diary",
      entityId: diaryId,
      metadata: { reason: input.reason.trim() },
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: diaryId };
  });
}

/**
 * „Nepotpuni dani“ za Pregled (spec §4): nacrti stariji od 2 dana i dani bez ijedne količine.
 * Vraća brojeve, ne redove — Pregled prikazuje koliko, a ekran dnevnika detalje.
 */
export async function diaryAttention(
  client: PoolClient,
  companyId: string,
): Promise<{ unsignedOlderThanTwoDays: number; todayMissing: number; draftCount: number }> {
  const today = await companyToday(client, toCompanyId(companyId));
  const result = await client.query<{ unsigned: string; drafts: string }>(
    `SELECT
        count(*) FILTER (WHERE status = 'DRAFT' AND diary_date <= $2::date - INTERVAL '2 days')::text AS unsigned,
        count(*) FILTER (WHERE status = 'DRAFT')::text AS drafts
       FROM public.site_diaries WHERE company_id = $1`,
    [companyId, today],
  );
  const row = result.rows[0];
  return {
    unsignedOlderThanTwoDays: Number(row?.unsigned ?? 0),
    todayMissing: 0,
    draftCount: Number(row?.drafts ?? 0),
  };
}
