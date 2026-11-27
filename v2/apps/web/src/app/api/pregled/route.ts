/**
 * GET /api/pregled — C.1 „šta traži pažnju“ (pregled.view, opseg iz sesije).
 *
 * Ruta je tanka namjerno: provjera prava, pa jedan poziv servisu. Sve što odlučuje
 * (šta se broji, čiji opseg, ko vidi sinhronizaciju) živi u `pregled-service`, pa
 * ekran i budući mobilni klijent dobijaju isti odgovor iz istog mjesta.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { buildPregled } from "@/server/pregled-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "pregled.view");
    if (!guardResult.ok) return guardResult.response;

    const ctx = guardResult.ctx;
    const result = await buildPregled(await getVerifiedPool(), ctx.companyId, {
      userId: ctx.userId,
      roles: ctx.roles,
      scope: ctx.scope,
      // `null` (COMPANY) i `[]` (SELF) ovdje su isti za `visibleProjectIds` —
      // ona gleda `scope`, pa niz samo nosi PROJECTS spisak kad postoji.
      projectIds: ctx.projectIds ?? [],
    });
    if (!result) return fail("FORBIDDEN", "Nemate pravo za ovu radnju.");
    return ok(result);
  } catch (error) {
    return internal(error, "pregled.get");
  }
}
