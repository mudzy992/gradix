/** POST …/confirm — prilog postaje `ready` tek kad objekat stvarno postoji i veličina se slaže. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { confirmAttachment, isServiceError } from "@/server/obligation-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const { id, attachmentId } = await context.params;
    const result = await confirmAttachment(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      attachmentId,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.attachments.confirm");
  }
}
