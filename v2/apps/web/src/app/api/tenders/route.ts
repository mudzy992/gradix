/** GET/POST /api/tenders — R7 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createTender, listTenders } from "@/server/tender-service";
import type { TenderCreateInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const tenders = await listTenders(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      status,
    );
    return ok({ tenders });
  } catch (error) {
    return internal(error, "tenders.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as TenderCreateInput | null;
    if (!body?.title || !body.partnerId || !body.submittedValueAmount || !body.currencyCode) {
      return fail("VALIDATION_FAILED", "title, partnerId, submittedValueAmount i currencyCode su obavezni.");
    }
    const outcome = await createTender(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      body,
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    if (outcome.outcome === "VALIDATION_FAILED") {
      return fail("VALIDATION_FAILED", outcome.message ?? "Unos nije validan.");
    }
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.create");
  }
}
