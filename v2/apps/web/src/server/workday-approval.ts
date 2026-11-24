/**
 * R4b: potvrda dana + sync gate. Sedmica/revizija → workday-week-actions.ts.
 */
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can, type Role } from "./permissions";
import { weekStartFromWorkDate } from "./workday-week";
import { resolveViewerWorkerId } from "./workday-review";
import { bookWorkdayCost } from "./cost-entry-service";

export type ApprovalActor = {
  userId: string;
  companyId: string;
  roles: readonly Role[];
};

export type ApprovalOutcome =
  | { outcome: "OK"; workdayId?: string; weekStart?: string; status: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "FORBIDDEN"; code: string }
  | { outcome: "NOT_FOUND" }
  | { outcome: "CONFLICT"; code: string; message: string };

type DayRow = {
  id: string;
  worker_id: string;
  work_date: string;
  status: string;
  approval_status: string;
  header_version: number;
};

export async function loadWorkday(
  client: PoolClient,
  companyId: string,
  workdayId: string,
): Promise<DayRow | null> {
  const result = await client.query<DayRow>(
    `SELECT id, worker_id, work_date::text, status, approval_status, header_version
       FROM public.workdays WHERE company_id = $1 AND id = $2`,
    [companyId, workdayId],
  );
  return result.rows[0] ?? null;
}

export async function inForemanScope(
  client: PoolClient,
  companyId: string,
  viewerWorkerId: string | null,
  day: DayRow,
): Promise<boolean> {
  if (!viewerWorkerId) return false;
  const result = await client.query(
    `SELECT 1
       FROM public.project_assignments va
       JOIN public.project_assignments ta
         ON ta.company_id = va.company_id AND ta.project_id = va.project_id
      WHERE va.company_id = $1 AND va.worker_id = $2 AND ta.worker_id = $3
        AND va.from_date <= $4::date AND (va.to_date IS NULL OR va.to_date >= $4::date)
        AND ta.from_date <= $4::date AND (ta.to_date IS NULL OR ta.to_date >= $4::date)
      LIMIT 1`,
    [companyId, viewerWorkerId, day.worker_id, day.work_date],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function confirmWorkday(
  pool: Pool,
  actor: ApprovalActor,
  workdayId: string,
): Promise<ApprovalOutcome> {
  if (!can(actor.roles, "workdays.confirm")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const day = await loadWorkday(client, actor.companyId, workdayId);
    if (!day) return { outcome: "NOT_FOUND" };
    if (day.status !== "SUBMITTED") {
      return { outcome: "VALIDATION_FAILED", code: "NOT_SUBMITTED", message: "Dan mora biti predan." };
    }
    const weekStart = weekStartFromWorkDate(day.work_date);
    const week = await client.query<{ status: string }>(
      `SELECT status FROM public.work_week_approvals WHERE company_id = $1 AND week_start = $2::date`,
      [actor.companyId, weekStart],
    );
    const weekStatus = week.rows[0]?.status;
    const isReconfirm = day.approval_status === "FOREMAN_CONFIRMED" && weekStatus === "WEEK_REJECTED";
    if (day.approval_status !== "SUBMITTED" && !isReconfirm) {
      return { outcome: "CONFLICT", code: "BAD_STATE", message: "Dan nije u stanju za potvrdu." };
    }
    if (weekStatus === "LOCKED" || weekStatus === "WEEK_APPROVED") {
      return { outcome: "CONFLICT", code: "WEEK_CLOSED", message: "Sedmica je već odlučena." };
    }
    const viewerWorkerId = await resolveViewerWorkerId(client, actor.companyId, actor.userId);
    if (!(await inForemanScope(client, actor.companyId, viewerWorkerId, day))) {
      return { outcome: "FORBIDDEN", code: "SCOPE" };
    }
    const openConflict = await client.query(
      `SELECT 1 FROM public.sync_conflicts c
         JOIN public.work_entries e ON e.company_id = c.company_id AND e.id = c.work_entry_id
        WHERE c.company_id = $1 AND e.workday_id = $2 AND c.status = 'OPEN' LIMIT 1`,
      [actor.companyId, day.id],
    );
    if ((openConflict.rowCount ?? 0) > 0) {
      return { outcome: "VALIDATION_FAILED", code: "OPEN_CONFLICT", message: "Prvo razrijesi sukob." };
    }
    const openSeg = await client.query(
      `SELECT 1 FROM public.work_entries
        WHERE company_id = $1 AND workday_id = $2 AND end_state = 'OPEN' LIMIT 1`,
      [actor.companyId, day.id],
    );
    if ((openSeg.rowCount ?? 0) > 0) {
      return { outcome: "VALIDATION_FAILED", code: "OPEN_SEGMENT", message: "Segment još nije zatvoren." };
    }
    await client.query(
      `UPDATE public.workdays SET approval_status = 'FOREMAN_CONFIRMED',
          updated_by = $3, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, day.id, actor.userId],
    );
    if (isReconfirm) {
      await client.query(
        `UPDATE public.work_week_approvals
            SET status = 'OPEN', decided_by = NULL, decided_at = NULL, reason = NULL,
                updated_at = clock_timestamp()
          WHERE company_id = $1 AND week_start = $2::date AND status = 'WEEK_REJECTED'`,
        [actor.companyId, weekStart],
      );
    }
    /*
     * F5 (§1.3.13): potvrda dana KNJIŽI trošak rada. Nema dugmeta — dan je potvrđen, pa sati
     * postoje. `bookWorkdayCost` je idempotentan po danu i projektu, pa ponovna potvrda (poslije
     * odbijene sedmice) ne pravi drugi trošak.
     */
    await bookWorkdayCost(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      workdayId: day.id,
    });
    return { outcome: "OK", workdayId: day.id, status: "FOREMAN_CONFIRMED" };
  });
}

/** Sync gate: LOCKED → reject; WEEK_APPROVED → conflict. */
export async function syncGateForWorkDate(
  client: PoolClient,
  companyId: string,
  workDate: string,
): Promise<"OK" | "LOCKED" | "WEEK_APPROVED"> {
  const weekStart = weekStartFromWorkDate(workDate);
  const week = await client.query<{ status: string }>(
    `SELECT status FROM public.work_week_approvals WHERE company_id = $1 AND week_start = $2::date`,
    [companyId, weekStart],
  );
  const status = week.rows[0]?.status;
  if (status === "LOCKED") return "LOCKED";
  if (status === "WEEK_APPROVED") return "WEEK_APPROVED";
  const lockedDay = await client.query(
    `SELECT 1 FROM public.workdays
      WHERE company_id = $1 AND work_date = $2::date AND approval_status = 'LOCKED' LIMIT 1`,
    [companyId, workDate],
  );
  if ((lockedDay.rowCount ?? 0) > 0) return "LOCKED";
  return "OK";
}
