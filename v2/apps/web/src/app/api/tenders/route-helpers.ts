/**
 * F7 — zajedničke male funkcije za tenderske rute: prevod ishoda servisa u HTTP odgovor.
 *
 * Zašto helper: ista mapa `outcome → errо kod` ponavlja se u 20 ruta, a jedna zaboravljena
 * grana pretvara „nemaš pravo“ u 500. Ovdje je jedno mjesto i jedan test.
 */
import { fail } from "@/server/api";
import type { ErrorCode } from "@/server/api";

export type OutcomeLike = {
  outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "NOT_FOUND";
  code?: string;
  message?: string;
};

/** Kod iz `code` polja ako je u katalogu; inače kod po vrsti ishoda. */
const KNOWN_CODES = new Set<string>([
  "TENDER_CHECKLIST_INCOMPLETE",
  "TENDER_DEADLINE_REQUIRED",
  "TENDER_DECISION_REQUIRED",
  "TENDER_OUTCOME_REASON_REQUIRED",
  "TENDER_PRICE_APPROVAL_REQUIRED",
  "TENDER_REFERENCE_TAKEN",
  "TENDER_INVALID_STATUS",
  "ALREADY_CONVERTED",
]);

export function failFromOutcome(outcome: OutcomeLike): Response {
  const fallback: Record<OutcomeLike["outcome"], ErrorCode> = {
    FORBIDDEN: "FORBIDDEN",
    VALIDATION_FAILED: "VALIDATION_FAILED",
    CONFLICT: "CONFLICT",
    NOT_FOUND: "NOT_FOUND",
  };
  const code = outcome.code && KNOWN_CODES.has(outcome.code) ? (outcome.code as ErrorCode) : fallback[outcome.outcome];
  return fail(code, outcome.message ?? "Zahtjev nije uspio.");
}
