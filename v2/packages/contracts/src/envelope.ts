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
  "STOCK_COUNT_IN_PROGRESS",
  "STOCK_INSUFFICIENT",
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
  // Faza 3 — radno vrijeme i radnici
  "WORKDAY_ALREADY_OPEN",
  "WORKDAY_FORGOTTEN",
  "WORKDAY_LOCKED",
  // Radnici
  "WORKER_SENSITIVE_FORBIDDEN",
  "WORKER_HAS_ACTIVE_ISSUANCES",
  "RATE_OVERLAP",
  // Faza 4 — mehanizacija (spec 05)
  "MACHINE_DOUBLE_BOOKED",
  "FUEL_DEVIATION_EXPLANATION_REQUIRED",
  "COST_RATE_MANUAL_OVERRIDE",
  /* Faza 5 — Modul 6: projekti, budžet, knjiženje troška, zatvaranje. */
  "BUDGET_REVISION_CONFLICT",
  "PROJECT_CLOSED",
  /* F6 (Modul 7): nedostatak podatka je IMENOVANA blokada, ne prazna linija i ne nula. */
  "RATE_MISSING",
  "PARAMETER_MISSING",
  "PERIOD_NOT_READY",
  "SELF_APPROVAL_FORBIDDEN",
  "PERIOD_LOCKED_CORRECTION",
  "NEGATIVE_NET_FORBIDDEN",
  "PAYROLL_ALREADY_LOCKED",
  "PAYMENT_FORMAT_UNSUPPORTED",
  "COST_ALREADY_POSTED",
  "COST_REVERSAL_REASON_REQUIRED",
  "PHASE_WEIGHT_REQUIRED",
  "PROJECT_CLOSE_CHECKLIST_INCOMPLETE",
  "COST_ENTRY_IMMUTABLE",
  "COST_ENTRY_DELETE_FORBIDDEN",
  /* F7 (Modul 8): tenderi. Svaki kod imenuje RAZLOG zašto tok ne ide dalje, jer poruka
     „nije moguće“ ne kaže čovjeku šta da donese, odobri ili upiše. */
  "TENDER_CHECKLIST_INCOMPLETE",
  "TENDER_DEADLINE_REQUIRED",
  "TENDER_DECISION_REQUIRED",
  "TENDER_OUTCOME_REASON_REQUIRED",
  "TENDER_PRICE_APPROVAL_REQUIRED",
  "TENDER_REFERENCE_TAKEN",
  "TENDER_INVALID_STATUS",
  "ALREADY_CONVERTED",
  /* F9 (Modul 10): dnevnik građenja i HSE. Kodovi imenuju RAZLOG, jer „nije moguće“ ne kaže
     čovjeku da li da potpiše, dopuni ili traži reviziju. */
  "DIARY_ALREADY_LOCKED",
  "DIARY_SIGNATURE_REQUIRED",
  "DIARY_REASON_REQUIRED",
  "DIARY_EXISTS",
  "HSE_ACTION_RESPONSIBLE_REQUIRED",
  "HSE_ACTION_DUE_REQUIRED",
  "HSE_INCIDENT_IMMUTABLE",
  "HSE_REPORT_OBLIGATION_REQUIRED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** HTTP status po kodu — klijent ne izmišlja svoj. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STOCK_COUNT_IN_PROGRESS: 409,
  STOCK_INSUFFICIENT: 409,
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
  // Faza 3 — radno vrijeme i radnici
  WORKDAY_ALREADY_OPEN: 409,
  // 409, a ne 400: dan postoji i nije greška u unosu — traži odluku (zatvori ili „ne znam").
  WORKDAY_FORGOTTEN: 409,
  // 422: zahtjev je ispravan, ali stanje na terenu ga ne dozvoljava (npr. izmjena zaključanog dana).
  WORKDAY_LOCKED: 422,
  WORKER_SENSITIVE_FORBIDDEN: 403,
  WORKER_HAS_ACTIVE_ISSUANCES: 409,
  RATE_OVERLAP: 409,
  /*
   * 409, a ne 400: zahtjev je ispravan, ali mašina je već na drugom projektu u tom periodu.
   * Klijent tada nudi iznimku (Modul 2), ne ispravku unosa — zato konflikt, ne validacija.
   */
  MACHINE_DOUBLE_BOOKED: 409,
  /*
   * 422: upozorenje o odstupanju goriva postoji i ne zatvara se bez razloga. Samo TOČENJE je
   * uvijek dopušteno (spec 05 §1.3.15); ovaj kod se vraća kad se upozorenje pokuša zatvoriti
   * bez razloga ili sa prekratkom napomenom.
   */
  FUEL_DEVIATION_EXPLANATION_REQUIRED: 422,
  /*
   * 422: ručna stopa bez razloga (≥10 znakova) nije dozvoljena. Zašto ne 400: polja su formalno
   * ispravna, ali radnja nije dopuštena dok nedostaje obrazloženje koje ide u audit.
   */
  COST_RATE_MANUAL_OVERRIDE: 422,
  /*
   * F5. `BUDGET_REVISION_CONFLICT` je 409: dvije osobe su uzele isti broj revizije — to je
   * istinska trka, a ne loš unos. `PROJECT_CLOSED` je 422: zahtjev je ispravan, ali projekat je
   * zatvoren i knjiženje traži eksplicitno ponovno otvaranje (odluka, ne ispravka).
   */
  BUDGET_REVISION_CONFLICT: 409,
  PROJECT_CLOSED: 422,
  /*
   * F6: `RATE_MISSING` i `PARAMETER_MISSING` su 422 — zahtjev je ispravan, ali obračun ne može
   * izdati iznos bez podatka. 400 bi rekao „loš unos“, a ovdje unos nije problem: nedostaje
   * PODATAK u šifarniku, i to se rješava dodavanjem satnice/parametra.
   *
   * `PERIOD_NOT_READY` je 409: period postoji, ali nije u stanju za radnju (npr. odobrenje bez
   * izračuna) — stanje, ne unos. `SELF_APPROVAL_FORBIDDEN` je 403: dozvola postoji, ali je radnja
   * zabranjena radi kontrole. `PAYROLL_ALREADY_LOCKED` je 409.
   */
  RATE_MISSING: 422,
  PARAMETER_MISSING: 422,
  PERIOD_NOT_READY: 409,
  SELF_APPROVAL_FORBIDDEN: 403,
  PERIOD_LOCKED_CORRECTION: 409,
  NEGATIVE_NET_FORBIDDEN: 422,
  PAYROLL_ALREADY_LOCKED: 409,
  PAYMENT_FORMAT_UNSUPPORTED: 400,
  /* Storno već storniranog / već knjiženog zapisa — stanje, ne unos. */
  COST_ALREADY_POSTED: 409,
  /*
   * 422: storno bez razloga nije dozvoljen. Ista logika kao kod ručne stope — polja su
   * formalno ispravna, ali radnja mijenja knjigu i traži obrazloženje koje ide u audit.
   */
  COST_REVERSAL_REASON_REQUIRED: 422,
  /* Faza bez težine ne može ući u ukupni napredak (§1.1.2) — traži se podatak, ne ispravka. */
  PHASE_WEIGHT_REQUIRED: 422,
  /* Kontrolna lista pri zatvaranju nije kompletna; `message` nosi koje stavke blokiraju. */
  PROJECT_CLOSE_CHECKLIST_INCOMPLETE: 422,
  /* Ledger je append-only: iznos/izvor/projekat se ne prepisuju (triger u bazi). */
  COST_ENTRY_IMMUTABLE: 422,
  COST_ENTRY_DELETE_FORBIDDEN: 403,
  /*
   * F7: svi tenderski kodovi su 422 osim dva konflikta.
   *  - 422 `TENDER_CHECKLIST_INCOMPLETE`/`DEADLINE_REQUIRED`/`DECISION_REQUIRED`/
   *    `OUTCOME_REASON_REQUIRED`/`PRICE_APPROVAL_REQUIRED`: zahtjev je formalno ispravan, ali
   *    nedostaje PODATAK ili ODOBRENJE — to se rješava dopunom, ne ispravkom unosa.
   *  - 409 `TENDER_REFERENCE_TAKEN`: referentni broj je zauzet — ista trka kao duplikat šifre.
   *  - 409 `TENDER_INVALID_STATUS`: tok ne dozvoljava taj prelaz — stanje, ne unos.
   *  - 409 `ALREADY_CONVERTED`: konverzija je već obavljena (postojeće ponašanje R7).
   */
  TENDER_CHECKLIST_INCOMPLETE: 422,
  TENDER_DEADLINE_REQUIRED: 422,
  TENDER_DECISION_REQUIRED: 422,
  TENDER_OUTCOME_REASON_REQUIRED: 422,
  TENDER_PRICE_APPROVAL_REQUIRED: 422,
  TENDER_REFERENCE_TAKEN: 409,
  TENDER_INVALID_STATUS: 409,
  ALREADY_CONVERTED: 409,
  /*
   * F9:
   *  - 422 `DIARY_ALREADY_LOCKED`: zahtjev je ispravan, ali dokument je zaključan — ispravka ide
   *    kroz reviziju sa razlogom (odluka, ne ispravka unosa).
   *  - 422 `DIARY_SIGNATURE_REQUIRED`/`HSE_ACTION_*`: nedostaje PODATAK koji radnju čini dokazom.
   *  - 409 `DIARY_EXISTS`: dan već postoji — ista trka kao dvije šifre, klijent nastavlja taj dan.
   *  - 422 `HSE_INCIDENT_IMMUTABLE`: činjenice incidenta se dopunjuju, ne prepisuju.
   */
  DIARY_ALREADY_LOCKED: 422,
  DIARY_SIGNATURE_REQUIRED: 422,
  DIARY_REASON_REQUIRED: 422,
  DIARY_EXISTS: 409,
  HSE_ACTION_RESPONSIBLE_REQUIRED: 422,
  HSE_ACTION_DUE_REQUIRED: 422,
  HSE_INCIDENT_IMMUTABLE: 422,
  HSE_REPORT_OBLIGATION_REQUIRED: 422,
};

/*
 * „Rad bez važeće dodjele" NIJE kod greške (spec 03 §1.6.25): to je upozorenje koje ide uz
 * uspješan odgovor (`assignmentWarning` u danu). Katalog kodova je za neuspjehe, pa ga ovdje
 * nema — inače bi klijent imao dvije istine o istom slučaju.
 */

export type ApiMeta = Record<string, unknown>;

export type ApiSuccess<T> = { success: true; data: T; meta?: ApiMeta };
export type ApiFailure = {
  success: false;
  error: { code: ErrorCode; message: string };
};
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
