import { describe, expect, it } from "vitest";
import {
  findActiveGroupLabel,
  resolveNavGroupOpenMap,
} from "./shell-nav-groups";

describe("shell-nav-groups", () => {
  const groups = [
    { label: "Pregled", items: [{ href: "/pregled" }] },
    {
      label: "Rad / obračun",
      items: [{ href: "/ured/korisnici" }, { href: "/ured/role" }],
    },
  ];

  it("findActiveGroupLabel traži grupu aktivne putanje", () => {
    expect(findActiveGroupLabel(groups, "/ured/korisnici")).toBe("Rad / obračun");
    expect(findActiveGroupLabel(groups, "/ured/korisnici/xyz")).toBe("Rad / obračun");
    expect(findActiveGroupLabel(groups, "/pregled")).toBe("Pregled");
    expect(findActiveGroupLabel(groups, "/nema")).toBeNull();
  });

  it("resolveNavGroupOpenMap uvijek otvara aktivnu grupu", () => {
    const actual = resolveNavGroupOpenMap({
      labels: ["Pregled", "Rad / obračun"],
      activeLabel: "Rad / obračun",
      stored: { Pregled: true, "Rad / obračun": false },
    });
    expect(actual).toEqual({ Pregled: true, "Rad / obračun": true });
  });

  it("resolveNavGroupOpenMap zatvara nepoznate grupe po defaultu", () => {
    const actual = resolveNavGroupOpenMap({
      labels: ["Pregled", "Rad / obračun"],
      activeLabel: "Pregled",
      stored: {},
    });
    expect(actual).toEqual({ Pregled: true, "Rad / obračun": false });
  });
});
