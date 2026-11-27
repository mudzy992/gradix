/** GET/POST /api/workers/:id/issuances — zaduženja; izdavanje po šablonu je jedan klik. */
import type { NextRequest } from "next/server";
import { WorkerIssuanceInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { addIssuance, listIssuances } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.issuances.view");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    // Podrazumijevano samo aktivna zaduženja — „ko šta ima kod sebe“ je pitanje koje se postavlja.
    const includeReturned = new URL(request.url).searchParams.get("includeReturned") === "true";
    const result = await listIssuances(
      await getVerifiedPool(),
      guardResult.ctx,
      id,
      includeReturned,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ issuances: result.issuances, activeCount: result.activeCount });
  } catch (error) {
    return internal(error, "workers.issuances.list");
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.issuances.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerIssuanceInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const { id } = await context.params;
    const result = await addIssuance(
      await getVerifiedPool(),
      guardResult.ctx,
      id,
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ issuances: result.issuances, activeCount: result.activeCount });
  } catch (error) {
    return internal(error, "workers.issuances.add");
  }
}
