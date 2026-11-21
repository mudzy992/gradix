/** R5.4: daily-check attachments — list + register. Confirm/url in companion file. */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany, type CompanyId } from "@gradix/db";
import { can } from "./permissions";
import type { DailyCheckActor, DailyCheckAttachmentRow } from "./daily-check-types";
import {
  ATTACHMENT_COLUMNS,
  checkObjectKey,
  toAttachmentRow,
  type AttachmentRequest,
  type AttachmentServiceError,
} from "./daily-check-attachment-helpers";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_OBLIGATION,
  detectContentType,
  presignUpload,
  sanitiseFileName,
  storageConfig,
} from "./storage";

export type { AttachmentRequest } from "./daily-check-attachment-helpers";
export { isAttachmentServiceError } from "./daily-check-attachment-helpers";
export {
  confirmDailyCheckAttachment,
  dailyCheckAttachmentDownloadUrl,
} from "./daily-check-attachment-confirm";

export async function listDailyCheckAttachments(
  pool: Pool,
  actor: DailyCheckActor,
  checkId: string,
): Promise<DailyCheckAttachmentRow[] | AttachmentServiceError> {
  if (!can(actor.roles, "machines.check.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const check = await client.query<{ id: string }>(
      "SELECT id FROM public.machine_daily_checks WHERE company_id = $1 AND id = $2",
      [actor.companyId, checkId],
    );
    if (!check.rows[0]) return { code: "NOT_FOUND", message: "Pregled nije pronađen." };
    const rows = await client.query(
      `SELECT ${ATTACHMENT_COLUMNS} FROM public.machine_daily_check_attachments
        WHERE company_id = $1 AND check_id = $2 ORDER BY created_at DESC`,
      [actor.companyId, checkId],
    );
    return rows.rows.map((row) => toAttachmentRow(row as Record<string, unknown>));
  });
}

export async function registerDailyCheckAttachment(
  pool: Pool,
  companyIdValue: CompanyId,
  actor: DailyCheckActor,
  checkId: string,
  input: AttachmentRequest,
): Promise<{ attachment: DailyCheckAttachmentRow; uploadUrl: string; uploadExpiresAt: string } | AttachmentServiceError> {
  if (!can(actor.roles, "machines.check.create")) {
    return { code: "FORBIDDEN", message: "Nemate pravo unosa priloga." };
  }
  return withCompany(pool, companyIdValue, async (client) => {
    const check = await client.query<{ id: string }>(
      "SELECT id FROM public.machine_daily_checks WHERE company_id = $1 AND id = $2",
      [actor.companyId, checkId],
    );
    if (!check.rows[0]) return { code: "NOT_FOUND", message: "Pregled nije pronađen." };
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_ATTACHMENT_BYTES) {
      return { code: "VALIDATION_FAILED", message: "Prilog može imati najviše 10 MB." };
    }
    if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
      return { code: "VALIDATION_FAILED", message: "Kontrolni zbir priloga nije ispravan." };
    }
    const count = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.machine_daily_check_attachments
        WHERE check_id = $1 AND company_id = $2 AND status = 'confirmed'`,
      [checkId, actor.companyId],
    );
    if (Number(count.rows[0]!.n) >= MAX_ATTACHMENTS_PER_OBLIGATION) {
      return {
        code: "CONFLICT",
        message: `Pregled može imati najviše ${MAX_ATTACHMENTS_PER_OBLIGATION} priloga.`,
      };
    }
    const contentType = detectContentType(input.head);
    if (!contentType) {
      return {
        code: "VALIDATION_FAILED",
        message: "Datoteka nije PDF ni slika (JPG, PNG, WebP, HEIC).",
      };
    }
    const duplicate = await client.query(
      `SELECT id FROM public.machine_daily_check_attachments
        WHERE check_id = $1 AND company_id = $2 AND sha256 = $3`,
      [checkId, actor.companyId, input.sha256],
    );
    if (duplicate.rowCount !== 0) {
      return { code: "CONFLICT", message: "Taj prilog je već dodan na ovaj pregled." };
    }
    const config = storageConfig();
    if (!config.configured) return { code: "CONFLICT", message: config.reason };
    const id = `mdca_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const key = checkObjectKey(actor.companyId, checkId, id);
    const upload = await presignUpload({ config, key, contentType });
    await client.query(
      `INSERT INTO public.machine_daily_check_attachments
         (id, company_id, check_id, object_key, file_name, content_type, size_bytes, sha256, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
      [
        id, actor.companyId, checkId, key, sanitiseFileName(input.fileName),
        contentType, input.sizeBytes, input.sha256, actor.userId,
      ],
    );
    const created = await client.query(
      `SELECT ${ATTACHMENT_COLUMNS} FROM public.machine_daily_check_attachments WHERE id = $1 AND company_id = $2`,
      [id, actor.companyId],
    );
    return {
      attachment: toAttachmentRow(created.rows[0]! as Record<string, unknown>),
      uploadUrl: upload.url,
      uploadExpiresAt: upload.expiresAt,
    };
  });
}
