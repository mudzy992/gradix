/** POST /api/me/sessions/revoke-others — „odjavi sve ostale“; tekuća sesija OSTAJE. */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { revokeOtherSessions } from "@/server/session-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    const result = await revokeOtherSessions(
      await getVerifiedPool(),
      { userId: auth.ctx.userId, companyId: auth.ctx.companyId, sessionId: auth.ctx.sessionId },
      clientIp(request),
    );
    return ok(result);
  } catch (error) {
    return internal(error, "me.sessions.revokeOthers");
  }
}
