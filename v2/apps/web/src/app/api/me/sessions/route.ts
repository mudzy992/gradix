/** GET /api/me/sessions — moji uređaji (spec 01 §1.6.28). */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { listSessions } from "@/server/session-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    const sessions = await listSessions(
      await getVerifiedPool(),
      auth.ctx.companyId,
      auth.ctx.userId,
      auth.ctx.sessionId,
    );
    return ok({ sessions });
  } catch (error) {
    return internal(error, "me.sessions.list");
  }
}
