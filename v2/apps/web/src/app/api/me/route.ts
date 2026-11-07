/**
 * GET /api/me — zaštićena ruta. Vraća identitet iz sesije i broj mašina firme.
 * Ovo je "jedna zaštićena stranica + jedan zapis u bazi" iz R0.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getPool } from "@/server/db";
import { authenticate } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return fail(auth.code, "Niste prijavljeni.");

    const data = await withCompany(getPool(), auth.ctx.companyId, async (client) => {
      const profile = await client.query<{ email: string; first_name: string; last_name: string; must_change_password: boolean }>(
        "SELECT email, first_name, last_name, must_change_password FROM users WHERE id = $1",
        [auth.ctx.userId],
      );
      const company = await client.query<{ name: string; slug: string; currency: string; timezone: string }>(
        "SELECT name, slug, currency, timezone FROM companies WHERE id = $1",
        [auth.ctx.companyId],
      );
      const machines = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM machines",
      );
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
      };
    });

    return ok(data);
  } catch (error) {
    return internal(error, "me.get");
  }
}
