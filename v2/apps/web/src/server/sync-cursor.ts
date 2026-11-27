import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidCursorSequence } from "@gradix/domain";
import { loadConfig } from "./config";

export type DecodedSyncCursor = { companyId: string; sequence: string };

export class SyncCursorError extends Error {
  readonly code = "SYNC_CURSOR_INVALID" as const;

  constructor() {
    super("Invalid sync cursor.");
    this.name = "SyncCursorError";
  }
}

function signature(encodedPayload: string): string {
  return createHmac("sha256", loadConfig().AUTH_SECRET)
    .update("gradix-sync-cursor:v1:")
    .update(encodedPayload)
    .digest("base64url");
}

/** Cursor is opaque, authenticated, and bound to the active tenant. */
export function encodeSyncCursor(companyId: string, sequence: string): string {
  if (!isValidCursorSequence(sequence)) throw new SyncCursorError();
  const payload = Buffer.from(JSON.stringify({ v: 1, companyId, sequence }), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function decodeSyncCursor(value: string | null, companyId: string): DecodedSyncCursor {
  if (value === null || value === "") return { companyId, sequence: "0" };
  if (value.length > 1024) throw new SyncCursorError();
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new SyncCursorError();
  const [payload, providedSignature] = parts as [string, string];
  const expected = Buffer.from(signature(payload));
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new SyncCursorError();

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<DecodedSyncCursor> & { v?: unknown };
    if (
      parsed.v !== 1 ||
      parsed.companyId !== companyId ||
      typeof parsed.sequence !== "string" ||
      !isValidCursorSequence(parsed.sequence)
    ) throw new SyncCursorError();
    return { companyId, sequence: parsed.sequence };
  } catch (error) {
    if (error instanceof SyncCursorError) throw error;
    throw new SyncCursorError();
  }
}
