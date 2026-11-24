/** GET /api/users/:id/sessions — admin pregled sesija korisnika svoje firme (spec 01 §1.6.29). */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { listUserSessions } from "@/server/session-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await guard(request, "users.manage");
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    const result = await listUserSessions(await getVerifiedPool(), auth.ctx.companyId, id);
    return ok({ sessions: result.sessions });
  } catch (error) {
    return internal(error, "users.sessions.list");
  }
}
