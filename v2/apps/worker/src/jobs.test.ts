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
import { createObjectRemover } from "./object-storage";
import { daysWord, localDate, localHour } from "./reminders-scan";
import {
  alertBody,
  alertTitle,
  centsToText,
  evaluateThresholds,
  type ThresholdCandidate,
} from "./budget-thresholds";

describe("loadConfig", () => {
  it("pada bez ijednog URL-a — worker koji tiho ne radi je gori od ugašenog", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("prazan string nije vrijednost", () => {
    expect(() => loadConfig({ DATABASE_URL: "   ", DATABASE_ADMIN_URL: "  " })).toThrow(
      /DATABASE_URL/,
    );
  });

  // Coolify deploy često ima SAMO `DATABASE_URL` (jedna varijabla za web i worker). Bez ovog
  // fallbacka worker je padao na startu sa „nedostaje DATABASE_ADMIN_URL", iako ima bazu.
  it("radi sa samo DATABASE_URL — posao i red idu u istu bazu", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://app" });
    expect(config.databaseUrl).toBe("postgresql://app");
    expect(config.bossDatabaseUrl).toBe("postgresql://app");
  });

  // pg-boss pri prvom startu pravi šemu `pgboss`; aplikacijska rola to ne smije, pa red ide
  // na vlasničku konekciju kad postoji. Bez ovoga produkcija pada na „permission denied for
  // schema pgboss" — tačno na startu, prije prvog posla.
  it("red ide na vlasničku rolu kad su oba URL-a postavljena", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://app",
      DATABASE_ADMIN_URL: "postgresql://admin",
    });
    expect(config.databaseUrl).toBe("postgresql://app");
    expect(config.bossDatabaseUrl).toBe("postgresql://admin");
  });

  it("DATABASE_URL ima prednost pred DATABASE_ADMIN_URL (manje privilegije)", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://app",
      DATABASE_ADMIN_URL: "postgresql://admin",
    });
    expect(config.databaseUrl).toBe("postgresql://app");
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
      // F2 poslovi. Imena su dio ugovora: `pgboss` red nosi ime posla, a stari redovi u bazi
      // ostaju poslije deploya — preimenovanje bi ih ostavilo da vise zauvijek.
      remindersScan: "reminders.scan",
      attachmentsPurge: "attachments.purge",
      // F3: retencija tijela sukoba.
      syncPurge: "sync.purge",
      // F5: pragovi budžeta; ime je isto kao `notifications.kind` koje posao pravi.
      budgetThresholds: "budget.thresholds",
      rollupNightly: "rollup.nightly",
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
    expect(smtpConfigured({ SMTP_HOST: "smtp.example.com", SMTP_FROM: "g@example.com" })).toBe(true);
  });

  it("push bez Expo tokena nije podešen", () => {
    expect(pushConfigured({})).toBe(false);
    expect(pushConfigured({ EXPO_ACCESS_TOKEN: "  " })).toBe(false);
    expect(pushConfigured({ EXPO_ACCESS_TOKEN: "tok" })).toBe(true);
  });
});

describe("reminders.scan — poslovni sat i množina", () => {
  it("06 h u zoni firme pokreće prolaz; 05 h ne", () => {
    // 2026-11-23T05:00Z = 06:00 u Sarajevu (zima, UTC+1).
    expect(localHour("Europe/Sarajevo", new Date("2026-11-23T05:00:00Z"))).toBe(6);
    expect(localHour("Europe/Sarajevo", new Date("2026-11-23T04:00:00Z"))).toBe(5);
  });

  it("ponoć je 0, ne 24 — ICU vraća „24“ kad se koristi hour12:false", () => {
    expect(localHour("UTC", new Date("2026-11-23T00:00:00Z"))).toBe(0);
  });

  it("poslovni datum je datum zone, ne UTC — 23:30 UTC je već sutra u Sarajevu", () => {
    expect(localDate("Europe/Sarajevo", new Date("2026-11-23T23:30:00Z"))).toBe("2026-11-24");
    expect(localDate("UTC", new Date("2026-11-23T23:30:00Z"))).toBe("2026-11-23");
  });

  it("množina u poruci: 1 dan, 2 dana, 5 dana, 11 dana", () => {
    expect(daysWord(1)).toBe("dan");
    expect(daysWord(2)).toBe("dana");
    expect(daysWord(5)).toBe("dana");
    expect(daysWord(11)).toBe("dana");
    expect(daysWord(21)).toBe("dan");
  });
});

describe("attachments.purge — konfiguracija bucketa", () => {
  it("bez MINIO_* se NE tvrdi da je podešeno", () => {
    const storage = createObjectRemover({});
    expect(storage.configured).toBe(false);
  });

  it("djelimična konfiguracija nije konfiguracija", () => {
    expect(createObjectRemover({ MINIO_ENDPOINT: "http://minio:9000" }).configured).toBe(false);
    expect(
      createObjectRemover({
        MINIO_ENDPOINT: "http://minio:9000",
        MINIO_ACCESS_KEY: "k",
        MINIO_SECRET_KEY: "s",
      }).configured,
    ).toBe(true);
  });

  it("neispravan URL se prijavljuje, ne baca pri prvom brisanju", () => {
    const storage = createObjectRemover({
      MINIO_ENDPOINT: "nije-url",
      MINIO_ACCESS_KEY: "k",
      MINIO_SECRET_KEY: "s",
    });
    expect(storage.configured).toBe(false);
    if (!storage.configured) expect(storage.reason).toMatch(/URL/);
  });
});

describe("budget.thresholds — pragovi 80 % i 100 %", () => {
  const BUDGET = 100_0000n; // 10.000,00

  it("80 % se prelazi na tačno 80 %, 100 % na pun budžet", () => {
    const at80 = evaluateThresholds({
      total: { budgetCents: BUDGET, spentCents: 8000_00n },
      categories: [],
    });
    expect(at80).toHaveLength(1);
    expect(at80[0]).toMatchObject({ scope: "TOTAL", thresholdPct: 80 });

    const at100 = evaluateThresholds({
      total: { budgetCents: BUDGET, spentCents: BUDGET },
      categories: [],
    });
    // 100 % je JEDNO upozorenje, ne dva (80 i 100): prag se ne „preskače“ niz stepenice.
    expect(at100).toHaveLength(1);
    expect(at100[0]).toMatchObject({ thresholdPct: 100, usedPct: 100 });
  });

  it("ispod 80 % nema upozorenja; bez budžeta nema praga", () => {
    expect(
      evaluateThresholds({ total: { budgetCents: BUDGET, spentCents: 7999_99n }, categories: [] }),
    ).toHaveLength(0);
    expect(
      evaluateThresholds({ total: { budgetCents: null, spentCents: 50_000_00n }, categories: [] }),
    ).toHaveLength(0);
    expect(
      evaluateThresholds({
        total: { budgetCents: null, spentCents: 0n },
        categories: [{ code: "GORIVO", name: "Gorivo", budgetCents: null, spentCents: 900_00n }],
      }),
    ).toHaveLength(0);
  });

  it("prag se prati PO KATEGORIJI i UKUPNO — dvije stavke, dva opsega", () => {
    const result = evaluateThresholds({
      total: { budgetCents: BUDGET, spentCents: 8500_00n },
      categories: [
        { code: "GORIVO", name: "Gorivo", budgetCents: 1000_00n, spentCents: 1200_00n },
        { code: "RAD", name: "Rad", budgetCents: 5000_00n, spentCents: 1000_00n },
      ],
    });
    expect(result.map((row) => `${row.scope}:${row.thresholdPct}`)).toEqual(["TOTAL:80", "GORIVO:100"]);
  });

  it("novac u poruci je decimalni tekst, a naslov kaže ŠTA je pređeno", () => {
    expect(centsToText(120_00n)).toBe("120.00");
    expect(centsToText(0n)).toBe("0.00");
    expect(centsToText(-5_50n)).toBe("-5.50");
    const candidate: ThresholdCandidate = {
      scope: "GORIVO",
      scopeLabel: "Gorivo",
      budgetCents: 1000_00n,
      spentCents: 1200_00n,
      revision: 1,
      thresholdPct: 100,
      usedPct: 120,
    };
    expect(alertTitle(candidate, "P-24/2026")).toBe("Budžet prekoračen: P-24/2026 · Gorivo");
    expect(alertBody(candidate)).toContain("Potrošeno 1200.00 od 1000.00");
    expect(alertBody(candidate)).toContain("120.0 %");
  });
});
