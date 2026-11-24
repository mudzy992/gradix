// @vitest-environment jsdom
/**
 * F2 — kartica „Nedostaje“.
 *
 * Provjerava ono što bi se tiho pokvarilo:
 *  1. dok nema datuma provjere, dugme je ZAKLJUČANO — nove obaveze nemaju rok, pa je datum
 *     provjere jedini rok koji dobijaju;
 *  2. uspjeh i djelimičan uspjeh se razlikuju u poruci (preskočeni redovi se prijavljuju);
 *  3. panel je pristupačan (a11y) i kad nema nedostataka.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import MissingPanel from "./missing-panel";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const missing = {
  items: [
    {
      entityKind: "WORKER",
      entityId: "wrk_1",
      typeId: "obt_medical",
      requirementId: "obr_1",
      state: "missing",
      typeLabel: "Ljekarski pregled",
      typeCode: "MEDICAL",
      entityName: "Amina Karić",
      entityCode: null,
      requiresAttachment: true,
    },
  ],
  groups: [{ typeId: "obt_medical", entityKind: "WORKER", count: 1, ids: ["wrk_1"] }],
  counts: { total: 1, workers: 1, machines: 0, projects: 0 },
  today: "2026-11-23",
};

function mockApi(options: { missing?: typeof missing; created?: { created: number; skipped: unknown[] } } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = {
        method: init?.method ?? "GET",
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      if (call.method === "POST") {
        return {
          ok: true,
          json: async () => ({ success: true, data: options.created ?? { created: 1, skipped: [] } }),
        } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ success: true, data: options.missing ?? missing }),
      } as unknown as Response;
    }) as unknown as typeof fetch,
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kartica Nedostaje", () => {
  it("bez datuma provjere ne može se kreirati — dugme je zaključano", async () => {
    mockApi();
    render(<MissingPanel canManage onCreated={() => undefined} />);

    const dugme = await screen.findByRole("button", { name: /Kreiraj sve nedostajuće/ });
    expect(dugme).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Provjeri do"), "2027-06-01");
    expect(dugme).toBeEnabled();
  });

  it("kreiranje šalje datum provjere i prijavljuje koliko je urađeno", async () => {
    const calls = mockApi();
    const onCreated = vi.fn();
    render(<MissingPanel canManage onCreated={onCreated} />);

    await userEvent.type(await screen.findByLabelText("Provjeri do"), "2027-06-01");
    await userEvent.click(screen.getByRole("button", { name: /Kreiraj sve nedostajuće/ }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toContain("/api/obligations/missing/create");
    expect(post.body).toEqual({ reviewAt: "2027-06-01" });
    expect(await screen.findByText(/Kreirano 1/)).toBeInTheDocument();
  });

  it("preskočeni redovi se prijavljuju kao greška, a ne kao uspjeh", async () => {
    mockApi({ created: { created: 1, skipped: [{ entityKind: "WORKER" }] } });
    render(<MissingPanel canManage onCreated={() => undefined} />);

    await userEvent.type(await screen.findByLabelText("Provjeri do"), "2027-06-01");
    await userEvent.click(screen.getByRole("button", { name: /Kreiraj sve nedostajuće/ }));

    expect(await screen.findByText(/preskočeno 1/)).toBeInTheDocument();
  });

  it("kad nema nedostataka, panel to kaže i ne traži ništa", async () => {
    mockApi({ missing: { ...missing, items: [], groups: [], counts: { total: 0, workers: 0, machines: 0, projects: 0 } } });
    render(<MissingPanel canManage onCreated={() => undefined} />);

    expect(await screen.findByText("Sve obaveze su unesene")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kreiraj sve nedostajuće/ })).not.toBeInTheDocument();
  });

  it("bez dozvole upravljanja nema dugmeta, ali objašnjenje ostaje", async () => {
    mockApi();
    render(<MissingPanel canManage={false} onCreated={() => undefined} />);

    expect(await screen.findByText(/Nedostajuće obaveze kreira ured/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kreiraj sve nedostajuće/ })).not.toBeInTheDocument();
  });

  it("nema ozbiljnih a11y prekršaja", async () => {
    mockApi();
    const { container } = render(<MissingPanel canManage onCreated={() => undefined} />);
    await screen.findByLabelText("Provjeri do");
    await expectNoSeriousA11yViolations(container);
  });
});
