// @vitest-environment jsdom
/**
 * Postavke firme: ekran mora imati JEDAN `h1` (naslov stranice) i proći axe.
 *
 * Nalaz iz CI-ja: ekran je počinjao tabovima, bez naslova. `@smoke` E2E traži da naslov
 * rute bude vidljiv, pa je šest testova palo na istoj stvari; čitač ekrana je imao isti
 * problem. Ovaj test hvata oboje — i strukturu naslova i ozbiljne a11y prekršaje.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PostavkeClient from "./postavke-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const company = {
  id: "cmp_demo",
  name: "Demo firma",
  slug: "demo-firma",
  legalName: "Demo firma d.o.o.",
  taxId: "123456789",
  iban: "BA391234567890123456",
  address: "Ulica 1",
  city: "Sarajevo",
  postalCode: "71000",
  phone: "+38733123456",
  email: "firma@demo.test",
  workWeek: [1, 2, 3, 4, 5],
  workDayStart: "07:00",
  workDayEnd: "15:00",
  reminderDays: 3,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { company, holidays: [] } }),
    })) as unknown as typeof fetch,
  );
}

describe("Postavke firme", () => {
  it("ima tačno jedan h1 sa nazivom ekrana", async () => {
    mockApi();
    render(<PostavkeClient canManage />);
    const headings = await screen.findAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Postavke firme");
  });

  it("nema ozbiljnih a11y prekršaja", async () => {
    mockApi();
    const { container } = render(<PostavkeClient canManage />);
    await screen.findAllByRole("heading", { level: 1 });
    await expectNoSeriousA11yViolations(container);
  });
});
