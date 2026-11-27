/**
 * POST /api/auth/logout-all — gasi SVE sesije korisnika, uključujući tekuću.
 * Ruta ne zahtijeva posebno pravo: svako smije odjaviti sam sebe svuda.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { writeAudit, ipHash } from "@/server/audit";
import { getVerifiedPool } from "@/server/db";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return fail(auth.code, "Niste prijavljeni.");

    const revoked = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
      const result = await client.query(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id",
        [auth.ctx.userId],
      );
      await writeAudit(client, {
        companyId: auth.ctx.companyId,
        actorId: auth.ctx.userId,
        actorEmail: null,
        action: "session.revoked_all",
        entityType: "user",
        entityId: auth.ctx.userId,
        metadata: { revoked: result.rowCount ?? 0 },
        ipHash: ipHash(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"),
      });
      return result.rowCount ?? 0;
    });

    const response = ok({ revoked });
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  } catch (error) {
    return internal(error, "auth.logoutAll");
  }
}
