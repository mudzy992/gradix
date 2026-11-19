/** POST confirm attachment upload for daily check. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  confirmDailyCheckAttachment,
  isAttachmentServiceError,
} from "@/server/daily-check-attachments";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.create");
    if (!guardResult.ok) return guardResult.response;
    const { id, attachmentId } = await context.params;
    const result = await confirmDailyCheckAttachment(
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
    return internal(error, "machine-daily-checks.attachments.confirm");
  }
}
