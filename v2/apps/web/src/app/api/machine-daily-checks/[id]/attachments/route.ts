/** GET/POST attachments for machine daily checks. */
import type { NextRequest } from "next/server";
import { AttachmentRegisterRequest } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  isAttachmentServiceError,
  listDailyCheckAttachments,
  registerDailyCheckAttachment,
} from "@/server/daily-check-attachments";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const result = await listDailyCheckAttachments(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    }, id);
    if (isAttachmentServiceError(result)) return fail(result.code, result.message);
    return ok({ attachments: result });
  } catch (error) {
    return internal(error, "machine-daily-checks.attachments.list");
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.create");
    if (!guardResult.ok) return guardResult.response;
    const parsed = AttachmentRegisterRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Nedostaje ime, veličina ili kontrolni zbir priloga.");
    }
    const head = Buffer.from(parsed.data.headBase64 ?? "", "base64");
    const { id } = await context.params;
    const result = await registerDailyCheckAttachment(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
      },
      id,
      {
        fileName: parsed.data.fileName,
        sizeBytes: Number(parsed.data.sizeBytes ?? 0),
        sha256: parsed.data.sha256,
        head,
      },
    );
    if (isAttachmentServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "machine-daily-checks.attachments.register");
  }
}
