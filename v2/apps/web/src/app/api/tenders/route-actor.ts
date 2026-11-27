/** F7 — jedan način da ruta sastavi `TenderActor` iz sesije; bez kopije u 20 ruta. */
import type { TenderActor } from "@/server/tender-service";
import type { AuthContext } from "@/server/tenant-context";
import type { Role } from "@/server/permissions";

export function tenderActor(ctx: AuthContext): TenderActor {
  return {
    userId: ctx.userId,
    companyId: ctx.companyId,
    roles: ctx.roles as Role[],
    scope: ctx.scope,
    projectIds: ctx.projectIds,
  };
}
