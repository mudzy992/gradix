/** GET/POST /api/tenders/:id/attachments — R7.3 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { AttachmentRegisterRequest } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  isTenderAttachmentError,
  listTenderAttachments,
  registerTenderAttachment,
} from "@/server/tender-attachment-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function actorFrom(guardResult: { ctx: { userId: string; companyId: string; roles: readonly string[] } }) {
  return {
    userId: guardResult.ctx.userId,
    companyId: guardResult.ctx.companyId,
    roles: guardResult.ctx.roles as Role[],
  };
}

export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;
    const result = await listTenderAttachments(await getVerifiedPool(), actorFrom(guardResult), id);
    if (isTenderAttachmentError(result)) return fail(result.code, result.message);
    return ok({ attachments: result });
  } catch (error) {
    return internal(error, "tenders.attachments.list");
  }
}

export async function POST(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const guardResult = await guard(request, "tenders.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = AttachmentRegisterRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Nedostaje ime, veličina ili kontrolni zbir priloga.");
    }
    const { id } = await context.params;
    const head = Buffer.from(parsed.data.headBase64 ?? "", "base64");
    const result = await registerTenderAttachment(await getVerifiedPool(), actorFrom(guardResult), id, {
      fileName: parsed.data.fileName,
      sizeBytes: Number(parsed.data.sizeBytes ?? 0),
      sha256: parsed.data.sha256,
      head,
    });
    if (isTenderAttachmentError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "tenders.attachments.register");
  }
}
