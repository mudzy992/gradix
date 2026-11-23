/**
 * GET /api/me — zaštićena ruta. Vraća identitet iz sesije i broj mašina firme.
 * Ovo je "jedna zaštićena stranica + jedan zapis u bazi" iz R0.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request);
    if (!guardResult.ok) return guardResult.response;
    const auth = { ok: true as const, ctx: guardResult.ctx };

    const data = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
      const profile = await client.query<{ email: string; first_name: string; last_name: string; must_change_password: boolean }>(
        "SELECT email, first_name, last_name, must_change_password FROM users WHERE id = $1",
        [auth.ctx.userId],
      );
      const company = await client.query<{ id: string; name: string; slug: string; currency: string; timezone: string }>(
        "SELECT id, name, slug, currency, timezone FROM companies WHERE id = $1",
        [auth.ctx.companyId],
      );
      const machines = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM machines",
      );
      const worker = await client.query<{ id: string }>(
        "SELECT id FROM public.workers WHERE company_id = $1 AND user_id = $2 AND is_active",
        [auth.ctx.companyId, auth.ctx.userId],
      );
      const workerId = worker.rows[0]?.id ?? null;
      let foremanScope = false;
      if (workerId && auth.ctx.roles.includes("SITE_SUPERVISOR")) {
        const scope = await client.query<{ allowed: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM public.project_assignments a
             JOIN public.companies c ON c.id = a.company_id
            WHERE a.company_id = $1 AND a.worker_id = $2 AND a.voided_at IS NULL
              AND a.from_date <= (clock_timestamp() AT TIME ZONE c.timezone)::date
              AND (a.to_date IS NULL OR a.to_date >= (clock_timestamp() AT TIME ZONE c.timezone)::date)
          ) AS allowed`,
          [auth.ctx.companyId, workerId],
        );
        foremanScope = scope.rows[0]?.allowed ?? false;
      }
      const row = profile.rows[0];
      return {
        user: {
          id: auth.ctx.userId,
          email: row?.email ?? "",
          firstName: row?.first_name ?? "",
          lastName: row?.last_name ?? "",
          roles: auth.ctx.roles,
          mustChangePassword: row?.must_change_password ?? false,
        },
        company: company.rows[0] ?? null,
        machineCount: Number(machines.rows[0]?.count ?? 0),
        workerId,
        foremanScope,
      };
    });

    return ok(data);
  } catch (error) {
    return internal(error, "me.get");
  }
}
