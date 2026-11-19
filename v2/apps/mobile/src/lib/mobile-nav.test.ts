import { describe, expect, it } from "vitest";
import { MOBILE_NAV, mobileNavForProfile, type MobileNavProfile } from "./mobile-nav";

const profile = (over: Partial<MobileNavProfile>): MobileNavProfile => ({
  roles: ["WORKER"],
  workerId: null,
  foremanScope: false,
  ...over,
});
const hrefs = (p: MobileNavProfile) => mobileNavForProfile(p).map((entry) => entry.href);

describe("mobilni meni (A2): veza korisnik-radnik, ne samo rola", () => {
  it("Moj dan samo uz povezanog radnika, bez obzira na rolu", () => {
    expect(hrefs(profile({ roles: ["OWNER"], workerId: null }))).not.toContain("/moj-dan");
    expect(hrefs(profile({ roles: ["ACCOUNTANT"], workerId: "w1" }))).toContain("/moj-dan");
  });

  it("Grupa: šef + veza + aktivna dodjela; svaki uslov zasebno ruši vidljivost", () => {
    const sef = profile({ roles: ["SITE_SUPERVISOR"], workerId: "w1", foremanScope: true });
    expect(hrefs(sef)).toContain("/grupa");
    expect(hrefs({ ...sef, foremanScope: false })).not.toContain("/grupa");
    expect(hrefs({ ...sef, workerId: null })).not.toContain("/grupa");
    expect(hrefs({ ...sef, roles: ["WORKER"] })).not.toContain("/grupa");
  });

  it("Sati mašine: rukovalac uz povezanog radnika", () => {
    expect(hrefs(profile({ roles: ["MACHINE_OPERATOR"], workerId: "w1" }))).toContain("/sati-masine");
    expect(hrefs(profile({ roles: ["MACHINE_OPERATOR"], workerId: null }))).not.toContain("/sati-masine");
    expect(hrefs(profile({ roles: ["WORKER"], workerId: "w1" }))).not.toContain("/sati-masine");
  });

  it("Gorivo: vozač ili rukovalac uz povezanog radnika", () => {
    expect(hrefs(profile({ roles: ["DRIVER"], workerId: "w1" }))).toContain("/gorivo");
    expect(hrefs(profile({ roles: ["MACHINE_OPERATOR"], workerId: "w1" }))).toContain("/gorivo");
    expect(hrefs(profile({ roles: ["WORKER"], workerId: "w1" }))).not.toContain("/gorivo");
  });

  it("Ture: samo vozač uz povezanog radnika", () => {
    expect(hrefs(profile({ roles: ["DRIVER"], workerId: "w1" }))).toContain("/ture");
    expect(hrefs(profile({ roles: ["DRIVER"], workerId: null }))).not.toContain("/ture");
    expect(hrefs(profile({ roles: ["MACHINE_OPERATOR"], workerId: "w1" }))).not.toContain("/ture");
  });

  it("Dnevni pregled: rukovalac ili mehaničar uz povezanog radnika", () => {
    expect(hrefs(profile({ roles: ["MACHINE_OPERATOR"], workerId: "w1" }))).toContain("/dnevni-pregled");
    expect(hrefs(profile({ roles: ["MECHANIC"], workerId: "w1" }))).toContain("/dnevni-pregled");
    expect(hrefs(profile({ roles: ["MACHINE_OPERATOR"], workerId: null }))).not.toContain("/dnevni-pregled");
    expect(hrefs(profile({ roles: ["DRIVER"], workerId: "w1" }))).not.toContain("/dnevni-pregled");
  });

  it("Kvarovi: rukovalac ili mehaničar uz povezanog radnika", () => {
    expect(hrefs(profile({ roles: ["MACHINE_OPERATOR"], workerId: "w1" }))).toContain("/kvarovi");
    expect(hrefs(profile({ roles: ["MECHANIC"], workerId: "w1" }))).toContain("/kvarovi");
    expect(hrefs(profile({ roles: ["MACHINE_OPERATOR"], workerId: null }))).not.toContain("/kvarovi");
    expect(hrefs(profile({ roles: ["DRIVER"], workerId: "w1" }))).not.toContain("/kvarovi");
  });

  it("Rokovi i Projekti su uvijek tu za prijavljen nalog", () => {
    for (const p of [profile({}), profile({ roles: ["OWNER"] })]) {
      expect(hrefs(p)).toEqual(expect.arrayContaining(["/rokovi", "/projekti"]));
    }
    expect(new Set(MOBILE_NAV.map((entry) => entry.href)).size).toBe(MOBILE_NAV.length);
  });
});
