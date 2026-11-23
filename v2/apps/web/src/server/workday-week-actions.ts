/** R4b: odluka/zaključavanje sedmice i revizija dana. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import {
  loadWorkday,
  type ApprovalActor,
  type ApprovalOutcome,
} from "./workday-approval";
import { resolveViewerWorkerId, workdayReviewScopeFor } from "./workday-review";

export async function decideWeek(
  pool: Pool,
  actor: ApprovalActor,
  input: { weekStart: string; decision: "APPROVE" | "REJECT"; reason?: string },
): Promise<ApprovalOutcome> {
  if (!can(actor.roles, "workdays.week_decide")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (input.decision === "REJECT" && (input.reason?.trim().length ?? 0) < 10) {
    return { outcome: "VALIDATION_FAILED", code: "REASON_TOO_SHORT", message: "Razlog ≥10 znakova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, actor.companyId, actor.userId);
    const scope = workdayReviewScopeFor(actor.roles, viewerWorkerId);
    if (scope.kind === "assignments") {
      if (!scope.viewerWorkerId) return { outcome: "FORBIDDEN", code: "SCOPE" };
      const inScope = await client.query(
        `SELECT 1
           FROM public.workdays d
           JOIN public.project_assignments va
             ON va.company_id = d.company_id AND va.worker_id = $2
            AND va.from_date <= d.work_date
            AND (va.to_date IS NULL OR va.to_date >= d.work_date)
           JOIN public.project_assignments ta
             ON ta.company_id = d.company_id AND ta.project_id = va.project_id
            AND ta.worker_id = d.worker_id
            AND ta.from_date <= d.work_date
            AND (ta.to_date IS NULL OR ta.to_date >= d.work_date)
          WHERE d.company_id = $1
            AND d.work_date >= $3::date AND d.work_date < ($3::date + 7)
          LIMIT 1`,
        [actor.companyId, scope.viewerWorkerId, input.weekStart],
      );
      if ((inScope.rowCount ?? 0) === 0) return { outcome: "FORBIDDEN", code: "SCOPE" };
    }
    const existing = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM public.work_week_approvals
        WHERE company_id = $1 AND week_start = $2::date`,
      [actor.companyId, input.weekStart],
    );
    if (existing.rows[0]?.status === "LOCKED") {
      return { outcome: "CONFLICT", code: "LOCKED", message: "Sedmica je zaključana." };
    }
    if (input.decision === "APPROVE") {
      const confirmed = await client.query(
        `SELECT 1 FROM public.workdays
          WHERE company_id = $1
            AND work_date >= $2::date AND work_date < ($2::date + 7)
            AND approval_status = 'FOREMAN_CONFIRMED'
          LIMIT 1`,
        [actor.companyId, input.weekStart],
      );
      if ((confirmed.rowCount ?? 0) === 0) {
        return {
          outcome: "VALIDATION_FAILED",
          code: "NO_CONFIRMED_DAYS",
          message: "Prvo šef mora potvrditi barem jedan dan u sedmici.",
        };
      }
    }
    const next = input.decision === "APPROVE" ? "WEEK_APPROVED" : "WEEK_REJECTED";
    const reason = input.decision === "REJECT" ? input.reason!.trim() : null;
    if (existing.rows[0]) {
      await client.query(
        `UPDATE public.work_week_approvals
            SET status = $3, decided_by = $4, decided_at = clock_timestamp(), reason = $5,
                updated_at = clock_timestamp()
          WHERE company_id = $1 AND week_start = $2::date AND status <> 'LOCKED'`,
        [actor.companyId, input.weekStart, next, actor.userId, reason],
      );
    } else {
      await client.query(
        `INSERT INTO public.work_week_approvals
           (id, company_id, week_start, status, decided_by, decided_at, reason)
         VALUES ($1, $2, $3::date, $4, $5, clock_timestamp(), $6)`,
        [
          `wwa_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          actor.companyId,
          input.weekStart,
          next,
          actor.userId,
          reason,
        ],
      );
    }
    return { outcome: "OK", weekStart: input.weekStart, status: next };
  });
}

export async function lockWeek(
  pool: Pool,
  actor: ApprovalActor,
  weekStart: string,
): Promise<ApprovalOutcome> {
  if (!can(actor.roles, "workdays.lock")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const week = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM public.work_week_approvals
        WHERE company_id = $1 AND week_start = $2::date`,
      [actor.companyId, weekStart],
    );
    if (!week.rows[0]) return { outcome: "NOT_FOUND" };
    if (week.rows[0].status !== "WEEK_APPROVED") {
      return { outcome: "VALIDATION_FAILED", code: "NOT_APPROVED", message: "Prvo odobri sedmicu." };
    }
    await client.query(
      `UPDATE public.work_week_approvals
          SET status = 'LOCKED', decided_by = $3, decided_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND week_start = $2::date`,
      [actor.companyId, weekStart, actor.userId],
    );
    await client.query(
      `UPDATE public.workdays
          SET approval_status = 'LOCKED', updated_by = $3, updated_at = clock_timestamp()
        WHERE company_id = $1
          AND work_date >= $2::date AND work_date < ($2::date + 7)
          AND approval_status = 'FOREMAN_CONFIRMED'`,
      [actor.companyId, weekStart, actor.userId],
    );
    return { outcome: "OK", weekStart, status: "LOCKED" };
  });
}

export async function reviseWorkday(
  pool: Pool,
  actor: ApprovalActor,
  input: { workdayId: string; reason: string; payload: Record<string, unknown> },
): Promise<ApprovalOutcome> {
  if (!can(actor.roles, "workdays.revise")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (input.reason.trim().length < 10) {
    return { outcome: "VALIDATION_FAILED", code: "REASON_TOO_SHORT", message: "Razlog ≥10 znakova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const day = await loadWorkday(client, actor.companyId, input.workdayId);
    if (!day) return { outcome: "NOT_FOUND" };
    if (day.approval_status === "LOCKED") {
      // Append-only revision still allowed as audit trail? Plan: "ne dira LOCKED original"
      // — insert revision is OK; we do NOT update workdays row.
    }
    if (day.approval_status === "SUBMITTED") {
      return { outcome: "VALIDATION_FAILED", code: "NOT_CONFIRMED", message: "Revizija tek poslije potvrde." };
    }
    await client.query(
      `INSERT INTO public.workday_revisions
         (id, company_id, workday_id, base_version, reason, author_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        `wrev_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        actor.companyId,
        day.id,
        day.header_version,
        input.reason.trim(),
        actor.userId,
        JSON.stringify(input.payload),
      ],
    );
    const lockedCheck = await client.query<{ approval_status: string }>(
      `SELECT approval_status FROM public.workdays WHERE company_id = $1 AND id = $2`,
      [actor.companyId, day.id],
    );
    if (lockedCheck.rows[0]?.approval_status !== day.approval_status) {
      return { outcome: "CONFLICT", code: "MUTATED", message: "Original je promijenjen." };
    }
    return { outcome: "OK", workdayId: day.id, status: day.approval_status };
  });
}
