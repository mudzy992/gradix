/**
 * Anotacije za pad testa.
 *
 * Zašto: logovi Actions koraka su kroz API nedostupni (blob host vraća `EOF`), a anotacije
 * prolaze. Bez ovoga pad E2E-a izgleda kao „job je potrošio budžet" — bez imena testa i bez
 * ijedne poruke. Ovo je jedini kanal dijagnostike koji stvarno stiže do nas.
 */
import { test as base, type TestInfo } from "@playwright/test";

/** Jedna linija: anotacije u Actions UI-ju ne primaju višeredni tekst. */
function oneLine(value: string, max = 700): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function announceFailure(testInfo: TestInfo, error: unknown): void {
  if (testInfo.status === testInfo.expectedStatus) return;
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  testInfo.annotations.push({ type: "pad", description: oneLine(message) });
  // `::error` iz testa ide u anotacije koraka; `github` reporter sam ne objavljuje poruku.
  // `warn` je dozvoljen lintom, a u Actions UI-ju nosi istu težinu kao `error` anotacija.
  console.warn(`::error title=E2E ${testInfo.title.slice(0, 60)}::${oneLine(message)}`);
}

/** `test` koji na pad objavi ime i grešku. Ostalo je isti Playwright API. */
export const test = base.extend<{ _announce: void }>({
  _announce: [
    // eslint-disable-next-line no-empty-pattern -- auto-fixture bez zavisnosti, samo hook.
    async ({}, use, testInfo) => {
      await use();
      const failure = testInfo.errors[0]?.error ?? testInfo.errors[0]?.message;
      if (failure !== undefined) announceFailure(testInfo, failure);
    },
    { auto: true },
  ],
});
