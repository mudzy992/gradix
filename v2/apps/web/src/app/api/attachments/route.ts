/**
 * F0.2 — JEDAN obrazac za priloge svih modula.
 *
 * `attachment-service` ne zna ništa o obavezama, tenderima ni pregledima; `attachment-access`
 * kaže koja dozvola treba za koji `entity_type` i u kojoj tabeli entitet živi. Ovdje se zato
 * ne piše `if` po modulu — novi modul dodaje jedan red u mapu, ne novu rutu.
 *
 * POST: klijent šalje ime, veličinu, `sha256` i PRVIH 32 BAJTA fajla. Tip se određuje iz tih
 * bajtova, a ne iz ekstenzije — `.exe` preimenovan u `.pdf` pada ovdje. Red je `pending` do
 * `…/{id}/confirm`.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { AttachmentEntityType, AttachmentRegisterBody } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { ATTACHMENT_ACCESS, attachmentEntityExists } from "@/server/attachment-access";
import {
  isAttachmentServiceError,
  listAttachments,
  registerAttachment,
} from "@/server/attachment-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const parsedType = AttachmentEntityType.safeParse(request.nextUrl.searchParams.get("entityType"));
    const entityId = request.nextUrl.searchParams.get("entityId") ?? "";
    if (!parsedType.success || entityId === "") {
      return fail("VALIDATION_FAILED", "Nedostaje tip ili id entiteta.");
    }
    const entityType = parsedType.data;

    const guardResult = await guard(request, ATTACHMENT_ACCESS[entityType].read);
    if (!guardResult.ok) return guardResult.response;

    // Fail closed until the generic attachment service enforces obligation scope in its transaction.
    if (entityType === "OBLIGATION" && guardResult.ctx.scope !== "COMPANY") return fail("NOT_FOUND", "Obaveza nije pronađena.");
    const pool = await getVerifiedPool();
    if (!(await attachmentEntityExists(pool, guardResult.ctx.companyId, entityType, entityId))) {
      return fail("NOT_FOUND", `${ATTACHMENT_ACCESS[entityType].label} nije pronađen.`);
    }
    return ok({ attachments: await listAttachments(pool, guardResult.ctx.companyId, entityType, entityId) });
  } catch (error) {
    return internal(error, "attachments.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const parsed = AttachmentRegisterBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Nedostaje tip entiteta, ime, veličina ili kontrolni zbir priloga.");
    }
    const { entityType, entityId } = parsed.data;

    const guardResult = await guard(request, ATTACHMENT_ACCESS[entityType].write);
    if (!guardResult.ok) return guardResult.response;

    // Fail closed until the generic attachment service enforces obligation scope in its transaction.
    if (entityType === "OBLIGATION" && guardResult.ctx.scope !== "COMPANY") return fail("NOT_FOUND", "Obaveza nije pronađena.");
    const pool = await getVerifiedPool();
    if (!(await attachmentEntityExists(pool, guardResult.ctx.companyId, entityType, entityId))) {
      return fail("NOT_FOUND", `${ATTACHMENT_ACCESS[entityType].label} nije pronađen.`);
    }

    const result = await registerAttachment(
      pool,
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId },
      entityType,
      entityId,
      {
        fileName: parsed.data.fileName,
        sizeBytes: Number(parsed.data.sizeBytes ?? 0),
        sha256: parsed.data.sha256,
        head: Buffer.from(parsed.data.headBase64 ?? "", "base64"),
      },
    );
    if (isAttachmentServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "attachments.register");
  }
}
