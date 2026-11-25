/**
 * GET /api/site-diaries/{id}/pdf — PDF dnevnika (§1.7).
 *
 * Do potvrde šablona od vlasnika/pravnika svaki list nosi `DRAFT_FORMAT` pečat. Izvoz se auditira:
 * zakonski dokument koji je izašao iz sistema mora imati trag ko ga je iznio.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { getDiary } from "@/server/diary-service";
import { resolveDiaryTemplate } from "@/server/diary-template-service";
import { buildDiaryPdf } from "@/server/diary-pdf-service";
import { writeAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "diary.view");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;
    const { id } = await context.params;
    const pool = await getVerifiedPool();
    const actor = { userId: ctx.userId, companyId: ctx.companyId, roles: ctx.roles as Role[] };

    const diary = await getDiary(pool, actor, id);
    if (!diary) return fail("NOT_FOUND", "Dnevnik ne postoji.");

    const template = await withCompany(pool, ctx.companyId, (client) => resolveDiaryTemplate(client, ctx.companyId));

    await withCompany(pool, ctx.companyId, async (client) => {
      await writeAudit(client, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        actorEmail: null,
        action: "diary.pdf_exported",
        entityType: "site_diary",
        entityId: id,
        metadata: { status: diary.diary.status, draftFormat: template.draftFormat },
        retentionClass: "ACCESS",
      });
    });

    const bytes = buildDiaryPdf(diary, template);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="dnevnik-${diary.diary.projectCode}-${diary.diary.diaryDate}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return internal(error, "site-diaries.pdf");
  }
}
