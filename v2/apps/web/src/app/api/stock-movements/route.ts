/** GET/POST /api/stock-movements — F8 kretnje zaliha (stanje je isključivo zbir kretnji). */
import type { NextRequest } from "next/server";
import { StockMovementInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listStockMovements, recordStockMovement } from "@/server/stock-service";

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
    const body = StockMovementInput.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return fail("VALIDATION_FAILED", "Kretnja nije validna.");
    }
    const outcome = await recordStockMovement(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      body.data,
    );
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", "Nemate pravo.");
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message ?? "Artikal ne postoji.");
    if (outcome.outcome === "CONFLICT") {
      if (outcome.code === "STOCK_INSUFFICIENT") return fail("STOCK_INSUFFICIENT", outcome.message ?? "Nema dovoljno zaliha.");
      if (outcome.code === "STOCK_COUNT_IN_PROGRESS") return fail("STOCK_COUNT_IN_PROGRESS", outcome.message ?? "Popis je u toku.");
      return fail("CONFLICT", outcome.message ?? "Konflikt.");
    }
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message ?? "Unos nije validan.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "stock-movements.create");
  }
}
