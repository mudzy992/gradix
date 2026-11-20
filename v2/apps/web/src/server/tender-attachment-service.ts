/** R7.3: tender_attachments — list + register. */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import type { TenderActor } from "./tender-service";
import {
  isTenderAttachmentError,
  TENDER_ATTACHMENT_COLS,
  toTenderAttachmentRow,
  type TenderAttachmentError,
  type TenderAttachmentRequest,
  type TenderAttachmentRow,
} from "./tender-attachment-types";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_OBLIGATION,
  detectContentType,
  presignUpload,
  sanitiseFileName,
  storageConfig,
  tenderAttachmentObjectKey,
} from "./storage";

export type { TenderAttachmentRow, TenderAttachmentRequest };
export { isTenderAttachmentError };
export {
  confirmTenderAttachment,
  tenderAttachmentDownloadUrl,
} from "./tender-attachment-confirm";

export async function listTenderAttachments(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<TenderAttachmentRow[] | TenderAttachmentError> {
  if (!can(actor.roles, "tenders.view")) return { code: "FORBIDDEN", message: "Nemate pravo pregleda." };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const tender = await client.query(`SELECT 1 FROM public.tenders WHERE id = $1 AND company_id = $2`, [
      tenderId,
      actor.companyId,
    ]);
    if (tender.rowCount === 0) return { code: "NOT_FOUND", message: "Tender nije pronađen." };
    const rows = await client.query(
      `SELECT ${TENDER_ATTACHMENT_COLS} FROM public.tender_attachments
        WHERE company_id = $1 AND tender_id = $2 ORDER BY created_at DESC`,
      [actor.companyId, tenderId],
    );
    return rows.rows.map((row) => toTenderAttachmentRow(row as Record<string, unknown>));
  });
}

export async function registerTenderAttachment(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: TenderAttachmentRequest,
): Promise<{ attachment: TenderAttachmentRow; uploadUrl: string; uploadExpiresAt: string } | TenderAttachmentError> {
  if (!can(actor.roles, "tenders.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo unosa priloga." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const tender = await client.query(`SELECT 1 FROM public.tenders WHERE id = $1 AND company_id = $2`, [
      tenderId,
      actor.companyId,
    ]);
    if (tender.rowCount === 0) return { code: "NOT_FOUND", message: "Tender nije pronađen." };
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_ATTACHMENT_BYTES) {
      return { code: "VALIDATION_FAILED", message: "Prilog može imati najviše 10 MB." };
    }
    if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
      return { code: "VALIDATION_FAILED", message: "Kontrolni zbir priloga nije ispravan." };
    }
    const count = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.tender_attachments
        WHERE tender_id = $1 AND company_id = $2 AND status = 'ready'`,
      [tenderId, actor.companyId],
    );
    if (Number(count.rows[0]!.n) >= MAX_ATTACHMENTS_PER_OBLIGATION) {
      return {
        code: "CONFLICT",
        message: `Tender može imati najviše ${MAX_ATTACHMENTS_PER_OBLIGATION} priloga.`,
      };
    }
    const contentType = detectContentType(input.head);
    if (!contentType) {
      return { code: "VALIDATION_FAILED", message: "Datoteka nije PDF ni slika (JPG, PNG, WebP, HEIC)." };
    }
    const duplicate = await client.query(
      `SELECT id FROM public.tender_attachments WHERE tender_id = $1 AND company_id = $2 AND sha256 = $3`,
      [tenderId, actor.companyId, input.sha256],
    );
    if (duplicate.rowCount !== 0) {
      return { code: "CONFLICT", message: "Taj prilog je već dodan na ovaj tender." };
    }
    const config = storageConfig();
    if (!config.configured) return { code: "CONFLICT", message: config.reason };
    const id = `tat_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const key = tenderAttachmentObjectKey(actor.companyId, tenderId, id);
    const upload = await presignUpload({ config, key, contentType });
    await client.query(
      `INSERT INTO public.tender_attachments
         (id, company_id, tender_id, object_key, file_name, content_type, size_bytes, sha256, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
      [
        id, actor.companyId, tenderId, key, sanitiseFileName(input.fileName),
        contentType, input.sizeBytes, input.sha256, actor.userId,
      ],
    );
    await writeAudit(client, {
      companyId: actor.companyId, actorId: actor.userId, actorEmail: null,
      action: "tender.attachment.registered", entityType: "tender", entityId: tenderId,
      metadata: { attachmentId: id },
    });
    const created = await client.query(
      `SELECT ${TENDER_ATTACHMENT_COLS} FROM public.tender_attachments WHERE id = $1 AND company_id = $2`,
      [id, actor.companyId],
    );
    return {
      attachment: toTenderAttachmentRow(created.rows[0]! as Record<string, unknown>),
      uploadUrl: upload.url,
      uploadExpiresAt: upload.expiresAt,
    };
  });
}
