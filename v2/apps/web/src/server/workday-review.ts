/**
 * Uredski pregled radnih dana s opsegom (A2, 2026-11-07).
 *
 * OWNER/ADMIN/ACCOUNTANT: cijela firma. PROJECT_MANAGER/SITE_SUPERVISOR: samo dani
 * radnika koji s pregledačem dijele bar jednu aktivnu R3 dodjelu na projektu
 * (dodjela važi na datum tog radnog dana) — isti pojam opsega kao šefov roster.
 * Pregledač bez povezanog radničkog zapisa u opsegu vidi prazno, nikad cijelu firmu.
 * Tenant izolacija: svaki upit je unutar withCompany i filtrira company_id.
 */
import type { PoolClient } from "pg";
import { sharedWorkdayAssignment } from "./workday-review-sql";

export type WorkdayReviewRow = {
  id: string;
  work_date: string;
  status: string;
  approval_status: string;
  worker_name: string;
  entries: number;
  unknown_end: number;
  open_entries: number;
  open_conflicts: number;
  project_codes: string | null;
};

export type WeekApprovalRow = {
  week_start: string;
  status: string;
  reason: string | null;
};

export type WorkdayReviewScope =
  | { kind: "company" }
  | { kind: "assignments"; viewerWorkerId: string | null };

export function workdayReviewScopeFor(
  roles: readonly string[],
  viewerWorkerId: string | null,
): WorkdayReviewScope {
  if (roles.includes("OWNER") || roles.includes("ADMIN") || roles.includes("ACCOUNTANT")) {
    return { kind: "company" };
  }
  return { kind: "assignments", viewerWorkerId };
}

export async function resolveViewerWorkerId(
  client: PoolClient,
  companyId: string,
  userId: string,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM public.workers WHERE company_id = $1 AND user_id = $2 AND is_active ORDER BY id LIMIT 1",
    [companyId, userId],
  );
  return result.rows[0]?.id ?? null;
}

export async function listWorkdaysForReview(
  client: PoolClient,
  companyId: string,
  scope: WorkdayReviewScope,
  limit = 200,
  filter?: { unconfirmed: boolean; projectIds: readonly string[] | null },
): Promise<WorkdayReviewRow[]> {
  const result = await client.query<WorkdayReviewRow>(
    `SELECT d.id,
            d.work_date::text AS work_date,
            d.status,
            d.approval_status,
            (w.first_name || ' ' || w.last_name) AS worker_name,
            count(e.id)::int AS entries,
            count(e.id) FILTER (WHERE e.end_state = 'UNKNOWN_END')::int AS unknown_end,
            count(e.id) FILTER (WHERE e.ended_at IS NULL AND e.end_state = 'OPEN')::int AS open_entries,
            count(DISTINCT c.id) FILTER (WHERE c.status = 'OPEN')::int AS open_conflicts,
            string_agg(DISTINCT p.code, ', ') AS project_codes
       FROM public.workdays d
       JOIN public.workers w ON w.company_id = d.company_id AND w.id = d.worker_id
       LEFT JOIN public.work_entries e ON e.company_id = d.company_id AND e.workday_id = d.id
       LEFT JOIN public.sync_conflicts c ON c.company_id = e.company_id AND c.work_entry_id = e.id
       LEFT JOIN public.projects p ON p.company_id = d.company_id AND p.id = e.project_id
      WHERE d.company_id = $1
        AND (NOT $5::boolean OR (d.status='SUBMITTED' AND d.approval_status='SUBMITTED'
          AND ($6::text[] IS NULL OR EXISTS (SELECT 1 FROM public.work_entries se
            WHERE se.company_id=d.company_id AND se.workday_id=d.id AND se.project_id=ANY($6::text[])))))
        AND (
          $2::text = 'company'
          OR (
            $3::text IS NOT NULL
            AND ${sharedWorkdayAssignment("$3")}
          )
        )
      GROUP BY d.id, d.work_date, d.status, d.approval_status, w.first_name, w.last_name
      ORDER BY d.work_date DESC, worker_name
      LIMIT $4`,
    [companyId, scope.kind, scope.kind === "assignments" ? scope.viewerWorkerId : null, limit,
      filter?.unconfirmed ?? false, filter?.projectIds ?? null],
  );
  return result.rows;
}

export async function listWeekApprovals(
  client: PoolClient,
  companyId: string,
  weekStarts: readonly string[],
): Promise<WeekApprovalRow[]> {
  if (weekStarts.length === 0) return [];
  const result = await client.query<WeekApprovalRow>(
    `SELECT week_start::text AS week_start, status, reason
       FROM public.work_week_approvals
      WHERE company_id = $1 AND week_start = ANY($2::date[])`,
    [companyId, weekStarts],
  );
  return result.rows;
}

/**
 * R4a-2 opseg razrješenja: isti pojam opsega kao pregled, ali bez ACCOUNTANT-a
 * (on vidi cijelu firmu kroz workdays.view, ne odlučuje). `none` = rola uopšte
 * nema workdays.resolve, pa se ni lista sukoba ne nudi.
 */
export type WorkdayResolveScope =
  | { kind: "company" }
  | { kind: "projects"; projectIds: readonly string[] }
  | { kind: "assignments"; viewerWorkerId: string | null; projectIds: readonly string[] | null }
  | { kind: "none" };

/** Session scope intersects role permissions; role alone never widens it. */
export function workdayResolveScopeFor(
  roles: readonly string[],
  viewerWorkerId: string | null,
  session: { scope: string; projectIds: readonly string[] | null },
): WorkdayResolveScope {
  if (session.scope !== "COMPANY" && session.scope !== "PROJECTS") return { kind: "none" };
  if (roles.includes("OWNER") || roles.includes("ADMIN")) {
    return session.scope === "COMPANY" ? { kind: "company" }
      : { kind: "projects", projectIds: session.projectIds ?? [] };
  }
  if (roles.includes("PROJECT_MANAGER") || roles.includes("SITE_SUPERVISOR")) {
    return { kind: "assignments", viewerWorkerId,
      projectIds: session.scope === "PROJECTS" ? (session.projectIds ?? []) : null };
  }
  return { kind: "none" };
}

/**
 * Strana u sukobu ne razrješava vlastiti sukob: ako je pregledač povezan s radnikom
 * koji je autor BILO KOJEG od dva unosa (server ili telefon), odluku donosi druga
 * osoba iz ureda. OWNER je izuzetak — vlasnik je zadnja instanca firme i smije
 * razriješiti i sukob u kojem je njegov radnički zapis strana.
 */
/** Da li je razrješavalac autor jednog od dva unosa u sukobu (strana u sukobu). */
export function isConflictParty(
  resolverWorkerId: string | null,
  partyWorkerIds: readonly (string | null | undefined)[],
): boolean {
  if (!resolverWorkerId) return false;
  return partyWorkerIds.some((id) => id != null && id === resolverWorkerId);
}

export function canResolveConflict(args: {
  roles: readonly string[];
  resolverWorkerId: string | null;
  partyWorkerIds: readonly (string | null | undefined)[];
}): boolean {
  if (args.roles.includes("OWNER")) return true;
  if (!args.roles.some((role) => ["ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"].includes(role))) {
    return false;
  }
  if (!args.resolverWorkerId) return true;
  return !args.partyWorkerIds.some((id) => id != null && id === args.resolverWorkerId);
}
