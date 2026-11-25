/** GET/POST /api/site-diaries — F9 dnevnik građenja: mjesečni pregled i otvaranje dana. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import type { DiaryStatus } from "@gradix/domain";
import { createDiary, isDiaryStatus, listDiaries, type CreateDiaryInput } from "@/server/diary-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "diary.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const diaries = await listDiaries(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        projectId: params.get("project") ?? params.get("projectId") ?? undefined,
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
        status: isDiaryStatus(params.get("status")) ? (params.get("status") as DiaryStatus) : undefined,
        unsignedOnly: params.get("unsigned") === "1" || params.get("unsigned") === "true",
      },
    );
    return ok({ diaries });
  } catch (error) {
    return internal(error, "site-diaries.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "diary.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as CreateDiaryInput | null;
    if (!body?.projectId || !body.diaryDate) {
      return fail("VALIDATION_FAILED", "projectId i diaryDate su obavezni.");
    }
    const outcome = await createDiary(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      body,
    );
    /* Postojeći dan nije greška: vraćamo njegov ID (sa `code=DIARY_EXISTS`) da šef nastavi isti
       dan (§1.1/1). Status 200 je namjeran — mobilni klijent tada ne prijavljuje grešku. */
    if (outcome.outcome === "CONFLICT") return ok(outcome);
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "site-diaries.create");
  }
}
