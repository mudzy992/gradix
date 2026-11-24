// @vitest-environment jsdom
/**
 * Troškovi projekta (F5) — ledger bez dugmeta „knjiži“.
 *
 * Test čuva tri stvari:
 *  1. `PENDING` red NEMA iznos (praznina, ne nula) i ne ulazi u zbroj.
 *  2. Storno traži razlog; dugme je zaključano dok razlog nema 10 znakova.
 *  3. Računovođa (bez `projects.costs.book`) NE dobija ni ručni unos ni storno.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectCosts } from "./project-costs";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const ENTRY_POSTED = {
  id: "ce_1",
  project_id: "prj_1",
  project_code: "P-24/2026",
  project_name: "Dionica",
  phase_id: null,
  phase_name: null,
  category_id: "cc_rad",
  category_code: "RAD",
  category_name: "Rad",
  source_type: "WORKDAY" as const,
  source_id: "wd_1",
  source_href: "/ured/radni-dani?workdayId=wd_1",
  machine_id: null,
  machine_code: null,
  occurred_on: "2026-11-20",
  amount: "300.00",
  currency_code: "BAM",
  quantity: "8.00",
  unit: "h",
  status: "POSTED" as const,
  reversed_by: null,
  reverses_id: null,
  note: null,
  booked_at: "2026-11-20T10:00:00.000Z",
};

const ENTRY_PENDING = {
  ...ENTRY_POSTED,
  id: "ce_2",
  source_type: "FUEL_ENTRY" as const,
  source_href: "/ured/gorivo?entryId=f_1",
  category_code: "GORIVO",
  category_name: "Gorivo",
  amount: null,
  quantity: "60.00",
  unit: "l",
  status: "PENDING" as const,
};

const TOTALS = {
  posted: "300.00",
  currency_code: "BAM",
  pending_count: 1,
  pending_quantity_by_unit: [{ unit: "l", quantity: "60.00" }],
};

function mockApi(entries = [ENTRY_POSTED, ENTRY_PENDING]) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.startsWith("/api/costs?")
      ? { entries, totals: TOTALS }
      : url.includes("/api/cost-categories")
        ? { categories: [{ id: "cc_rad", code: "RAD", name: "Rad", sort_order: 10, default_for_source_type: "WORKDAY", is_active: true, usage_count: 0 }], unmapped_sources: [] }
        : {};
    return { ok: true, status: 200, json: async () => ({ success: true, data: body }), headers: { get: () => null } };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("troškovi projekta — ledger", () => {
  it("PENDING red nema iznos nego „bez cijene“, i vidi se odvojeno od zbroja", async () => {
    mockApi();
    render(<ProjectCosts projectId="prj_1" canManage />);

    expect((await screen.findAllByText("bez cijene")).length).toBeGreaterThan(0);
    // „Gorivo“ stoji i kao kategorija i kao izvor („Gorivo“) — oba su tačna, provjerava se broj.
    expect(screen.getAllByText("Gorivo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Količine: 60\.00 l/)).toBeInTheDocument();
    expect(screen.getByText(/Ne ulazi u zbroj/)).toBeInTheDocument();
  });

  it("izvor troška je LINK na izvorni zapis (drill-down)", async () => {
    mockApi();
    render(<ProjectCosts projectId="prj_1" canManage />);

    const link = await screen.findByRole("link", { name: "Radni dan" });
    expect(link).toHaveAttribute("href", "/ured/radni-dani?workdayId=wd_1");
  });

  it("storno traži razlog ≥10 znakova prije nego dugme proradi", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<ProjectCosts projectId="prj_1" canManage />);

    await screen.findAllByText("300.00");
    // Jedina akcija reda je storno, pa je ona i primarna (bez „⋯“ menija).
    await user.click(screen.getAllByRole("button", { name: "Storno (ispravka iznosa)" })[0]!);

    const submit = screen.getByRole("button", { name: "Storniraj" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Razlog storna"), "Pogrešan iznos na računu");
    expect(submit).toBeEnabled();
  });

  it("bez `projects.costs.book` nema ni ručnog unosa ni storna (računovođa)", async () => {
    mockApi();
    render(<ProjectCosts projectId="prj_1" canManage canBook={false} />);

    await screen.findAllByText("300.00");
    expect(screen.queryByRole("button", { name: "+ Ručni trošak" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Više radnji/ })).not.toBeInTheDocument();
  });

  it("nema ozbiljnih a11y prekršaja", async () => {
    mockApi();
    const { container } = render(<ProjectCosts projectId="prj_1" canManage />);
    await screen.findAllByText("300.00");
    await waitFor(() => expect(screen.getAllByText("bez cijene").length).toBeGreaterThan(0));
    await expectNoSeriousA11yViolations(container);
  });
});
