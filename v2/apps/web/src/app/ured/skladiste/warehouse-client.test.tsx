// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { WarehouseClient } from "./warehouse-client";

const warehouses = [
  { id: "central", code: "C", name: "Centralno", kind: "CENTRAL", project_id: null, address: null, is_active: true },
  { id: "site", code: "S", name: "Gradilište", kind: "SITE", project_id: "p", address: null, is_active: true },
];
const balances = [{ warehouse_id: "central", warehouse_name: "Centralno", item_id: "i", code: "I", name: "Cement", unit: "kg", min_quantity: "5", max_quantity: null, on_hand: "3", below_minimum: true }];
const counts = [{ id: "count", warehouse_id: "central", status: "DRAFT", reason: "Inventura", created_at: "2026-11-01", applied_at: null }];
function mockApi() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const data = url === "/api/warehouses" ? { warehouses }
      : url === "/api/stock/balance" ? { balances }
      : url === "/api/stock-counts" && !init?.method ? { counts }
      : url === "/api/stock-counts/count" ? { count: counts[0], items: [{ item_id: "i", counted_quantity: "2", system_quantity: null, difference: null }] }
      : url === "/api/stock-transfers" ? { transferId: "t", belowMinimum: true }
      : { id: "count", alreadyApplied: false };
    return { ok: true, status: 200, json: async () => ({ success: true, data }), headers: { get: () => null } };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("skladište", () => {
  it("prikazuje stanje, upozorenje i pregled popisa prije primjene", async () => {
    const fetch = mockApi();
    const user = userEvent.setup();
    const { container } = render(<WarehouseClient canManage canPurchase />);
    expect(await screen.findByText("Ispod minimuma")).toBeInTheDocument();
    expect(screen.getByRole("link", {name:"Predloži nabavku"})).toHaveAttribute("href", "/ured/nabavka?item=i&warehouse=central");
    await user.click(screen.getByRole("button", { name: "Pregledaj popis" }));
    expect(await screen.findByRole("table", { name: "Stavke odabranog popisa" })).toHaveTextContent("2");
    await user.click(screen.getByRole("button", { name: "Primijeni ovaj popis" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/stock-counts/count/apply", expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "Inventura" }) })));
    await expectNoSeriousA11yViolations(container);
  });
  it("šalje transfer i prikazuje upozorenje ako izvor padne ispod minimuma", async () => {
    const fetch = mockApi();
    const user = userEvent.setup();
    render(<WarehouseClient canManage canPurchase={false} />);
    await screen.findByText("Ispod minimuma");
    await user.selectOptions(screen.getByLabelText("Iz skladišta"), "central");
    await user.selectOptions(screen.getByLabelText("U skladište"), "site");
    await user.selectOptions(screen.getByLabelText("Artikal za transfer"), "i");
    await user.type(screen.getByLabelText("Količina za transfer"), "1.25");
    await user.click(screen.getByRole("button", { name: "Izvrši transfer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/stock-transfers", expect.objectContaining({ method: "POST", body: expect.stringContaining('"quantity":"1.25"') })));
    expect(await screen.findByText(/izvor je ispod minimuma/)).toBeInTheDocument();
  });
  it("bez dozvole ne nudi transfer ili popis", async () => {
    const fetch = mockApi();
    render(<WarehouseClient canManage={false} canPurchase={false} />);
    await screen.findByText("Ispod minimuma");
    expect(screen.queryByRole("button", { name: "Izvrši transfer" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/api/stock-counts", expect.anything());
  });
});
