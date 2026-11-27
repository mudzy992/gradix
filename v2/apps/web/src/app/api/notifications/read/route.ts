/**
 * POST /api/notifications/read — označi jedno ili sva VIDLJIVA obavještenja kao pročitana.
 *
 * Tuđe se ne može označiti: servis traži `user_id = moj` ili `role_target` u mojim rolama.
 * Bez toga bi jedan korisnik mogao „počistiti“ inbox drugome i sakriti poruku.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { NotificationReadInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { markRead } from "@/server/notification-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request);
    if (!guardResult.ok) return guardResult.response;

    const parsed = NotificationReadInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje id obavještenja ili oznaka „sve“.");
    if (!parsed.data.all && !parsed.data.id) {
      return fail("VALIDATION_FAILED", "Navedite id obavještenja ili označite „sve“.");
    }

    const updated = await markRead(await getVerifiedPool(), {
      companyId: guardResult.ctx.companyId,
      userId: guardResult.ctx.userId,
      roles: guardResult.ctx.roles,
      scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
      ...(parsed.data.id ? { notificationId: parsed.data.id } : {}),
      ...(parsed.data.all ? { all: true } : {}),
    });
    return ok({ updated });
  } catch (error) {
    return internal(error, "notifications.read");
  }
}
