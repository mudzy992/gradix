// @vitest-environment jsdom
/**
 * Matrica rola: sva stanja + a11y. Test ne pita bazu — `fetch` je zamijenjen, a oblik
 * odgovora je isti kao iz `/api/roles` (dolazi iz `roleMatrix`).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import RolesClient from "./roles-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const matrix = {
  editable: false,
  permissions: [
    { key: "users.manage", label: "Upravljanje korisnicima", description: "Pozivnice, reset, role." },
    { key: "audit.view", label: "Pregled audit traga", description: "Ko je šta mijenjao." },
  ],
  roles: [
    { role: "OWNER", label: "Vlasnik", description: "Puna kontrola nad firmom.", permissions: ["users.manage", "audit.view"], assignableBy: ["OWNER"] },
    { role: "WORKER", label: "Radnik", description: "Terenski rad i svoji zapisi.", permissions: [], assignableBy: ["OWNER", "ADMIN"] },
  ],
};

function mockFetch(response: { ok: boolean; body: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: response.ok, json: async () => response.body })) as unknown as typeof fetch);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("matrica rola", () => {
  it("prikazuje role i dozvole iz odgovora, sa objašnjenjem da je pregled", async () => {
    mockFetch({ ok: true, body: { success: true, data: matrix } });
    render(<RolesClient />);
    // Ista rola postoji u tabeli (≥ 640) i u karticama (< 640) — oba prikaza su u DOM-u,
    // pa se traži „bar jedan“, ne „tačno jedan“.
    expect((await screen.findAllByText("Vlasnik")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Radnik").length).toBeGreaterThan(0);
    expect(screen.getByText(/Ovo je pregled/)).toBeInTheDocument();
    // Matrica se ne može uređivati: nema dugmeta za izmjenu.
    expect(screen.queryByRole("button", { name: /Izmijeni|Uredi|Sačuvaj/ })).toBeNull();
    // Tehnički ključ (`OWNER`) je za podršku — mono, uz naziv; nikad kao jedina etiketa.
    const keys = screen.getAllByText("OWNER");
    expect(keys.every((key) => key.className.includes("gx-mono"))).toBe(true);
  });

  it("greška: poruka i „Pokušaj ponovo“ koji ponovo zove server", async () => {
    mockFetch({ ok: false, body: { success: false, error: { code: "INTERNAL", message: "Puklo." } } });
    render(<RolesClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Puklo.");
    const retry = screen.getByRole("button", { name: "Pokušaj ponovo" });
    await userEvent.click(retry);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("učitavanje: skeleton sa aria-busy", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
    const { container } = render(<RolesClient />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("nema serious/critical a11y nalaza", async () => {
    mockFetch({ ok: true, body: { success: true, data: matrix } });
    const { container } = render(<RolesClient />);
    await screen.findAllByText("Vlasnik");
    await expectNoSeriousA11yViolations(container);
  });
});
