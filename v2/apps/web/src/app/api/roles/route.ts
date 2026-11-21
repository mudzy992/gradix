/**
 * GET /api/roles — matrica rola za pregled.
 *
 * Građena iz `PERMISSIONS` (jedan izvor sa rutama), pa ekran ne može prikazati dozvolu koju
 * ruta ne provjerava. `editable: false` je namjerno: R1 ima matricu kao pregled, ne kao
 * uređivanje dozvola.
 */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { guard } from "@/server/guard";
import { roleMatrix } from "@/server/rbac-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "roles.view");
    if (!guardResult.ok) return guardResult.response;
    return ok(roleMatrix(guardResult.ctx.roles));
  } catch (error) {
    return internal(error, "roles.matrix");
  }
}
