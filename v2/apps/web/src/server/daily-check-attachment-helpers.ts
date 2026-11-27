/** R5.4 shared helpers for daily-check attachments. */
import {
  ATTACHMENT_PREFIX,
  type AllowedContentType,
} from "./storage";
import type { DailyCheckAttachmentRow } from "./daily-check-types";

export type AttachmentServiceError = {
  code: "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT" | "FORBIDDEN";
  message: string;
};

export type AttachmentRequest = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  head: Uint8Array;
};

export const ATTACHMENT_COLUMNS =
  `id, check_id, object_key, file_name, content_type, size_bytes, sha256, status, created_at`;

export function toAttachmentRow(row: Record<string, unknown>): DailyCheckAttachmentRow {
  return {
    id: String(row.id),
    fileName: String(row.file_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    status: String(row.status) as "pending" | "confirmed",
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  };
}

export function checkObjectKey(companyId: string, checkId: string, attachmentId: string): string {
  return `${ATTACHMENT_PREFIX}${companyId}/machine-daily-checks/${checkId}/${attachmentId}`;
}

export function isAttachmentServiceError(value: unknown): value is AttachmentServiceError {
  return Boolean(value && typeof value === "object" && "code" in value && "message" in value);
}

export type { AllowedContentType };
