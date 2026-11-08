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
  SYNC_ENTITY_TYPE_UNKNOWN: 400,
  SYNC_LOCAL_ID_INVALID: 400,
  SYNC_CLIENT_AT_INVALID: 400,
  SYNC_SINCE_INVALID: 400,
  AUTH_PASSWORD_WEAK: 400,
  AUTH_PASSWORD_WRONG: 400,
  LINK_INVALID: 410,
  USERS_TARGET_PROTECTED: 403,
};

export type ApiMeta = Record<string, unknown>;

export type ApiSuccess<T> = { success: true; data: T; meta?: ApiMeta };
export type ApiFailure = { success: false; error: { code: ErrorCode; message: string } };
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
