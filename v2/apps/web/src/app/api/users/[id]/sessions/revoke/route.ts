/**
 * POST /api/users/:id/sessions/revoke — admin opoziv tuđe sesije.
 * Razlog je OBAVEZAN: opoziv tuđe sesije liči na napad, pa trag mora reći zašto.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { revokeUserSessionAsAdmin } from "@/server/session-service";

export const dynamic = "force-dynamic";

const Body = z.object({
  sessionId: z.string().min(1).max(128),
  reason: z.string().min(10, "Razlog je obavezan (najmanje 10 znakova).").max(500),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await guard(request, "users.manage");
    if (!auth.ok) return auth.response;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Neispravan unos.");
    }
    const { id } = await context.params;
    const result = await revokeUserSessionAsAdmin(
      await getVerifiedPool(),
      {
        userId: auth.ctx.userId,
        companyId: auth.ctx.companyId,
        actorEmail: null,
        roles: auth.ctx.roles,
      },
      id,
      parsed.data.sessionId,
      parsed.data.reason,
      clientIp(request),
    );
    if (!result.ok) return fail(result.code, result.message);
    return ok({ revoked: result.revoked });
  } catch (error) {
    return internal(error, "users.sessions.revoke");
  }
}
