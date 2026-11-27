// @vitest-environment jsdom
/**
 * QR za 2FA uparivanje (Korak 0) — test bez pravog QR enkodera i bez mreže.
 *
 * Provjerava tri stvari koje se lako tiho pokvare:
 *   1. slika ima `alt` koji KAŽE šta je i šta da se uradi (axe: `role="img"` bez imena je prekršaj),
 *   2. QR se pravi iz `otpauth://` URI-ja LOKALNO — nijedan poziv ka vanjskom servisu,
 *   3. kad enkoder padne, ekran ne ostaje bez puta dalje: kaže da se ključ upiše ručno.
 *
 * Komponenta se uvozi DINAMIČKI: `vi.doMock("qrcode")` mora stići prije uvoza modula koji ga
 * traži, a statički uvoz bi `qrcode` keširao prije mock-a.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const URI = "otpauth://totp/Gradix%3Aamir%40firma.test?secret=JBSWY3DPEHPK3PXP&issuer=Gradix";

/** Uvezi komponentu svježe (poslije mock-a) i nacrtaj je. */
async function renderQr() {
  const { TotpQrCode } = await import("./totp-qr-code");
  return render(<TotpQrCode uri={URI} label="Gradix 2FA" />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("QR kod za 2FA", () => {
  it("prikazuje sliku sa opisom koji imenuje svrhu i ručni put", async () => {
    vi.doMock("qrcode", () => ({ toDataURL: vi.fn(async () => "data:image/png;base64,AAA") }));
    await renderQr();

    const image = await screen.findByRole("img");
    expect(image).toHaveAttribute("src", "data:image/png;base64,AAA");
    expect(image.getAttribute("alt")).toContain("QR kod");
    expect(image.getAttribute("alt")).toContain("Gradix 2FA");
    // Alt mora reći i drugi put: ko ne vidi QR, mora znati da ključ može ručno.
    expect(image.getAttribute("alt")).toMatch(/ručno/i);
  });

  it("QR se pravi iz otpauth URI-ja, bez ijednog poziva ka mreži", async () => {
    const toDataURL = vi.fn(async () => "data:image/png;base64,AAA");
    vi.doMock("qrcode", () => ({ toDataURL }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await renderQr();

    await screen.findByRole("img");
    expect(toDataURL).toHaveBeenCalledWith(URI, expect.objectContaining({ errorCorrectionLevel: "M" }));
    // Tajna ne smije napustiti stranicu: nijedan `fetch` (nema slanja na server ni na servis).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("kad enkoder padne, kaže da se ključ upiše ručno (bez tihe prazne kutije)", async () => {
    vi.doMock("qrcode", () => ({ toDataURL: vi.fn(async () => Promise.reject(new Error("nema canvas"))) }));
    await renderQr();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/ručno/i));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("okvir i placeholder nose SVOJU bijelu podlogu (radi u tamnoj temi)", async () => {
    /*
     * Skener traži tamne module na svijetloj podlozi. Test čita `shell.css`, ne klasu iz
     * `jsdom`-a: tema se u testu ne primjenjuje, pa bi provjera stilova uvijek prošla.
     */
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src/app/shell.css"), "utf8");
    const qrBlock = /\.gx-qr\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(qrBlock).toMatch(/background:\s*var\(--qr-surface\)/);
    // Unutrašnja „quiet zone“ iste boje — moduli ne smiju dodirivati tamnu plohu.
    expect(qrBlock).toMatch(/box-shadow:\s*inset[^;]*var\(--qr-surface\)/);
    const placeholder = /\.gx-qr__placeholder\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(placeholder).toMatch(/background:\s*var\(--qr-surface\)/);

    // Token postoji u OBJE teme i u tamnoj NIJE izveden iz pozadine (`--panel`/`--raise`).
    const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const light = globals.slice(0, globals.indexOf('[data-theme="dark"]'));
    const dark = globals.slice(globals.indexOf('[data-theme="dark"]'));
    expect(light).toMatch(/--qr-surface:\s*var\(--palette-surface\)/);
    expect(dark).toMatch(/--qr-surface:\s*var\(--palette-surface\)/);
  });

  it("nema ozbiljnih a11y prekršaja", async () => {
    vi.doMock("qrcode", () => ({ toDataURL: vi.fn(async () => "data:image/png;base64,AAA") }));
    const { container } = await renderQr();
    await screen.findByRole("img");
    await expectNoSeriousA11yViolations(container);
  });
});
