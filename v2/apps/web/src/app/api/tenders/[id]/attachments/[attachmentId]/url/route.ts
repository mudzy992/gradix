/** GET /api/tenders/:id/attachments/:attachmentId/url — R7.3 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  isTenderAttachmentError,
  tenderAttachmentDownloadUrl,
} from "@/server/tender-attachment-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const { id, attachmentId } = await context.params;
    const result = await tenderAttachmentDownloadUrl(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      id,
      attachmentId,
    );
    if (isTenderAttachmentError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "tenders.attachments.url");
  }
}
