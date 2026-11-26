import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ saved: [] as unknown[], unresolved: false }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("expo-router", async () => {
  const React = await import("react");
  const { View } = await import("react-native");
  return { Link: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children),
    useRouter: () => ({ replace: () => undefined }) };
});
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
vi.mock("../api/session-lifecycle", () => ({
  getLogoutSummary: async () => ({ pendingCount: 0, legacyR0Count: 0 }), logoutMobile: async () => ({ serverRevoked: true }),
}));
vi.mock("../api/client", () => ({ fetchDiaryDetail: async () => { throw new Error("offline"); } }));
vi.mock("../db/sqlite", () => ({ openDb: async () => ({}), readProjects: async () => ({ rows: [
  { id: "p1", code: "P1", name: "Gradilište", status: "ACTIVE" },
] }) }));
vi.mock("../db/r4-outbox", () => ({
  getActiveLocalAccount: async () => ({ companyId: "c1", userId: "u1" }),
  readOutboxEntries: async () => [],
  cacheDiaryDetail: async () => undefined, clearDiaryDetailCache: async () => undefined,
  readDiaryDetailCache: async () => ({ fetchedAt: "2026-11-23", detail: {
    diary: { id: "d1", projectId: "p1", diaryDate: "2026-11-23", status: "DRAFT", version: 2 },
    auto: { workers: [{ workerId: "w1", workerName: "Ana Anić", minutes: 480, hours: "8.00" }], machines: [], hauls: [], faults: [], workedHours: "8.00", generatedAt: "2026-11-23T08:00:00Z" },
    items: [], delays: [],
  } }),
  hasUnresolvedDiaryEdit: async () => state.unresolved,
  queueSiteDiary: async (_db: unknown, _account: unknown, value: unknown) => { state.saved.push(value); },
  queueSiteDiaryItem: async (_db: unknown, _account: unknown, value: unknown) => { state.saved.push(value); },
}));
vi.mock("../sync/r4-sqlite", () => ({ runSqliteR4Sync: async () => ({ applied: 0, duplicate: 0, conflict: 0, rejected: 0, retry: 1, error: "NETWORK_ERROR" }) }));
import DnevnikScreen from "../app/dnevnik";

beforeEach(() => { state.saved = []; state.unresolved = false; });
afterEach(cleanup);

describe("Mobilni dnevnik", () => {
  it("čita lokalni presjek i čuva dopunu kao nepotpisani offline nacrt", async () => {
    render(<DnevnikScreen />);
    fireEvent.change(await screen.findByLabelText("Datum dnevnika (GGGG-MM-DD)"), { target: { value: "2026-11-23" } });
    fireEvent.click(await screen.findByText("P1 · Gradilište"));
    expect(await screen.findByText("Ana Anić")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Opis radova"), { target: { value: "Iskop temelja" } });
    fireEvent.change(screen.getByLabelText("Posjetioci"), { target: { value: "Nadzor" } });
    fireEvent.click(screen.getByText("Sačuvaj nacrt na telefon"));
    await screen.findByText("Nacrt je sačuvan na telefonu; još nije poslan.");
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({ diaryId: "d1", baseVersion: 2, diary: {
      projectId: "p1", diaryDate: "2026-11-23", description: "Iskop temelja", visitors: "Nadzor", signedName: null,
    } });
  });

  it("čuva ručnu količinu vezanu za poslovni dan, ne vrijeme slanja", async () => {
    render(<DnevnikScreen />);
    fireEvent.change(await screen.findByLabelText("Datum dnevnika (GGGG-MM-DD)"), { target: { value: "2026-11-23" } });
    fireEvent.click(await screen.findByText("P1 · Gradilište"));
    await screen.findByText("Ana Anić");
    fireEvent.change(screen.getByLabelText("Opis količine"), { target: { value: "Iskop" } });
    fireEvent.change(screen.getByLabelText("Jedinica"), { target: { value: "m3" } });
    fireEvent.change(screen.getByLabelText("Količina"), { target: { value: "12.5" } });
    fireEvent.click(screen.getByText("Sačuvaj količinu na telefon"));
    await screen.findByText("Količina je sačuvana na telefonu; još nije poslana.");
    expect(state.saved[0]).toMatchObject({ diaryProjectId: "p1", diaryDate: "2026-11-23",
      item: { description: "Iskop", quantity: "12.5", unit: "m3", source: "MANUAL" } });
  });

  it("potpisuje prikazani presjek i bilježi vrijeme na telefonu", async () => {
    render(<DnevnikScreen />);
    fireEvent.change(await screen.findByLabelText("Datum dnevnika (GGGG-MM-DD)"), { target: { value: "2026-11-23" } });
    fireEvent.click(await screen.findByText("P1 · Gradilište"));
    await screen.findByText("Ana Anić");
    fireEvent.change(screen.getByLabelText("Ime i prezime potpisnika"), { target: { value: "Šef Gradilišta" } });
    fireEvent.click(screen.getByText("Potpiši prikazani presjek"));
    await screen.findByText(/Potpis je sačuvan na telefonu/);
    expect(state.saved[0]).toMatchObject({ diaryId: "d1", baseVersion: 2,
      diary: { signedName: "Šef Gradilišta", signature: { signedAt: expect.any(String), autoSnapshotJson: expect.any(String) } } });
    const saved = state.saved[0] as { diary: { signature: { autoSnapshotJson: string } } };
    expect(JSON.parse(saved.diary.signature.autoSnapshotJson).workers[0].workerName).toBe("Ana Anić");
    expect(JSON.parse(saved.diary.signature.autoSnapshotJson).generatedAt).toBeUndefined();
  });

  it("ne prenosi nespremljeni unos na drugi datum", async () => {
    render(<DnevnikScreen />);
    fireEvent.change(await screen.findByLabelText("Datum dnevnika (GGGG-MM-DD)"), { target: { value: "2026-11-23" } });
    fireEvent.click(await screen.findByText("P1 · Gradilište"));
    await screen.findByText("Ana Anić");
    fireEvent.change(screen.getByLabelText("Opis radova"), { target: { value: "Iskop" } });
    fireEvent.change(screen.getByLabelText("Datum dnevnika (GGGG-MM-DD)"), { target: { value: "2026-11-24" } });
    expect(screen.getByText(/Sačuvaj ili odbaci nespremljeni unos prije promjene datuma/)).toBeTruthy();
    expect((screen.getByLabelText("Datum dnevnika (GGGG-MM-DD)") as HTMLInputElement).value).toBe("2026-11-23");
    fireEvent.click(screen.getByText("Odbaci nespremljeni unos"));
    expect((screen.getByLabelText("Opis radova") as HTMLInputElement).value).toBe("");
  });

  it("ne stvara drugi nacrt dok prethodni čeka razrješenje", async () => {
    state.unresolved = true;
    render(<DnevnikScreen />);
    fireEvent.click(await screen.findByText("P1 · Gradilište"));
    fireEvent.click(screen.getByText("Sačuvaj nacrt na telefon"));
    await waitFor(() => expect(screen.getByText(/već čeka slanje ili razrješenje/)).toBeTruthy());
    expect(state.saved).toHaveLength(0);
  });
});
