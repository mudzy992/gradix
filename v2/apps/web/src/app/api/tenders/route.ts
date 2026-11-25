/** GET/POST /api/tenders — R7/F7 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createTender, listTenders } from "@/server/tender-service";
import { seedTenderChecklist } from "@/server/tender-checklist-service";
import { withCompany } from "@gradix/db";
import { companyId as toCompanyId } from "@gradix/db";
import type { TenderCreateInput } from "@gradix/contracts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const tenders = await listTenders(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        status: params.get("status") ?? undefined,
        urgent: params.get("urgent") === "1" || params.get("urgent") === "true",
      },
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
    const pool = await getVerifiedPool();
    const actor = {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    };
    const outcome = await createTender(pool, actor, body);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    if (outcome.outcome === "CONFLICT") {
      return fail((outcome.code as "TENDER_REFERENCE_TAKEN") ?? "CONFLICT", outcome.message ?? "Konflikt.");
    }
    if (outcome.outcome === "VALIDATION_FAILED") {
      return fail("VALIDATION_FAILED", outcome.message ?? "Unos nije validan.");
    }
    /* Checklista iz šifarnika nastaje ODMAH pri unosu: prazna lista bi izgledala kao da sve
       treba ručno dodati, a firma je šifarnik već odredila. */
    if (outcome.outcome === "OK" && outcome.id) {
      const createdId = outcome.id;
      await withCompany(pool, toCompanyId(actor.companyId), (client) =>
        seedTenderChecklist(client, actor, createdId),
      );
    }
    return ok(outcome);
  } catch (error) {
    return internal(error, "tenders.create");
  }
}
