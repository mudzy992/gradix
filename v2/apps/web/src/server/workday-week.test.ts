import { describe, expect, it } from "vitest";
import { can } from "./permissions";
import { weekStartFromWorkDate } from "./workday-week";

describe("R4b week_start (ISO ponedjeljak)", () => {
  it("ponedjeljak ostaje; nedjelja i srijeda mapiraju na isti pon", () => {
    expect(weekStartFromWorkDate("2026-11-16")).toBe("2026-11-16"); // Mon
    expect(weekStartFromWorkDate("2026-11-18")).toBe("2026-11-16"); // Wed
    expect(weekStartFromWorkDate("2026-11-22")).toBe("2026-11-16"); // Sun
  });
});

describe("R4b dozvole (pravilo 8 — dosegljivost po roli)", () => {
  it("confirm samo šef; week_decide/lock OWNER+ADMIN+PM; revise OWNER+ADMIN", () => {
    expect(can(["SITE_SUPERVISOR"], "workdays.confirm")).toBe(true);
    expect(can(["OWNER"], "workdays.confirm")).toBe(false);
    expect(can(["PROJECT_MANAGER"], "workdays.confirm")).toBe(false);
    for (const role of ["OWNER", "ADMIN", "PROJECT_MANAGER"] as const) {
      expect(can([role], "workdays.week_decide"), role).toBe(true);
      expect(can([role], "workdays.lock"), role).toBe(true);
    }
    expect(can(["SITE_SUPERVISOR"], "workdays.week_decide")).toBe(false);
    expect(can(["ACCOUNTANT"], "workdays.lock")).toBe(false);
    expect(can(["OWNER"], "workdays.revise")).toBe(true);
    expect(can(["ADMIN"], "workdays.revise")).toBe(true);
    expect(can(["PROJECT_MANAGER"], "workdays.revise")).toBe(false);
    expect(can(["ACCOUNTANT"], "workdays.view")).toBe(true);
    expect(can(["ACCOUNTANT"], "workdays.confirm")).toBe(false);
    expect(can(["WORKER"], "workdays.week_decide")).toBe(false);
  });
});
