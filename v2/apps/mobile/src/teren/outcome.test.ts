import { describe, expect, it } from "vitest";
import { outcomeFor, syncBannerText } from "./outcome";

describe("ishod slanja za UI", () => {
  it("van opsega se nikad ne prikazuje kao odbijeno i ostaje na telefonu", () => {
    const outcome = outcomeFor("rejected", "FOREMAN_SCOPE_FORBIDDEN");
    expect(outcome.label).toContain("Van opsega");
    expect(outcome.label).toContain("ostaje na telefonu");
    expect(outcome.label.toLowerCase()).not.toContain("odbijen");
  });

  it("mapa stanja iz outboxa", () => {
    expect(outcomeFor("sent", null).label).toBe("Poslano");
    expect(outcomeFor("pending", null).label).toBe("Čeka slanje");
    expect(outcomeFor("failed", "NETWORK_ERROR").label).toBe("Čeka slanje");
    expect(outcomeFor("conflict", null).label).toBe("Za provjeru");
  });

  it("banner za offline i poslano", () => {
    expect(syncBannerText({ pending: 0, offline: true })).toBe("Sve je poslano.");
    expect(syncBannerText({ pending: 3, offline: true })).toContain("Bez veze");
  });
});
