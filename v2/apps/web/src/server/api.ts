/**
 * Jedan oblik odgovora i zatvoren katalog kodova (A3.3.4, preuzeto iz v1 §2.1).
 * Klijent prevodi po `code`; `message` je rezerva za logove i razvoj.
 */
import { NextResponse } from "next/server";

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_COMPANY_INACTIVE",
  "AUTH_PASSWORD_CHANGE_REQUIRED",
  "AUTH_REFRESH_INVALID",
  "AUTH_REFRESH_REUSE",
  "SYNC_BATCH_TOO_LARGE",
  "SYNC_ENTITY_TYPE_UNKNOWN",
  "SYNC_LOCAL_ID_INVALID",
  "SYNC_CLIENT_AT_INVALID",
  "SYNC_SINCE_INVALID",
  "AUTH_PASSWORD_WEAK",
  "AUTH_PASSWORD_WRONG",
  "LINK_INVALID",
  "USERS_TARGET_PROTECTED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_COMPANY_INACTIVE: 401,
  AUTH_PASSWORD_CHANGE_REQUIRED: 403,
  AUTH_REFRESH_INVALID: 401,
  AUTH_REFRESH_REUSE: 401,
  SYNC_BATCH_TOO_LARGE: 400,
  SYNC_ENTITY_TYPE_UNKNOWN: 400,
  SYNC_LOCAL_ID_INVALID: 400,
  SYNC_CLIENT_AT_INVALID: 400,
  SYNC_SINCE_INVALID: 400,
  AUTH_PASSWORD_WEAK: 400,
  AUTH_PASSWORD_WRONG: 400,
  LINK_INVALID: 410,
  USERS_TARGET_PROTECTED: 403,
};

export function ok<T>(data: T, meta?: Record<string, unknown>): NextResponse {
  return NextResponse.json(meta ? { success: true, data, meta } : { success: true, data });
}

export function fail(code: ErrorCode, message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: STATUS[code] },
  );
}

/** Neočekivana greška: klijent dobija generički kod, detalji idu u log bez PII. */
export function internal(error: unknown, context: string): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: "error", context, msg: message }));
  return fail("INTERNAL", "Došlo je do greške. Pokušajte ponovo.");
}
