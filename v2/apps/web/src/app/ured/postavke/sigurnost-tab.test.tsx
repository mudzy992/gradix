// @vitest-environment jsdom
/**
 * Tab Sigurnost: 2FA uparivanje (Korak 0).
 *
 * Provjerava da QR i ručni ključ stoje ZAJEDNO, prije potvrde koda — jer je to jedini trenutak
 * u kojem `otpauth://` URI postoji. Poslije potvrde tajna se više ne vraća, pa bi „QR se pojavi
 * kasnije" ili „QR je negdje drugdje" ostavio korisnika bez puta do autentikatora.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { SigurnostTab } from "./sigurnost-tab";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const URI = `otpauth://totp/Gradix%3Aamir%40firma.test?secret=${SECRET}&issuer=Gradix`;

/** Status: 2FA nije uključena; enroll vraća tajnu i URI. */
function mockApi(status: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      headers: new Headers(),
      json: async () => {
        if (String(url).includes("/2fa/status")) {
          return { success: true, data: { enabled: false, pendingEnrollment: false, recoveryCodesLeft: 0, required: true, ...status } };
        }
        if (String(url).includes("/2fa/enroll")) {
          return { success: true, data: { uri: URI, secret: SECRET } };
        }
        return { success: true, data: {} };
      },
    })) as unknown as typeof fetch,
  );
}

/*
 * `qrcode` se mockuje IZNAD uvoza (`vi.mock` se hoistuje): u jsdom-u nema canvasa, pa bi pravi
 * enkoder pao u „QR nije mogao da se prikaže“ i test bi provjeravao pogrešnu granu.
 */
// Putanja je relativna iz TOG fajla: ekran uvozi `@/components/totp-qr-code`, koji pak traži
// `qrcode` — mock mora pogoditi tačno taj specifikator.
vi.mock("../../../components/totp-qr-code", () => ({
  TotpQrCode: ({ uri }: { uri: string }) => <span role="img" aria-label="QR kod za uparivanje autentikatora" data-uri={uri} />,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sigurnost — 2FA uparivanje", () => {
  it("poslije „Uključi 2FA“ prikaže QR i ključ za ručni unos, oba prije potvrde", async () => {
    mockApi({});
    render(<SigurnostTab />);

    await userEvent.click(await screen.findByRole("button", { name: "Uključi 2FA" }));

    const qr = await screen.findByRole("img");
    expect(qr).toHaveAccessibleName(/QR kod/i);
    // QR dobija upravo `otpauth://` URI iz enroll odgovora — ne neku drugu tajnu.
    expect(qr).toHaveAttribute("data-uri", URI);
    expect(screen.getByText(SECRET)).toBeVisible();
    expect(screen.getByRole("button", { name: "Kopiraj ključ" })).toBeVisible();
    // Polje za kod i dugme za potvrdu postoje tek uz QR — QR nije ukras poslije uparivanja.
    expect(screen.getByRole("button", { name: "Potvrdi i uključi" })).toBeDisabled();
  });

  it("kopiranje ključa potvrdi radnju (status, ne samo promjena teksta dugmeta)", async () => {
    mockApi({});
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
    render(<SigurnostTab />);

    await userEvent.click(await screen.findByRole("button", { name: "Uključi 2FA" }));
    await userEvent.click(await screen.findByRole("button", { name: "Kopiraj ključ" }));

    expect(writeText).toHaveBeenCalledWith(SECRET);
    // Dva `role="status"` (QR i kopiranje) — traži se onaj koji nosi potvrdu kopiranja.
    expect(screen.getAllByRole("status").some((node) => /međuspremniku/i.test(node.textContent ?? ""))).toBe(true);
  });

  it("kad je 2FA već uključena, nema QR-a ni enroll dugmeta", async () => {
    mockApi({ enabled: true, recoveryCodesLeft: 8 });
    render(<SigurnostTab />);

    expect(await screen.findByText(/2FA je uključena/i)).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Uključi 2FA" })).toBeNull();
  });

  it("nema ozbiljnih a11y prekršaja u toku uparivanja", async () => {
    mockApi({});
    const { container } = render(<SigurnostTab />);
    await userEvent.click(await screen.findByRole("button", { name: "Uključi 2FA" }));
    await screen.findByRole("img");
    await expectNoSeriousA11yViolations(container);
  });
});
