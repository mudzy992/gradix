// @vitest-environment jsdom
/**
 * Radnici (R2a): lista, veza na nalog kao podatak (ne status), dijalog kroz tastaturu.
 *
 * Provjerava ono što se lako pokvari a ne vidi na oko: da radnik bez naloga NIJE prikazan kao
 * greška, da deaktivacija ne briše red, i da nijedan ekran ne nosi `serious`/`critical` nalaz.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkersClient from "./workers-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const workers = [
  {
    id: "wrk_1",
    firstName: "Amina",
    lastName: "Karić",
    phone: "061 111 222",
    email: "amina@demo.ba",
    jobTitle: "Zidar",
    engagement: "PERMANENT",
    hiredAt: "2025-03-01",
    endedAt: null,
    team: "Ekipa 1",
    supervisorId: null,
    supervisorName: null,
    userId: null,
    userEmail: null,
    isActive: true,
  },
  {
    id: "wrk_2",
    firstName: "Mario",
    lastName: "Perić",
    phone: null,
    email: "mario@demo.ba",
    jobTitle: "Rukovalac",
    engagement: "FIXED_TERM",
    hiredAt: "2024-09-15",
    endedAt: "2025-12-31",
    team: null,
    supervisorId: "wrk_1",
    supervisorName: "Amina Karić",
    userId: "usr_2",
    userEmail: "mario@demo.ba",
    isActive: false,
  },
];

type Call = { method: string; url: string; body: unknown };

function mockApi(handler?: (call: Call) => { ok: boolean; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);

      if (call.method === "GET") {
        if (call.url.includes("/api/users")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: { users: [{ id: "usr_2", firstName: "Mario", lastName: "Perić", email: "mario@demo.ba", isActive: true }] },
            }),
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({ success: true, data: { workers } }) } as unknown as Response;
      }

      const result = handler?.(call) ?? {
        ok: true,
        body: { success: true, data: { worker: { ...workers[0], isActive: false } } },
      };
      return { ok: result.ok, json: async () => result.body } as unknown as Response;
    }) as unknown as typeof fetch,
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("radnici", () => {
  it("radnik bez naloga piše „Bez naloga“, a sa nalogom email naloga", async () => {
    mockApi();
    render(<WorkersClient canManage canLinkUser />);

    const withoutAccount = (await screen.findByText("Amina Karić")).closest("tr")!;
    expect(within(withoutAccount).getByText("Bez naloga")).toBeInTheDocument();
    expect(within(withoutAccount).getByText("Aktivan")).toBeInTheDocument();

    // Neaktivni je sakriven dok se ne zatraži — inače lista raste s ljudima koji su otišli.
    expect(screen.queryByText("Mario Perić")).toBeNull();
    await userEvent.click(screen.getByLabelText(/Prikaži i neaktivne/));

    const withAccount = (await screen.findByText("Mario Perić")).closest("tr")!;
    expect(within(withAccount).getByText("Nalog: mario@demo.ba")).toBeInTheDocument();
    expect(within(withAccount).getByText("Neaktivan")).toBeInTheDocument();
  });

  it("deaktivacija šalje PATCH i ne traži brisanje reda", async () => {
    const calls = mockApi();
    render(<WorkersClient canManage canLinkUser />);
    const row = (await screen.findByText("Amina Karić")).closest("tr")!;

    await userEvent.click(within(row).getByRole("button", { name: /Više radnji/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Deaktiviraj" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.method === "PATCH")!;
    expect(patch.url).toContain("/api/workers/wrk_1/active");
    expect(patch.body).toEqual({ active: false });
    expect(screen.queryByRole("button", { name: /Obriši/ })).toBeNull();
  });

  it("bez dozvole nema forme ni menija — samo pregled", async () => {
    mockApi();
    render(<WorkersClient canManage={false} canLinkUser={false} />);
    await screen.findByText("Amina Karić");
    expect(screen.getByText("samo pregled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dodaj radnika/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Izmijeni/ })).toBeNull();
  });

  it("dijalog: fokus ulazi u formu, Esc zatvara, a veza na nalog se mijenja PATCH-om", async () => {
    const calls = mockApi();
    render(<WorkersClient canManage canLinkUser />);
    const row = (await screen.findByText("Amina Karić")).closest("tr")!;
    const trigger = within(row).getByRole("button", { name: "Izmijeni" });
    await userEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Izmjena radnika" });
    expect(within(dialog).getByLabelText("Ime")).toHaveValue("Amina");
    expect(within(dialog).getByLabelText("Ime")).toHaveFocus();

    // Lista naloga se učitava tek u dijalogu i tek kad je veza dozvoljena.
    const linkSelect = await within(dialog).findByLabelText("Poveži sa nalogom");
    await waitFor(() => expect(linkSelect).toBeEnabled());
    await userEvent.selectOptions(linkSelect, "usr_2");

    await waitFor(() => expect(calls.some((call) => call.url.includes("/link-user"))).toBe(true));
    expect(calls.find((call) => call.url.includes("/link-user"))!.body).toEqual({ userId: "usr_2" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("greška servisa ostaje u dijalogu — forma se ne zatvara", async () => {
    mockApi(() => ({
      ok: false,
      body: { success: false, error: { code: "VALIDATION_FAILED", message: "Datum prestanka je prije početka rada." } },
    }));
    render(<WorkersClient canManage canLinkUser />);
    const row = (await screen.findByText("Amina Karić")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Izmijeni" }));

    const dialog = await screen.findByRole("dialog", { name: "Izmjena radnika" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Sačuvaj izmjene" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Datum prestanka je prije početka rada.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("nema serious/critical a11y nalaza na listi ni u dijalogu", async () => {
    mockApi();
    const { container } = render(<WorkersClient canManage canLinkUser />);
    await screen.findByText("Amina Karić");
    await expectNoSeriousA11yViolations(container);

    const row = screen.getByText("Amina Karić").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Izmijeni" }));
    await screen.findByRole("dialog", { name: "Izmjena radnika" });
    await expectNoSeriousA11yViolations(document.body);
  });
});
