import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ saved: [] as unknown[], offline: true }));
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
vi.mock("../api/client", () => ({
  myProjects: async () => { throw new Error("offline"); },
  pullForemanWorkers: async () => { if (state.offline) throw new Error("offline"); return { workers: [] }; },
}));
vi.mock("../db/sqlite", () => ({
  openDb: async () => ({}),
  readProjects: async () => ({ rows: [{ id: "p1", code: "P1", name: "Gradilište", status: "ACTIVE" }], fetchedAt: "2026-11-23" }),
  saveProjects: async () => undefined,
}));
vi.mock("../db/r4-outbox", () => ({
  getActiveLocalAccount: async () => ({ companyId: "c1", userId: "u1" }),
  readOutboxEntries: async () => [], saveForemanWorkerRoster: async () => undefined,
  readForemanWorkerRoster: async () => ({ workers: [{ id: "w1", name: "Ana Anić" }, { id: "w2", name: "Ivo Ivić" }], fetchedAt: "2026-11-23" }),
  queueHseTraining: async (_db: unknown, _account: unknown, payload: unknown) => { state.saved.push(payload); },
}));
vi.mock("../sync/r4-sqlite", () => ({ runSqliteR4Sync: async () => ({ applied: 0, duplicate: 0, conflict: 0, rejected: 0, retry: 1, error: "NETWORK_ERROR" }) }));
import ToolboxScreen from "../app/hse/toolbox";

beforeEach(() => { state.saved = []; state.offline = true; });
afterEach(cleanup);

describe("Toolbox offline", () => {
  it("preuzima lokalnu ekipu, bilježi zasebne potpise i čuva bez mreže", async () => {
    render(<ToolboxScreen />);
    fireEvent.click(await screen.findByText("P1 · Gradilište"));
    fireEvent.click(await screen.findByText("Potpis: Ana Anić"));
    fireEvent.click(screen.getByText("Potpis: Ivo Ivić"));
    fireEvent.change(screen.getByLabelText("Tema razgovora"), { target: { value: "Zaštita pri iskopu" } });
    fireEvent.click(screen.getByText("Sačuvaj na telefon"));
    await screen.findByText("Toolbox je sačuvan na telefonu, još nije poslan.");
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({ training: { kind: "TOOLBOX", projectId: "p1", topic: "Zaštita pri iskopu", durationMinutes: 15,
      attendees: [{ workerId: "w1", signatureName: "Ana Anić", signedAt: expect.any(String) },
        { workerId: "w2", signatureName: "Ivo Ivić", signedAt: expect.any(String) }] } });
  });

  it("bez potpisa ne stavlja obuku u red", async () => {
    render(<ToolboxScreen />);
    fireEvent.click(await screen.findByText("P1 · Gradilište"));
    await screen.findByText("Potpis: Ana Anić");
    fireEvent.change(screen.getByLabelText("Tema razgovora"), { target: { value: "Zaštita pri iskopu" } });
    fireEvent.click(screen.getByText("Sačuvaj na telefon"));
    await screen.findByText(/najmanje jedan potpis/);
    expect(state.saved).toHaveLength(0);
  });
});
