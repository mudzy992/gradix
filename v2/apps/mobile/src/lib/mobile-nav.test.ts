import { describe, expect, it } from "vitest";
import { MOBILE_NAV, mobileNavForRoles } from "./mobile-nav";

const ALL_ROLES = ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "WORKER", "DRIVER", "MACHINE_OPERATOR", "MECHANIC", "ACCOUNTANT"];

describe("mobilni meni po roli (A4b)", () => {
  it.each(ALL_ROLES.map((role) => [role] as const))("rola %s: Moj dan/Rokovi/Projekti uvijek, Grupa samo šefu", (role) => {
    const hrefs = mobileNavForRoles([role]).map((entry) => entry.href);
    expect(hrefs).toContain("/moj-dan");
    expect(hrefs).toContain("/rokovi");
    expect(hrefs).toContain("/projekti");
    expect(hrefs.includes("/grupa")).toBe(role === "SITE_SUPERVISOR");
  });

  it("svaka stavka ima oznaku i svaka href ruta postoji u definiciji jednom", () => {
    expect(new Set(MOBILE_NAV.map((entry) => entry.href)).size).toBe(MOBILE_NAV.length);
    for (const entry of MOBILE_NAV) expect(entry.label.length).toBeGreaterThan(3);
  });
});
