/** GET /api/sync/foreman-workers?projectId=&workDate= — minimal, R3-assignment-scoped roster. */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { hasControlChars } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "workers.view");
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    if (!ctx.roles.includes("SITE_SUPERVISOR")) {
      return fail("FORBIDDEN", "Samo šef gradilišta može preuzeti grupni R3 roster.");
    }

    const params = request.nextUrl.searchParams;
    // A1: kontrolni znakovi (npr. NUL) u filteru nisu nikad legitiman unos — odbijaju se
    // na granici, da ne stignu do baze (Postgres odbija NUL u string parametru).
    for (const value of params.values()) {
      if (hasControlChars(value)) {
        return fail("VALIDATION_FAILED", "Filter sadrži nedozvoljene kontrolne znakove.");
      }
    }
    if ([...params.keys()].some((key) => key !== "projectId" && key !== "workDate")
        || params.getAll("projectId").length !== 1 || params.getAll("workDate").length !== 1) {
      return fail("VALIDATION_FAILED", "Potrebni su tačno jedan projectId i workDate.");
    }
    const projectId = params.get("projectId") ?? "";
    const workDate = params.get("workDate") ?? "";
    if (!projectId || projectId.length > 128 || !isRealDate(workDate)) {
      return fail("VALIDATION_FAILED", "projectId ili workDate nije ispravan.");
    }

    const result = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      const inScope = await client.query<{ allowed: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM public.workers supervisor_worker
             JOIN public.project_assignments supervisor_assignment
               ON supervisor_assignment.company_id = supervisor_worker.company_id
              AND supervisor_assignment.worker_id = supervisor_worker.id
             JOIN public.project_assignments target_assignment
               ON target_assignment.company_id = supervisor_assignment.company_id
              AND target_assignment.project_id = supervisor_assignment.project_id
             JOIN public.workers target_worker
               ON target_worker.company_id = target_assignment.company_id
              AND target_worker.id = target_assignment.worker_id
            WHERE supervisor_worker.company_id = $1
              AND supervisor_worker.user_id = $2
              AND supervisor_worker.is_active
              AND target_worker.is_active
              AND supervisor_assignment.project_id = $3
              AND supervisor_assignment.voided_at IS NULL
              AND supervisor_assignment.from_date <= $4::date
              AND (supervisor_assignment.to_date IS NULL OR supervisor_assignment.to_date >= $4::date)
              AND target_assignment.voided_at IS NULL
              AND target_assignment.from_date <= $4::date
              AND (target_assignment.to_date IS NULL OR target_assignment.to_date >= $4::date)
         ) AS allowed`,
        [ctx.companyId, ctx.userId, projectId, workDate],
      );
      if (!inScope.rows[0]?.allowed) return { forbidden: true as const };

      const roster = await client.query<{ id: string; name: string }>(
        `SELECT DISTINCT target_worker.id,
                btrim(target_worker.first_name || ' ' || target_worker.last_name) AS name
           FROM public.workers supervisor_worker
           JOIN public.project_assignments supervisor_assignment
             ON supervisor_assignment.company_id = supervisor_worker.company_id
            AND supervisor_assignment.worker_id = supervisor_worker.id
           JOIN public.project_assignments target_assignment
             ON target_assignment.company_id = supervisor_assignment.company_id
            AND target_assignment.project_id = supervisor_assignment.project_id
           JOIN public.workers target_worker
             ON target_worker.company_id = target_assignment.company_id
            AND target_worker.id = target_assignment.worker_id
          WHERE supervisor_worker.company_id = $1
            AND supervisor_worker.user_id = $2
            AND supervisor_worker.is_active
            AND target_worker.is_active
            AND supervisor_assignment.project_id = $3
            AND supervisor_assignment.voided_at IS NULL
            AND supervisor_assignment.from_date <= $4::date
            AND (supervisor_assignment.to_date IS NULL OR supervisor_assignment.to_date >= $4::date)
            AND target_assignment.voided_at IS NULL
            AND target_assignment.from_date <= $4::date
            AND (target_assignment.to_date IS NULL OR target_assignment.to_date >= $4::date)
          ORDER BY name, target_worker.id`,
        [ctx.companyId, ctx.userId, projectId, workDate],
      );
      return { forbidden: false as const, workers: roster.rows };
    });

    if (result.forbidden) return fail("FORBIDDEN", "Nemaš R3 dodjelu na ovom projektu za taj radni datum.");
    return ok({ workDate, workers: result.workers });
  } catch (error) {
    return internal(error, "sync.foremanWorkers");
  }
}
