import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { businessDate, formatPgDate, isCalendarDate, safeTimezone } from "./dates";

describe("poslovni datum", () => {
  it("dan se računa u zoni firme, ne po UTC", () => {
    // 23:30 UTC je već sljedeći dan u Sarajevu (zima, +1).
    expect(businessDate(new Date("2026-11-07T23:30:00Z"), "Europe/Sarajevo")).toBe("2026-11-08");
    // 22:30 UTC je u Sarajevu 23:30 istog dana.
    expect(businessDate(new Date("2026-11-07T22:30:00Z"), "Europe/Sarajevo")).toBe("2026-11-07");
  });

  it("nepoznata zona pada na zadanu, ne ruši ekran", () => {
    expect(safeTimezone("Mars/Olympus")).toBe("Europe/Sarajevo");
    expect(safeTimezone(null)).toBe("Europe/Sarajevo");
    expect(safeTimezone("UTC")).toBe("UTC");
  });

  it("DATE iz node-pg zadržava kalendarski dan u UTC, UTC+1 i UTC-5", () => {
    const child = fileURLToPath(new URL("./pg-date-tz-child.ts", import.meta.url));
    const zones = ["UTC", "Europe/Sarajevo", "America/New_York"] as const;
    for (const zone of zones) {
      const result = spawnSync(process.execPath, ["--experimental-strip-types", child], {
        env: { ...process.env, TZ: zone },
        encoding: "utf8",
      });
      expect(result.stderr, zone).toBe("");
      expect(result.status, `${zone} ${result.stdout}`).toBe(0);
    }
    expect(formatPgDate("2024-02-29T00:00:00.000Z")).toBe("2024-02-29");
  });

  it("nepostojeći kalendarski datum se odbija, ne normalizuje", () => {
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("07.11.2026")).toBe(false);
  });
});
