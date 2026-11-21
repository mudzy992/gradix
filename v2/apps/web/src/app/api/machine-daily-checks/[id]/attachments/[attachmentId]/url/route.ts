/** GET signed download URL for daily check attachment. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  dailyCheckAttachmentDownloadUrl,
  isAttachmentServiceError,
} from "@/server/daily-check-attachments";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.view");
    if (!guardResult.ok) return guardResult.response;
    const { id, attachmentId } = await context.params;
    const result = await dailyCheckAttachmentDownloadUrl(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      attachmentId,
    );
    if (isAttachmentServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "machine-daily-checks.attachments.url");
  }
}
