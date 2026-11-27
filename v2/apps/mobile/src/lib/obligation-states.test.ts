/**
 * F2 — svako stanje obaveze ima svoj naziv i ton na telefonu.
 *
 * Greška koju ovaj test sprečava: `obligation_state()` u bazi dobije novo stanje, a mobilni
 * ekran ga prikaže kao sirovo `rejected` ili — gore — kao `plain`, pa radnik ne vidi da je
 * blokiran. Provjerava se IZVOR (kao `styles.test.ts`), jer ekran traži native runtime.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "rokovi.tsx"),
  "utf8",
);

/** Stanja iz `OBLIGATION_STATES` u `@gradix/domain` — jedno mjesto istine. */
const STATES = [
  "missing",
  "expired",
  "rejected",
  "pending_review",
  "expiring",
  "review_due",
  "valid",
  "no_expiry",
  "superseded",
] as const;

describe("rokovi na telefonu — F2 stanja", () => {
  it("svako stanje ima bosanski naziv (nijedno se ne prikazuje sirovo)", () => {
    for (const state of STATES) {
      expect(SOURCE, `stanje ${state} nema naziv`).toContain(`${state}: "`);
    }
  });

  it("isteklo i odbijeno su `danger`, a ne `warn` — blokiraju rad", () => {
    expect(SOURCE).toMatch(/state === "expired" \|\| state === "rejected"\) return "danger"/);
  });

  it("uskoro istječe i dospjela provjera su upozorenje, ne blokada", () => {
    expect(SOURCE).toMatch(/state === "expiring" \|\| state === "review_due"\) return "warn"/);
  });

  it("StatusChip prima tri tona (bez `danger` blokada se ne bi vidjela)", () => {
    const ui = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui", "index.tsx"),
      "utf8",
    );
    expect(ui).toMatch(/tone\?: "warn" \| "danger" \| "plain"/);
    expect(ui).toContain("styles.chipDanger");
  });
});
