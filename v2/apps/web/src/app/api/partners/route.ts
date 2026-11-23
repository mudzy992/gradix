/** GET/POST /api/partners — R5.5 partneri za FK na kvarovima. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createPartner, listPartners } from "@/server/partner-service";
import type { PartnerCreateInput } from "@/server/machine-fault-types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "partners.view");
    if (!guardResult.ok) return guardResult.response;
    const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "1";
    const rows = await listPartners(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      { includeInactive },
    );
    return ok({ partners: rows });
  } catch (error) {
    return internal(error, "partners.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "partners.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as PartnerCreateInput | null;
    if (!body?.code || !body.name || !body.kind) {
      return fail("VALIDATION_FAILED", "code, name i kind su obavezni.");
    }
    const outcome = await createPartner(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, body);
    if (outcome.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", outcome.message ?? "Nemate pravo upravljanja.");
    }
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", outcome.message);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "partners.create");
  }
}
