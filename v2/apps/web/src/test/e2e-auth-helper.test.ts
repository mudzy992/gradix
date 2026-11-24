/**
 * Test helpera za E2E prijavu — bez preglednika i bez baze.
 *
 * Uzrok koji ovaj test čuva: TOTP replay zaštita (`last_used_step`) odbija kod čiji je
 * korak `<=` zadnji iskorišteni. E2E prijavljuje iste demo naloge desetinama puta u minuti,
 * pa je drugi login u istom koraku padao kao „pogrešan kod". Rješenje ne spava 30 s po
 * prijavi, nego koristi dozvoljeni prozor ±1 korak da pomjeri brojač unaprijed.
 *
 * Ovdje je server simuliran TAČNO pravilom iz `verifyTotp`, pa test pada ako helper prestane
 * da poštuje to pravilo — a to je ono što je oborilo CI.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { totpCode, totpStep, TOTP_PERIOD_SECONDS } from "@gradix/domain/server";
import { E2E_TOTP_SECRET, freshTotpCode } from "../../e2e/helpers/auth";

/** Server: pamti zadnji iskorišteni korak, prihvata prozor ±1 kao `verifyTotp`. */
function fakeServer() {
  let lastUsed: number | null = null;
  let calls = 0;
  const attempt = async (code: string): Promise<boolean> => {
    calls += 1;
    const current = totpStep(Date.now());
    for (let offset = -1; offset <= 1; offset += 1) {
      const step = current + offset;
      if (code === totpCode(E2E_TOTP_SECRET, step)) {
        if (lastUsed !== null && step <= lastUsed) return false;
        lastUsed = step;
        return true;
      }
    }
    return false;
  };
  /** Ono što radi `resetTotpReplayGuard` u bazi: `last_used_step = NULL`. */
  const reset = (): void => {
    lastUsed = null;
  };
  return { attempt, reset, stats: () => ({ calls, lastUsed }) };
}

describe("freshTotpCode", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("prva prijava prolazi bez čekanja", async () => {
    const server = fakeServer();
    const started = Date.now();
    expect(await freshTotpCode(server.attempt, "owner-a")).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("drugi login u istom periodu prolazi bez čekanja (dozvoljeni prozor)", async () => {
    const server = fakeServer();
    const started = Date.now();
    expect(await freshTotpCode(server.attempt, "owner-b")).toBe(true);
    expect(await freshTotpCode(server.attempt, "owner-b")).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("reset brojača = deset prijava bez čekanja (putanja koju koristi CI)", async () => {
    const server = fakeServer();
    // `resetTotpReplayGuard` vraća false bez `E2E_RESET_TOTP_STEP=1`; ovdje se poziva isto
    // što helper radi u CI-ju prije svake prijave.
    const start = Date.now();
    for (let i = 0; i < 10; i += 1) {
      server.reset();
      expect(await freshTotpCode(server.attempt, "owner-d")).toBe(true);
    }
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it("kad prozor padne a reset nije dostupan, helper čeka novi period i uspije", async () => {
    vi.useFakeTimers();
    try {
      const server = fakeServer();
      expect(await freshTotpCode(server.attempt, "owner-e")).toBe(true);
      expect(await freshTotpCode(server.attempt, "owner-e")).toBe(true);
      // Treći pokušaj troši prozor; helper tada spava do prvog neviđenog koraka.
      const third = freshTotpCode(server.attempt, "owner-e");
      await vi.advanceTimersByTimeAsync(TOTP_PERIOD_SECONDS * 1_000 + 500);
      expect(await third).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pamti stanje po nalogu — dva naloga se ne ometaju", async () => {
    const first = fakeServer();
    const second = fakeServer();
    expect(await freshTotpCode(first.attempt, "owner-c")).toBe(true);
    expect(await freshTotpCode(second.attempt, "admin-c")).toBe(true);
    expect(await freshTotpCode(first.attempt, "owner-c")).toBe(true);
    expect(await freshTotpCode(second.attempt, "admin-c")).toBe(true);
  });
});
