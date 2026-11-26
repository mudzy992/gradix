import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  entries: [] as { localId: string; workerId: null; status: string; lastError: string | null; createdAt: string }[],
  saved: [] as unknown[],
  projects: [] as { id: string; code: string; name: string; status: string }[],
  workers: [] as { id: string; name: string }[],
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "11111111-1111-4111-8111-111111111111",
  CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: async () => new Uint8Array(32).fill(1).buffer }));
vi.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: async () => ({ granted: true }),
  launchCameraAsync: async () => ({ canceled: false, assets: [{ base64: "/9j/AA==", uri: "file://photo" }] }) }));
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
vi.mock("../api/client", () => ({ myProjects: async () => ({ projects: state.projects }), pullHseWorkers: async () => { throw new Error("offline"); } }));
vi.mock("../db/sqlite", () => ({ openDb: async () => ({}), readProjects: async () => ({ rows: state.projects, fetchedAt: null }), saveProjects: async () => undefined }));
vi.mock("../db/r4-outbox", () => ({
  getActiveLocalAccount: async () => ({ companyId: "c1", userId: "u1" }),
  readOutboxEntries: async () => state.entries,
  saveForemanWorkerRoster: async () => undefined,
  readForemanWorkerRoster: async () => ({ workers: state.workers, fetchedAt: null }),
  queueHseIncident: async (_db: unknown, _account: unknown, payload: unknown) => {
    state.saved.push(payload);
    state.entries = [{ localId: "one", workerId: null, status: "pending", lastError: null, createdAt: "2026-11-23" }];
  },
}));
vi.mock("../sync/hse-photo-sync", () => ({ countPendingHsePhotos: async () => 0 }));
vi.mock("../sync/r4-sqlite", () => ({
  runSqliteR4Sync: async () => ({ applied: 0, duplicate: 0, conflict: 0, rejected: 0, retry: 1, error: "NETWORK_ERROR" }),
}));
import HsePrijavaScreen from "../app/hse/prijava";

beforeEach(() => { state.entries = []; state.saved = []; state.projects = []; state.workers = []; });
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Pošalji sada" }).getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(screen.getByText("Pošalji sada"));
    await screen.findByText(/Nema veze sa serverom/, {}, { timeout: 5000 });
    expect(screen.getByText("Čeka slanje")).toBeTruthy();
    expect(state.saved).toHaveLength(1);
  });

  it("nudi izbor projekta i povrijeđenog iz lokalne ekipe bez mreže", async () => {
    state.projects = [{ id: "p1", code: "P1", name: "Gradilište", status: "ACTIVE" }];
    state.workers = [{ id: "w1", name: "Ana Anić" }];
    render(<HsePrijavaScreen />);
    fireEvent.click(await screen.findByText("Nesreća"));
    fireEvent.click(screen.getByText("P1 · Gradilište"));
    fireEvent.click(await screen.findByText("Uključen: Ana Anić"));
    fireEvent.click(await screen.findByText("Povrijeđen: Ana Anić"));
    fireEvent.change(screen.getByLabelText("Šta se dogodilo?"), { target: { value: "Povreda na gradilištu" } });
    fireEvent.click(screen.getByText("Sačuvaj na telefon"));
    await screen.findByText("Prijava je sačuvana na telefonu, još nije poslana.");
    expect(state.saved[0]).toMatchObject({ incident: { projectId: "p1", injuredWorkerId: "w1", kind: "ACCIDENT",
      involvedWorkers: [{ workerId: "w1", injured: true }] } });
  });

  it("veže bajtove i checksum fotografije uz offline prijavu", async () => {
    render(<HsePrijavaScreen />);
    fireEvent.change(await screen.findByLabelText("Šta se dogodilo?"), { target: { value: "Neosiguran rub" } });
    fireEvent.click(screen.getByText("Uslikaj fotografiju"));
    await screen.findByText("Fotografija je spremna za lokalno čuvanje uz prijavu.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Sačuvaj na telefon" }).getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(screen.getByText("Sačuvaj na telefon"));
    await screen.findByText("Prijava je sačuvana na telefonu, još nije poslana.");
    expect(state.saved[0]).toMatchObject({ photoData: [{ sha256: "01".repeat(32), base64: "/9j/AA==" }],
      incident: { photos: [{ sha256: "01".repeat(32), sizeBytes: 4, contentType: "image/jpeg" }] } });
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
