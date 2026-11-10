import { describe, expect, it } from "vitest";
import { outcomeFor, syncBannerText, sendResultMessage, OUT_OF_SCOPE_NOTE } from "./outcome";

describe("ishod slanja za UI", () => {
  it("van opsega se nikad ne prikazuje kao odbijeno i ostaje na telefonu", () => {
    const outcome = outcomeFor("rejected", "FOREMAN_SCOPE_FORBIDDEN");
    expect(outcome.label).toBe("Van opsega");
    expect(OUT_OF_SCOPE_NOTE).toContain("ostaje na telefonu");
    expect(outcome.label.toLowerCase()).not.toContain("odbijen");
  });

  it("mapa stanja iz outboxa", () => {
    expect(outcomeFor("sent", null).label).toBe("Poslano");
    expect(outcomeFor("pending", null).label).toBe("Čeka slanje");
    expect(outcomeFor("failed", "NETWORK_ERROR").label).toBe("Čeka slanje");
    expect(outcomeFor("conflict", null).label).toBe("Za provjeru");
  });

  it("banner: 'bez veze' tek kad je slanje stvarno palo, ne dok samo čeka", () => {
    expect(syncBannerText({ pending: 0, syncFailed: true })).toBe("Sve je poslano.");
    expect(syncBannerText({ pending: 3, syncFailed: false })).toBe("3 čeka slanje.");
    expect(syncBannerText({ pending: 3, syncFailed: true })).toContain("Bez veze");
  });

  it("poruka slanja: pull greška nije 'nema veze' kad je push prošao", () => {
    const pullFail = sendResultMessage({ applied: 5, duplicate: 0, conflict: 0, rejected: 0, retry: 0, error: "SYNC_NETWORK_OR_STORAGE_ERROR" });
    expect(pullFail).toContain("poslano 5");
    expect(pullFail).not.toContain("Nema veze sa serverom");
    const offline = sendResultMessage({ applied: 0, duplicate: 0, conflict: 0, rejected: 0, retry: 5, error: "SYNC_NETWORK_OR_STORAGE_ERROR" });
    expect(offline).toContain("Nema veze sa serverom");
    const conflict = sendResultMessage({ applied: 0, duplicate: 0, conflict: 5, rejected: 0, retry: 0, error: null });
    expect(conflict).toContain("za provjeru 5");
  });
});
