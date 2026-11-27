/**
 * GET /api/notifications — inbox: moja obavještenja + ona za moje role.
 *
 * Ne traži posebnu dozvolu: svako ima pravo na SVOJ inbox. Tuđa obavještenja ne postoje za
 * ovaj upit (filter po `user_id`/`role_target`), a RLS drži firmu.
 */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { listNotifications, unreadCount } from "@/server/notification-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request);
    if (!guardResult.ok) return guardResult.response;

    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const scope = {
      companyId: guardResult.ctx.companyId,
      userId: guardResult.ctx.userId,
      roles: guardResult.ctx.roles,
      scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    };
    const pool = await getVerifiedPool();
    const [notifications, unread] = await Promise.all([
      listNotifications(pool, {
        ...scope,
        unreadOnly: request.nextUrl.searchParams.get("unread") === "1",
        limit: Number.isFinite(limitRaw) ? limitRaw : 30,
      }),
      unreadCount(pool, scope),
    ]);
    return ok({ notifications, unreadCount: unread });
  } catch (error) {
    return internal(error, "notifications.list");
  }
}
