/**
 * Render testovi ključnih stanja Step 7 ekrana (Moj dan, Grupa) kroz react-native-web.
 * API/SQLite/sync se mokuju na granici modula — sinhronizaciju dokazuje simulator,
 * ovdje se dokazuje da ekran svako stanje prikaže razumljivo i bez riječi "odbijeno".
 */
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  meError: false,
  projects: [] as { id: string; code: string; name: string }[],
  workers: [] as { id: string; name: string }[],
  entries: [] as { localId: string; workerId: string | null; status: string; lastError: string | null; createdAt: string }[],
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

vi.mock("expo-router", async () => {
  const React = await import("react");
  const { View } = await import("react-native");
  return {
    Link: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children),
  };
});

vi.mock("../api/session-lifecycle", () => ({
  REVOKED_SESSION_MESSAGE: "Sesija je opozvana. Prijavi se ponovo.",
  getLogoutSummary: async () => ({ pendingCount: 2, legacyR0Count: 0 }),
  logoutMobile: async () => ({ serverRevoked: true }),
}));

vi.mock("../api/client", () => ({
  getAccessToken: async () => "test-token",
  login: async () => ({}),
  me: async () => {
    if (state.meError) throw new Error("network down");
    return { user: { id: "u1", firstName: "Mario", lastName: "Perić", roles: ["SITE_SUPERVISOR"] }, company: { id: "c1", name: "Demo" } };
  },
  myProjects: async () => ({ projects: state.projects }),
  machines: async () => ({ machines: [{ id: "m1", code: "BAG-01", name: "Bager CAT 320" }] }),
  pullForemanWorkers: async () => ({ workDate: "2026-11-07", workers: state.workers }),
}));

vi.mock("../db/sqlite", () => ({ openDb: async () => ({}) }));

vi.mock("../db/r4-outbox", () => ({
  getActiveLocalAccount: async () => ({ companyId: "c1", userId: "u1" }),
  readOutboxEntries: async () => state.entries,
  queueOwnWorkEntry: async () => ({}),
  saveForemanWorkerRoster: async () => undefined,
  readForemanWorkerRoster: async () => ({ workers: state.workers, fetchedAt: null }),
  queueForemanGroupWorkEntries: async () => [],
  activateLocalAccount: async () => undefined,
  clearLocalAccountData: async () => undefined,
}));

vi.mock("../sync/r4-sqlite", () => ({
  runSqliteR4Sync: async () => ({ applied: 0, duplicate: 0, conflict: 0, rejected: 0, retry: 1, pulledEvents: 0, cursor: "0", cursorBlockedByPendingSlot: false, error: "NETWORK_ERROR" }),
}));

import MojDanScreen from "../app/moj-dan";
import GrupaScreen from "../app/grupa";
import IndexScreen from "../app/index";
import { Alert } from "react-native";
import { fireEvent } from "@testing-library/react";

const project = { id: "p1", code: "P-01/2026", name: "Dionica Visoko–Kiseljak" };

afterEach(() => cleanup());

beforeEach(() => {
  state.meError = false;
  state.projects = [];
  state.workers = [];
  state.entries = [];
});

describe("Moj dan — stanja", () => {
  it("učitavanje pa prazno stanje bez dodijeljenih projekata", async () => {
    render(<MojDanScreen />);
    expect(screen.getByLabelText("Učitavanje")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Nema dodijeljenih projekata/)).toBeTruthy());
  });

  it("greška pri učitavanju nudi ponovni pokušaj", async () => {
    state.meError = true;
    render(<MojDanScreen />);
    await waitFor(() => expect(screen.getByText(/Podaci se nisu mogli učitati/)).toBeTruthy());
    expect(screen.getByText("Pokušaj ponovo")).toBeTruthy();
  });

  it("offline: zapis čeka slanje i to piše na ekranu", async () => {
    state.projects = [project];
    state.entries = [{ localId: "l1", workerId: null, status: "failed", lastError: "NETWORK_ERROR", createdAt: "2026-11-07T07:30:00Z" }];
    render(<MojDanScreen />);
    await waitFor(() => expect(screen.getAllByText(/Čeka slanje/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Sačuvano na ovom telefonu/)).toBeTruthy();
  });

  it("poslano stanje zapisa", async () => {
    state.projects = [project];
    state.entries = [{ localId: "l1", workerId: null, status: "sent", lastError: null, createdAt: "2026-11-07T07:30:00Z" }];
    render(<MojDanScreen />);
    await waitFor(() => expect(screen.getByText("Poslano")).toBeTruthy());
    expect(screen.getAllByText("Sve je poslano.").length).toBeGreaterThan(0);
  });
});

describe("Početni ekran — odjava s neposlanim zapisima", () => {
  it("odjava s neposlanim traži eksplicitnu potvrdu i kaže koliko redova čeka", async () => {
    const alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
    render(<IndexScreen />);
    const logout = await screen.findByText("Odjavi se");
    fireEvent.click(logout);
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const [title, explanation, buttons] = alertSpy.mock.calls[0] as unknown as [string, string, { text: string }[]];
    expect(title).toBe("Potvrdi odjavu");
    expect(explanation).toContain("R4 outbox redovi: 2");
    expect(buttons.map((b) => b.text)).toEqual(expect.arrayContaining(["Ostani prijavljen", "Odjavi se"]));
    alertSpy.mockRestore();
  });
});

describe("Grupa — stanja i ishod po radniku", () => {
  it("prazno: nema radnika u opsegu", async () => {
    state.projects = [project];
    render(<GrupaScreen />);
    await waitFor(() => expect(screen.getByText(/Nema radnika u tvom opsegu/)).toBeTruthy());
  });

  it("ishod po radniku: poslano, čeka, van opsega (bez riječi odbijeno)", async () => {
    state.projects = [project];
    state.workers = [
      { id: "w1", name: "Amar Hadžić" },
      { id: "w2", name: "Nedim Softić" },
      { id: "w3", name: "Selmir Begić" },
    ];
    state.entries = [
      { localId: "l1", workerId: "w1", status: "sent", lastError: null, createdAt: "2026-11-07T08:00:00Z" },
      { localId: "l2", workerId: "w2", status: "pending", lastError: null, createdAt: "2026-11-07T08:00:00Z" },
      { localId: "l3", workerId: "w3", status: "rejected", lastError: "FOREMAN_SCOPE_FORBIDDEN", createdAt: "2026-11-07T08:00:00Z" },
    ];
    render(<GrupaScreen />);
    await waitFor(() => expect(screen.getByText("Amar Hadžić")).toBeTruthy());
    expect(screen.getAllByText("Poslano").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Čeka slanje/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Van opsega").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ostaje na telefonu/).length).toBeGreaterThan(0);
    expect(document.body.textContent?.toLowerCase()).not.toContain("odbijen");
  });
});
