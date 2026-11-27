/**
 * Pravila za priloge — čista, bez baze i bez S3.
 *
 * Postoje na jednom mjestu jer ih traže tri strane: web servis (`attachment-service`), rute i
 * testovi. Kad se u Modulu 9 pojavi foto uz servisni nalog, ne treba novo pravilo — samo novi
 * `entity_type` u bazi i dozvola uz modul.
 */

/** Najveći dozvoljeni prilog: 10 MB. Veći fajl se odbija prije nego što dodirne bucket. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Najviše priloga po jednom entitetu (obaveza, tender, pregled mašine). */
export const MAX_ATTACHMENTS_PER_ENTITY = 5;

/**
 * Na šta prilog može biti zakačen. Vrijednosti su iste kao CHECK u bazi.
 *
 * `PROJECT` (F5): fotografija računa sa gradilišta postoji PRIJE troška — prvo se slika, pa se
 * unosi iznos. Prilog zato visi o projektu, a trošak pokazuje na njega kroz
 * `rate_snapshot->>'attachment_id'`.
 */
export const ATTACHMENT_ENTITY_TYPES = ["OBLIGATION", "TENDER", "MACHINE_DAILY_CHECK", "PROJECT"] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export const ATTACHMENT_STATUSES = ["pending", "ready", "deleted"] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export function isAttachmentEntityType(value: unknown): value is AttachmentEntityType {
  return typeof value === "string" && (ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(value);
}

export type AttachmentInputError =
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "CONFLICT"; message: string };

/**
 * Provjere koje ne traže ni bazu ni bucket: veličina i oblik `sha256`.
 * Vraća `null` kad je unos ispravan.
 */
export function validateAttachmentInput(input: {
  sizeBytes: number;
  sha256: string;
}): AttachmentInputError | null {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { code: "VALIDATION_FAILED", message: "Veličina priloga mora biti veća od nule." };
  }
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { code: "VALIDATION_FAILED", message: "Prilog može imati najviše 10 MB." };
  }
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    return { code: "VALIDATION_FAILED", message: "Kontrolni zbir priloga nije ispravan." };
  }
  return null;
}

/** Putanja u bucketu: `gx2/{firma}/{tip}/{entitet}/{prilog}` — tenant je u putanji (ADR 0006). */
export function attachmentObjectKey(
  companyId: string,
  entityType: AttachmentEntityType,
  entityId: string,
  attachmentId: string,
): string {
  return `gx2/${companyId}/${entityType.toLowerCase().replace(/_/g, "-")}/${entityId}/${attachmentId}`;
}
