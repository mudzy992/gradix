import type { Pool } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import {
  businessDate, isAbsenceDay, obligationState, parseThresholds, safeTimezone, sumSegmentMinutes,
  type DayKind, type ObligationReviewState, type RoundingMinutes, type RoundingMode,
} from "@gradix/domain";
import { myDayForWorker } from "./workday-timer-service";

/** Pregled SAMO prijavljenog radnika: klijent nikad ne bira radnika ili firmu. */
export async function workerOverview(pool: Pool, actor: { companyId: CompanyId; userId: string; roles: readonly string[] }, now = new Date()) {
  if (!actor.roles.includes("WORKER")) return null;
  return withCompany(pool, actor.companyId, async client => {
    const settings = await client.query<{timezone:string;rounding_minutes:number;rounding_mode:string}>(
      "SELECT timezone, rounding_minutes, rounding_mode FROM companies WHERE id = $1", [actor.companyId]);
    const company = settings.rows[0];
    if (!company) return null;
    const today = businessDate(now, safeTimezone(company.timezone));
    const worker = await client.query<{id:string}>(
      "SELECT id FROM workers WHERE company_id = $1 AND user_id = $2 AND is_active", [actor.companyId, actor.userId]);
    if (worker.rows.length !== 1) return { linked: false as const, ambiguous: worker.rows.length > 1 };
    const workerId = worker.rows[0]!.id;

    const current = await myDayForWorker(client, actor.companyId, workerId, today, now);
    const days = await client.query<{id:string;day_kind:DayKind}>(
      `SELECT id, day_kind FROM workdays WHERE company_id = $1 AND worker_id = $2
       AND work_date >= date_trunc('month', $3::date)::date AND work_date < (date_trunc('month', $3::date) + interval '1 month')::date`,
      [actor.companyId, workerId, today]);
    const entries = await client.query<{workday_id:string;started_at:Date;ended_at:Date|null}>(
      `SELECT e.workday_id, e.started_at, e.ended_at FROM work_entries e
       JOIN workdays d ON d.company_id = e.company_id AND d.id = e.workday_id
       WHERE e.company_id = $1 AND e.worker_id = $2 AND d.worker_id = $2
       AND e.kind = 'WORK' AND e.resolution_state = 'ACTIVE'
       AND d.work_date >= date_trunc('month', $3::date)::date AND d.work_date < (date_trunc('month', $3::date) + interval '1 month')::date`,
      [actor.companyId, workerId, today]);
    const grouped = new Map<string, {startedAt:string;endedAt:string|null}[]>();
    for (const entry of entries.rows) {
      const segments = grouped.get(entry.workday_id) ?? [];
      segments.push({startedAt:entry.started_at.toISOString(),endedAt:entry.ended_at?.toISOString() ?? null});
      grouped.set(entry.workday_id, segments);
    }
    const minutes = days.rows.reduce((sum, day) => sum + (isAbsenceDay(day.day_kind) ? 0 : sumSegmentMinutes(grouped.get(day.id) ?? [], {
      step: Number(company.rounding_minutes) as RoundingMinutes, mode: company.rounding_mode as RoundingMode,
    }).minutes), 0);
    const obligations = await client.query<{label:string;expires_at:string|null;review_at:string|null;review_state:ObligationReviewState;thresholds:string}>(
      `SELECT t.label, o.expires_at::text, o.review_at::text, o.review_state,
              COALESCE(o.reminder_days, t.default_reminder_days)::text AS thresholds
       FROM obligations o JOIN obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
       WHERE o.company_id = $1 AND o.worker_id = $2 AND o.superseded_by IS NULL ORDER BY o.expires_at NULLS LAST, t.label`,
      [actor.companyId, workerId]);
    const personalObligations = obligations.rows.map(row => ({label:row.label, expiresAt:row.expires_at,
      state:obligationState({expiresAt:row.expires_at,reviewAt:row.review_at,reviewState:row.review_state,thresholds:parseThresholds(row.thresholds),today})}));
    const year = Number(today.slice(0, 4));
    const entitlement = await client.query<{days_entitled:string;days_carryover:string}>(
      "SELECT days_entitled::text, days_carryover::text FROM worker_leave_entitlements WHERE company_id = $1 AND worker_id = $2 AND year = $3", [actor.companyId,workerId,year]);
    const taken = await client.query<{count:string}>(
      "SELECT count(*)::text AS count FROM workdays WHERE company_id = $1 AND worker_id = $2 AND day_kind = 'VACATION' AND EXTRACT(YEAR FROM work_date) = $3", [actor.companyId,workerId,year]);
    const quota = entitlement.rows[0];
    const leaveBalance = quota ? Number((Number(quota.days_entitled) + Number(quota.days_carryover) - Number(taken.rows[0]?.count ?? 0)).toFixed(2)) : null;
    return {linked:true as const,today,minutes,dayCount:days.rows.length,current,obligations:personalObligations,leaveBalance};
  });
}
export type WorkerOverview = NonNullable<Awaited<ReturnType<typeof workerOverview>>>;
