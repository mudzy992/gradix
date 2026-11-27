/**
 * GET /api/health/queue — stanje reda poslova (F0.4, spec 12 §15).
 *
 * Zašto odvojeno od liveness-a: liveness ne smije dirati bazu (pad baze ne pravi restart-loop),
 * a ovo JE upit. Ekran `/ured/postavke` pokazuje zaglavljene poslove i zadnji uspjeh canarinca.
 *
 * Dozvola: `users.manage` (OWNER/ADMIN) — operativno stanje sistema nije za svakoga, ali nije
 * ni tajna: poruka kaže „worker ne radi“, ne šta je u porukama.
 */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { queueHealth } from "@/server/queue-health";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "users.manage");
    if (!guardResult.ok) return guardResult.response;
    return ok(await queueHealth(await getVerifiedPool()));
  } catch (error) {
    return internal(error, "health.queue");
  }
}
