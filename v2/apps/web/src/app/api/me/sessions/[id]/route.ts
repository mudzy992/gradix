/**
 * DELETE /api/me/sessions/:id — opoziv jednog SVOG uređaja.
 *
 * Tuđa sesija se ne može opozvati ovdje: upit traži `user_id` iz sesije, pa ID iz tuđeg
 * naloga vraća 0 redova i `NOT_FOUND`. Za tuđe postoji admin ruta sa obaveznim razlogom.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { revokeOwnSession } from "@/server/session-service";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    const result = await revokeOwnSession(
      await getVerifiedPool(),
      { userId: auth.ctx.userId, companyId: auth.ctx.companyId, sessionId: auth.ctx.sessionId },
      id,
      clientIp(request),
    );
    if (!result.ok) return fail("NOT_FOUND", "Sesija nije aktivna. Za odjavu ovog uređaja koristite „Odjava“.");
    return ok({ revoked: result.revoked });
  } catch (error) {
    return internal(error, "me.sessions.revoke");
  }
}
