/**
 * GET /api/me/blockers — šta blokira MENE i mašine koje smijem koristiti.
 *
 * Mobilni dobija ODLUKU servera (spec 02 §20) i ne može je zaobići; UI samo prikazuje.
 * Isti odgovor koristi web, pa traka na terenu i traka u uredu ne mogu reći dvije stvari.
 */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { can, PERMISSIONS } from "@/server/permissions";
import { meBlockers, withMessages } from "@/server/usage-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request);
    if (!guardResult.ok) return guardResult.response;

    const data = await meBlockers(await getVerifiedPool(), {
      companyId: guardResult.ctx.companyId,
      userId: guardResult.ctx.userId,
      roles: guardResult.ctx.roles,
      scope: guardResult.ctx.scope,
      projectIds: guardResult.ctx.projectIds,
      // Dozvole se izvode iz rola ISTOM tabelom koju koristi `guard` — nema drugog spiska.
      permissions: Object.keys(PERMISSIONS).filter((permission) =>
        can(guardResult.ctx.roles, permission as keyof typeof PERMISSIONS),
      ),
    });

    return ok({
      today: data.today,
      workerId: data.workerId,
      worker: data.worker
        ? { assign: withMessages(data.worker.assign), workday: withMessages(data.worker.workday) }
        : null,
      machines: data.machines.map((machine) => ({
        id: machine.id,
        code: machine.code,
        name: machine.name,
        haul: withMessages(machine.haul),
        machineHours: withMessages(machine.machineHours),
        fuel: withMessages(machine.fuel),
      })),
    });
  } catch (error) {
    return internal(error, "me.blockers");
  }
}
