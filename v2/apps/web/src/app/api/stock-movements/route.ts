/** GET/POST /api/stock-movements — F8 kretnje zaliha (stanje je isključivo zbir kretnji). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listStockMovements, recordStockMovement, type StockMovementInput } from "@/server/stock-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "stock.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const limit = Number(params.get("limit") ?? "200");
    const movements = await listStockMovements(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        itemId: params.get("item") ?? params.get("itemId") ?? undefined,
        limit: Number.isFinite(limit) ? limit : 200,
      },
    );
    return ok({ movements });
  } catch (error) {
    return internal(error, "stock-movements.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "stock.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as StockMovementInput | null;
    if (!body?.itemId || !body.kind || !body.quantity) {
      return fail("VALIDATION_FAILED", "itemId, kind i quantity su obavezni.");
    }
    const outcome = await recordStockMovement(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      body,
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo.");
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message ?? "Artikal ne postoji.");
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message ?? "Unos nije validan.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "stock-movements.create");
  }
}
