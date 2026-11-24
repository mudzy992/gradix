/**
 * Envelope i katalog kodova — jedan izvor za web, mobilni i OpenAPI.
 *
 * Zašto u `packages/contracts`, a ne u `apps/web/src/server/api.ts`: klijent (mobilni, i web
 * kad prestane da koristi `fetch` ručno) mora da zna isti oblik odgovora i iste kodove. Ako
 * katalog živi samo na serveru, klijent prepisuje stringove i raziđe se tiho.
 *
 * `ERROR_CODES` je ZATVOREN: nova greška = nova vrijednost ovdje, pa je i u OpenAPI-ju i u
 * klijentu u istom trenutku.
 */

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
  "SYNC_BODY_TOO_LARGE",
  "SYNC_ITEM_TOO_LARGE",
  "SYNC_LOCAL_ID_INVALID",
  "SYNC_ITEM_INVALID",
  "SYNC_CURSOR_INVALID",
  "SYNC_CURSOR_EXPIRED",
  "SYNC_LOCAL_ID_REUSED",
  "SYNC_ITEM_REJECTED",
  "AUTH_PASSWORD_WEAK",
  "AUTH_PASSWORD_WRONG",
  "LINK_INVALID",
  "USERS_TARGET_PROTECTED",
  // Faza 1 — pristup, 2FA, platforma
  "AUTH_2FA_REQUIRED",
  "AUTH_2FA_INVALID",
  "AUTH_2FA_ENROLLMENT_REQUIRED",
  "AUTH_ACCOUNT_LOCKED",
  "AUTH_PASSWORD_REUSED",
  "AUTH_PASSWORD_EXPIRED",
  "PLATFORM_FORBIDDEN",
  "SUPPORT_ACCESS_EXPIRED",
  // Faza 2 — obaveze s rokom
  "OBLIGATION_BLOCKED",
  "OBLIGATION_ATTACHMENT_REQUIRED",
  "OBLIGATION_REVIEW_REQUIRED",
  "OBLIGATION_REQUIREMENT_EXISTS",
  "OBLIGATION_IMPORT_INVALID",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** HTTP status po kodu — klijent ne izmišlja svoj. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
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
  SYNC_BODY_TOO_LARGE: 413,
  SYNC_ITEM_TOO_LARGE: 413,
  SYNC_LOCAL_ID_INVALID: 400,
  SYNC_ITEM_INVALID: 400,
  SYNC_CURSOR_INVALID: 400,
  SYNC_CURSOR_EXPIRED: 409,
  SYNC_LOCAL_ID_REUSED: 409,
  SYNC_ITEM_REJECTED: 409,
  AUTH_PASSWORD_WEAK: 400,
  AUTH_PASSWORD_WRONG: 400,
  LINK_INVALID: 410,
  USERS_TARGET_PROTECTED: 403,
  // Faza 1 — pristup, 2FA, platforma
  AUTH_2FA_REQUIRED: 401,
  AUTH_2FA_INVALID: 401,
  AUTH_2FA_ENROLLMENT_REQUIRED: 403,
  AUTH_ACCOUNT_LOCKED: 423,
  AUTH_PASSWORD_REUSED: 400,
  AUTH_PASSWORD_EXPIRED: 403,
  PLATFORM_FORBIDDEN: 403,
  OBLIGATION_BLOCKED: 409,
  OBLIGATION_ATTACHMENT_REQUIRED: 422,
  OBLIGATION_REVIEW_REQUIRED: 409,
  OBLIGATION_REQUIREMENT_EXISTS: 409,
  OBLIGATION_IMPORT_INVALID: 400,
  SUPPORT_ACCESS_EXPIRED: 403,
};

export type ApiMeta = Record<string, unknown>;

export type ApiSuccess<T> = { success: true; data: T; meta?: ApiMeta };
export type ApiFailure = {
  success: false;
  error: { code: ErrorCode; message: string };
};
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
