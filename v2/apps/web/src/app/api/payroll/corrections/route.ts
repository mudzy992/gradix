/** GET /api/payroll/corrections (+?period&status) — korekcije poslije LOCKED. */
import type { NextRequest } from "next/server";
import { PayCorrectionValueInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { confirmCorrectionValue, listCorrections } from "@/server/payroll-period-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.view");
    if (!guardResult.ok) return guardResult.response;
    const statusRaw = request.nextUrl.searchParams.get("status");
    const status = statusRaw === "OPEN" || statusRaw === "APPLIED" ? statusRaw : undefined;
    const result = await listCorrections(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        periodId: request.nextUrl.searchParams.get("period") ?? undefined,
        workerId: request.nextUrl.searchParams.get("worker") ?? undefined,
        status,
      },
    );
    if ("code" in result) return fail(result.code as never, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "payroll.corrections");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth=await guard(request,"payroll.manage");
    if(!auth.ok) return auth.response;
    const parsed=PayCorrectionValueInput.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) return fail("VALIDATION_FAILED","Neispravan iznos ili obrazloženje korekcije.");
    const result=await confirmCorrectionValue(await getVerifiedPool(),{
      userId:auth.ctx.userId,companyId:auth.ctx.companyId,roles:auth.ctx.roles as Role[],
    },{correctionId:parsed.data.correction_id,amount:parsed.data.amount,explanation:parsed.data.explanation});
    return "code" in result ? fail(result.code as never,result.message) : ok(result);
  } catch(error) {return internal(error,"payroll.corrections.value");}
}
