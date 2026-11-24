/**
 * Worker testovi — bez baze. Provjeravaju odluke koje se lako pokvare tiho.
 *
 * Zašto bez baze: worker integraciju ima u `apps/web` (`notification.integration.test.ts`),
 * a ovdje se testira ono što bi inače ostalo nepokriveno — konfiguracija koja mora pasti
 * jasno, stabilna imena poslova (na njima visi `/api/health/queue`) i razlika između
 * „kanal nije podešen“ i „poslali smo i nije uspjelo“.
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { JOB_NAMES, pingHealth, type JobLogger } from "./jobs";
import { pushConfigured, smtpConfigured } from "./notifications-deliver";

describe("loadConfig", () => {
  it("pada bez DATABASE_ADMIN_URL — worker koji tiho ne radi je gori od ugašenog", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_ADMIN_URL/);
  });

  it("prazan string nije vrijednost", () => {
    expect(() => loadConfig({ DATABASE_ADMIN_URL: "   " })).toThrow(/DATABASE_ADMIN_URL/);
  });

  it("defaulti su ono što piše u spec 12 §13", () => {
    const config = loadConfig({ DATABASE_ADMIN_URL: "postgresql://x" });
    expect(config.reminderIntervalMinutes).toBe(15);
    expect(config.jobExpireMinutes).toBe(15);
    expect(config.concurrency).toBe(4);
    expect(config.logLevel).toBe("info");
    // pg-boss šema ide u istu bazu osim ako nije zadano drugačije.
    expect(config.bossDatabaseUrl).toBe("postgresql://x");
  });

  it("BOSS_DATABASE_URL odvaja red od poslovnih podataka", () => {
    const config = loadConfig({
      DATABASE_ADMIN_URL: "postgresql://posao",
      BOSS_DATABASE_URL: "postgresql://red",
      REMINDER_INTERVAL_MINUTES: "1",
    });
    expect(config.bossDatabaseUrl).toBe("postgresql://red");
    expect(config.reminderIntervalMinutes).toBe(1);
  });
});

describe("JOB_NAMES", () => {
  it("imena poslova su stabilna — na njima visi stanje reda i stari redovi u bazi", () => {
    expect(JOB_NAMES).toEqual({
      pingHealth: "ping.health",
      notificationsDeliver: "notifications.deliver",
    });
  });
});

describe("ping.health", () => {
  it("vraća trenutak i loguje ga; ništa ne dira bazu", async () => {
    const logged: string[] = [];
    const logger: JobLogger = {
      info: (message) => logged.push(message),
      warn: () => undefined,
      error: () => undefined,
    };
    const result = await pingHealth(logger)();
    expect(result.ok).toBe(true);
    expect(Number.isNaN(Date.parse(result.at))).toBe(false);
    expect(logged).toEqual(["ping.health"]);
  });
});

describe("kanali", () => {
  it("bez SMTP_HOST i SMTP_FROM email je nepostojeći, ne pokvaren", () => {
    expect(smtpConfigured({})).toBe(false);
    expect(smtpConfigured({ SMTP_HOST: "smtp.example.com" })).toBe(false);
    expect(smtpConfigured({ SMTP_FROM: "gradix@example.com" })).toBe(false);
    expect(smtpConfigured({ SMTP_HOST: "smtp.example.com", SMTP_FROM: "g@e.com" })).toBe(true);
  });

  it("push bez Expo tokena nije podešen", () => {
    expect(pushConfigured({})).toBe(false);
    expect(pushConfigured({ EXPO_ACCESS_TOKEN: "  " })).toBe(false);
    expect(pushConfigured({ EXPO_ACCESS_TOKEN: "tok" })).toBe(true);
  });
});
