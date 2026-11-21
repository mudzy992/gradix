// @vitest-environment jsdom
/**
 * Mašine (R2a): kategorija nosi vrstu brojila, upis brojila traži izričitu ispravku kad je
 * vrijednost manja, i nijedan ekran ne nosi `serious`/`critical` a11y nalaz.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import EquipmentClient from "./equipment-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const categories = [
  { id: "cat_bager", code: "EXCAVATOR", name: "Bager", meter: "HOURS", isActive: true, sortOrder: 1, machineCount: 1 },
  { id: "cat_kamion", code: "TRUCK", name: "Kamion", meter: "KM", isActive: true, sortOrder: 2, machineCount: 0 },
];

const machines = [
  {
    id: "mch_1",
    code: "BAG-01",
    name: "Bager CAT 320",
    categoryId: "cat_bager",
    categoryName: "Bager",
    categoryCode: "EXCAVATOR",
    make: "CAT",
    model: "320",
    serialNo: null,
    plate: null,
    year: 2021,
    ownership: "OWN",
    meter: "HOURS",
    meterValue: 1234.5,
    meterUpdatedAt: "2026-11-01T09:30:00.000Z",
    isActive: true,
  },
];

type Call = { method: string; url: string; body: Record<string, unknown> | null };

function mockApi(handler?: (call: Call) => { status?: number; ok: boolean; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        url: String(url),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      calls.push(call);

      if (call.method === "GET") {
        const data = call.url.includes("equipment-categories") ? { categories } : { machines };
        return { ok: true, json: async () => ({ success: true, data }) } as unknown as Response;
      }
      const result = handler?.(call) ?? {
        ok: true,
        body: { success: true, data: { machine: machines[0] } },
      };
      return {
        status: result.status ?? (result.ok ? 200 : 400),
        ok: result.ok,
        json: async () => result.body,
      } as unknown as Response;
    }) as unknown as typeof fetch,
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mašine", () => {
  it("u redu se vide oznaka, kategorija i trenutno brojilo sa jedinicom iz kategorije", async () => {
    mockApi();
    render(<EquipmentClient canManage />);
    const row = (await screen.findByText("Bager CAT 320")).closest("tr")!;
    expect(within(row).getByText("Bager")).toBeInTheDocument();
    // 1234.5 sata, sa zarezom i tačkom za hiljade — kao na tabli mašine.
    expect(within(row).getByText("1.234,5 sati")).toBeInTheDocument(); }, 15000);

  it("upis brojila šalje PATCH bez ispravke kad je vrijednost veća", async () => {
    const calls = mockApi();
    render(<EquipmentClient canManage />);
    await screen.findByText("Bager CAT 320");
    await userEvent.click(screen.getByRole("button", { name: "Upisi brojilo" }));

    const dialog = await screen.findByRole("dialog", { name: /Brojilo/ });
    await userEvent.type(within(dialog).getByLabelText("Novo stanje"), "1250,5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upiši brojilo" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.method === "PATCH")!;
    expect(patch.url).toContain("/api/equipment/mch_1/meter");
    // Zarez se pretvara u tačku, a `correct` se NE šalje sam od sebe.
    expect(patch.body).toEqual({ value: 1250.5 });
  });

  it("manja vrijednost: servis odbija, ekran nudi ispravku kao drugu potvrdu", async () => {
    const calls = mockApi((call) =>
      call.body?.correct === true
        ? { ok: true, body: { success: true, data: { machine: machines[0] } } }
        : {
            ok: false,
            status: 409,
            body: {
              success: false,
              error: {
                code: "CONFLICT",
                message: "Nova vrijednost (1200) je manja od upisane (1234.5). Ako je upisana pogrešna, potvrdite ispravku.",
              },
            },
          },
    );
    render(<EquipmentClient canManage />);
    await screen.findByText("Bager CAT 320");
    await userEvent.click(screen.getByRole("button", { name: "Upisi brojilo" }));

    const dialog = await screen.findByRole("dialog", { name: /Brojilo/ });
    await userEvent.type(within(dialog).getByLabelText("Novo stanje"), "1200");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upiši brojilo" }));

    // Poruka servisa se prikazuje kakva jeste — i stara i nova vrijednost u njoj.
    const warning = await within(dialog).findByRole("alert");
    expect(warning).toHaveTextContent("manja od upisane");
    // Ništa nije upisano bez druge potvrde.
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole("button", { name: "Potvrdi ispravku" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    expect(calls.filter((call) => call.method === "PATCH")[1]!.body).toEqual({ value: 1200, correct: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("forma šalje brojilo iz kategorije, a ne izbora korisnika", async () => {
    const calls = mockApi();
    render(<EquipmentClient canManage />);
    await screen.findByText("Bager CAT 320");
    await userEvent.click(screen.getByRole("button", { name: /Dodaj mašinu/ }));

    const dialog = await screen.findByRole("dialog", { name: "Nova mašina" });
    await userEvent.type(within(dialog).getByLabelText("Inventarska oznaka"), "kam-02");
    await userEvent.type(within(dialog).getByLabelText("Naziv"), "Kamion MAN");
    await userEvent.selectOptions(within(dialog).getByLabelText("Kategorija"), "cat_kamion");
    expect(within(dialog).getByText("Brojilo: km")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Početno stanje brojila"), "55000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Dodaj mašinu" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toContain("/api/equipment");
    expect(post.body).toMatchObject({
      code: "KAM-02",
      name: "Kamion MAN",
      categoryId: "cat_kamion",
      meter: "KM",
      meterValue: 55000,
      ownership: "OWN",
    });
  });

  it("kategorije: dodavanje nove šalje oznaku velikim slovima", async () => {
    const calls = mockApi(() => ({
      ok: true,
      body: { success: true, data: { category: categories[1] } },
    }));
    render(<EquipmentClient canManage />);
    await screen.findByText("Bager CAT 320");
    await userEvent.click(screen.getByRole("button", { name: "Kategorije" }));

    const dialog = await screen.findByRole("dialog", { name: "Kategorije mašina" });
    // Postojeće kategorije su u tabeli sa brojem mašina — vidi se gdje se koriste.
    expect(within(dialog).getByText("EXCAVATOR")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Naziv"), "Tegljač");
    await userEvent.type(within(dialog).getByLabelText("Oznaka"), "teg");
    await userEvent.selectOptions(within(dialog).getByLabelText("Brojilo"), "KM");
    await userEvent.click(within(dialog).getByRole("button", { name: "Dodaj kategoriju" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")!.body).toEqual({
      code: "TEG",
      name: "Tegljač",
      meter: "KM",
    });
  });

  it("bez dozvole nema forme, ali brojilo se i dalje može upisati", async () => {
    mockApi();
    render(<EquipmentClient canManage={false} />);
    await screen.findByText("Bager CAT 320");
    expect(screen.queryByRole("button", { name: /Dodaj mašinu/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Više radnji/ })).toBeNull();
    // Rukovalac upisuje brojilo — to je njegov posao, ne izmjena inventara.
    expect(screen.getByRole("button", { name: "Upisi brojilo" })).toBeInTheDocument();
  });

  it("nema serious/critical a11y nalaza na listi ni u dijalogu brojila", async () => {
    mockApi();
    const { container } = render(<EquipmentClient canManage />);
    await screen.findByText("Bager CAT 320");
    await expectNoSeriousA11yViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "Upisi brojilo" }));
    await screen.findByRole("dialog", { name: /Brojilo/ });
    await expectNoSeriousA11yViolations(document.body);
  });
});
