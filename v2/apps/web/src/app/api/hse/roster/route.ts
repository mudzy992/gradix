/** Minimalni roster za prijavu incidenta: samo kolege na vlastitoj dodjeli tog dana. */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request, "hse.report");
    if (!auth.ok) return auth.response;
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some((key) => key !== "projectId" && key !== "workDate") ||
        params.getAll("projectId").length !== 1 || params.getAll("workDate").length !== 1) {
      return fail("VALIDATION_FAILED", "Potrebni su tačno jedan projekat i datum.");
    }
    const project = params.get("projectId") ?? "";
    const day = params.get("workDate") ?? "";
    const date = new Date(`${day}T00:00:00Z`);
    if (!project || project.length > 128 || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000-") ||
        Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
      return fail("VALIDATION_FAILED", "Projekat ili datum nije ispravan.");
    }
    if (auth.ctx.scope === "PROJECTS" && !(auth.ctx.projectIds ?? []).includes(project)) return fail("FORBIDDEN", "Projekat je van opsega.");
    const rows = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => client.query<{ id: string; name: string }>(
      `SELECT DISTINCT target.id, btrim(target.first_name || ' ' || coalesce(target.last_name, '')) AS name
         FROM public.workers self
         JOIN public.project_assignments own_assignment ON own_assignment.company_id = self.company_id AND own_assignment.worker_id = self.id
         JOIN public.project_assignments member ON member.company_id = own_assignment.company_id AND member.project_id = own_assignment.project_id
         JOIN public.workers target ON target.company_id = member.company_id AND target.id = member.worker_id
        WHERE self.company_id = $1 AND self.user_id = $2 AND self.is_active AND target.is_active
          AND own_assignment.project_id = $3 AND own_assignment.voided_at IS NULL
          AND own_assignment.from_date <= $4::date AND (own_assignment.to_date IS NULL OR own_assignment.to_date >= $4::date)
          AND member.voided_at IS NULL AND member.from_date <= $4::date AND (member.to_date IS NULL OR member.to_date >= $4::date)
        ORDER BY name, id`, [auth.ctx.companyId, auth.ctx.userId, project, day],
    ));
    if (!rows.rows.length) return fail("FORBIDDEN", "Nemaš dodjelu na ovom projektu za taj datum.");
    return ok({ workDate: day, workers: rows.rows });
  } catch (error) { return internal(error, "hse.roster"); }
}
