import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  entries: [] as { localId: string; workerId: null; status: string; lastError: string | null; createdAt: string }[],
  saved: [] as unknown[],
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("expo-router", async () => {
  const React = await import("react");
  const { View } = await import("react-native");
  return { Link: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children),
    useRouter: () => ({ replace: () => undefined }) };
});
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
vi.mock("../api/session-lifecycle", () => ({
  getLogoutSummary: async () => ({ pendingCount: 0, legacyR0Count: 0 }),
  logoutMobile: async () => ({ serverRevoked: true }),
}));
vi.mock("../db/sqlite", () => ({ openDb: async () => ({}) }));
vi.mock("../db/r4-outbox", () => ({
  getActiveLocalAccount: async () => ({ companyId: "c1", userId: "u1" }),
  readOutboxEntries: async () => state.entries,
  queueHseIncident: async (_db: unknown, _account: unknown, payload: unknown) => {
    state.saved.push(payload);
    state.entries = [{ localId: "one", workerId: null, status: "pending", lastError: null, createdAt: "2026-11-23" }];
  },
}));
vi.mock("../sync/r4-sqlite", () => ({
  runSqliteR4Sync: async () => ({ applied: 0, duplicate: 0, conflict: 0, rejected: 0, retry: 1, error: "NETWORK_ERROR" }),
}));
import HsePrijavaScreen from "../app/hse/prijava";

beforeEach(() => { state.entries = []; state.saved = []; });
afterEach(cleanup);

describe("HSE prijava na telefonu", () => {
  it("čuva prijavu lokalno bez API poziva i pokazuje neuspjelo slanje", async () => {
    render(<HsePrijavaScreen />);
    await screen.findByLabelText("Šta se dogodilo?");
    fireEvent.change(screen.getByLabelText("Šta se dogodilo?"), { target: { value: "Neosigurana ivica iskopa" } });
    fireEvent.click(screen.getByText("Sačuvaj na telefon"));
    await screen.findByText("Prijava je sačuvana na telefonu, još nije poslana.");
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({ incidentId: "hsi_11111111-1111-4111-8111-111111111111",
      incident: { kind: "NEAR_MISS", description: "Neosigurana ivica iskopa", injuredWorkerId: null, lostDays: 0 } });
    fireEvent.click(screen.getByText("Pošalji sada"));
    await screen.findByText(/Nema veze sa serverom/);
    expect(screen.getByText("Čeka slanje")).toBeTruthy();
    expect(state.saved).toHaveLength(1);
  });

  it("ne sprema prazan opis i ne predstavlja odbijeni zapis kao poslan", async () => {
    state.entries = [{ localId: "two", workerId: null, status: "rejected", lastError: "SYNC_ITEM_REJECTED", createdAt: "2026-11-23" }];
    render(<HsePrijavaScreen />);
    await screen.findByText("Odbijeno — provjeri s uredom");
    expect(screen.getByText(/1 zahtijeva provjeru/)).toBeTruthy();
    fireEvent.click(screen.getByText("Sačuvaj na telefon"));
    await waitFor(() => expect(screen.getByText("Opiši događaj sa najmanje 5 znakova.")).toBeTruthy());
    expect(state.saved).toHaveLength(0);
  });
});
