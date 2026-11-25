/** GET/POST /api/stock-items — F8 artikli sa stanjem iz zbira kretnji. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listStockItems, saveStockItem, type StockItemInput } from "@/server/stock-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "stock.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const items = await listStockItems(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        belowMinimumOnly: params.get("belowMinimum") === "1",
        search: params.get("q") ?? undefined,
      },
    );
    return ok({ items });
  } catch (error) {
    return internal(error, "stock-items.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "stock.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as StockItemInput | null;
    if (!body?.code || !body.name) return fail("VALIDATION_FAILED", "code i name su obavezni.");
    const outcome = await saveStockItem(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      null,
      body,
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo.");
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "stock-items.create");
  }
}
