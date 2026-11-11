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

export type WorkdayReviewRow = {
  id: string;
  work_date: string;
  status: string;
  worker_name: string;
  entries: number;
  unknown_end: number;
  open_entries: number;
  project_codes: string | null;
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
    "SELECT id FROM public.workers WHERE company_id = $1 AND user_id = $2 AND is_active",
    [companyId, userId],
  );
  return result.rows[0]?.id ?? null;
}

export async function listWorkdaysForReview(
  client: PoolClient,
  companyId: string,
  scope: WorkdayReviewScope,
  limit = 200,
): Promise<WorkdayReviewRow[]> {
  const result = await client.query<WorkdayReviewRow>(
    `SELECT d.id,
            d.work_date::text AS work_date,
            d.status,
            (w.first_name || ' ' || w.last_name) AS worker_name,
            count(e.id)::int AS entries,
            count(e.id) FILTER (WHERE e.end_state = 'UNKNOWN_END')::int AS unknown_end,
            count(e.id) FILTER (WHERE e.ended_at IS NULL AND e.end_state = 'OPEN')::int AS open_entries,
            string_agg(DISTINCT p.code, ', ') AS project_codes
       FROM public.workdays d
       JOIN public.workers w ON w.company_id = d.company_id AND w.id = d.worker_id
       LEFT JOIN public.work_entries e ON e.company_id = d.company_id AND e.workday_id = d.id
       LEFT JOIN public.projects p ON p.company_id = d.company_id AND p.id = e.project_id
      WHERE d.company_id = $1
        AND (
          $2::text = 'company'
          OR (
            $3::text IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM public.project_assignments va
                JOIN public.project_assignments ta
                  ON ta.company_id = va.company_id AND ta.project_id = va.project_id
               WHERE va.company_id = d.company_id
                 AND ta.company_id = d.company_id
                 AND va.worker_id = $3
                 AND ta.worker_id = d.worker_id
                 AND va.voided_at IS NULL AND ta.voided_at IS NULL
                 AND va.from_date <= d.work_date AND (va.to_date IS NULL OR va.to_date >= d.work_date)
                 AND ta.from_date <= d.work_date AND (ta.to_date IS NULL OR ta.to_date >= d.work_date)
            )
          )
        )
      GROUP BY d.id, d.work_date, d.status, w.first_name, w.last_name
      ORDER BY d.work_date DESC, worker_name
      LIMIT $4`,
    [companyId, scope.kind, scope.kind === "assignments" ? scope.viewerWorkerId : null, limit],
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
  | { kind: "assignments"; viewerWorkerId: string | null }
  | { kind: "none" };

export function workdayResolveScopeFor(
  roles: readonly string[],
  viewerWorkerId: string | null,
): WorkdayResolveScope {
  if (roles.includes("OWNER") || roles.includes("ADMIN")) return { kind: "company" };
  if (roles.includes("PROJECT_MANAGER") || roles.includes("SITE_SUPERVISOR")) {
    return { kind: "assignments", viewerWorkerId };
  }
  return { kind: "none" };
}

/**
 * Strana u sukobu ne razrješava vlastiti sukob: ako je pregledač povezan s radnikom
 * koji je autor BILO KOJEG od dva unosa (server ili telefon), odluku donosi druga
 * osoba iz ureda. OWNER je izuzetak — vlasnik je zadnja instanca firme i smije
 * razriješiti i sukob u kojem je njegov radnički zapis strana.
 */
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
