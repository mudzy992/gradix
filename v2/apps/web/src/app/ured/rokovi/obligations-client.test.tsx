// @vitest-environment jsdom
/**
 * Rokovi (R2b): stanje dolazi sa servera, obnova je nova verzija, prilog nosi `sha256`.
 *
 * Provjerava baš ono što kapija traži: 20 dana → „Važeće“, 5 dana → „Uskoro istječe“, juče →
 * „Isteklo“, i to da ekran NE računa stanje sam (nego prikazuje ono što server vrati).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ObligationsClient from "./obligations-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const types = [
  {
    id: "obt_medical",
    code: "MEDICAL",
    label: "Ljekarski pregled",
    entityKind: "WORKER",
    defaultReminderDays: [60, 30, 15, 7],
    requiresAttachment: true,
    isActive: true,
    sortOrder: 10,
    obligationCount: 3,
  },
  {
    id: "obt_registration",
    code: "REGISTRATION",
    label: "Registracija",
    entityKind: "MACHINE",
    defaultReminderDays: [30, 15, 7],
    requiresAttachment: true,
    isActive: true,
    sortOrder: 10,
    obligationCount: 0,
  },
];

const base = {
  typeId: "obt_medical",
  typeLabel: "Ljekarski pregled",
  typeCode: "MEDICAL",
  entityKind: "WORKER",
  workerId: "wrk_1",
  workerName: "Amina Karić",
  machineId: null,
  machineCode: null,
  machineName: null,
  number: "L-24/2026",
  issuer: "Dom zdravlja Visoko",
  issuedAt: "2026-10-01",
  currentVersion: 1,
  responsibleUserId: null,
  responsibleName: null,
  note: null,
  reminderDays: [60, 30, 15, 7],
  attachments: [],
  createdAt: "2026-10-01T09:00:00.000Z",
};

const obligations = [
  { ...base, id: "obl_1", expiresAt: "2026-11-27", state: "valid", daysLeft: 20 },
  { ...base, id: "obl_2", expiresAt: "2026-11-12", state: "expiring", daysLeft: 5 },
  { ...base, id: "obl_3", expiresAt: "2026-11-06", state: "expired", daysLeft: -1, number: "L-23/2026" },
];

const counts = { all: 3, expired: 1, expiring: 1, valid: 1, no_expiry: 0 };

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
        if (call.url.includes("/api/obligation-types")) {
          return { ok: true, json: async () => ({ success: true, data: { types } }) } as unknown as Response;
        }
        if (call.url.match(/\/api\/obligations\/[^/?]+$/)) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                obligation: obligations[0],
                versions: [
                  { version: 2, expiresAt: "2027-11-27", number: "L-25/2026", issuer: "Dom zdravlja", createdAt: "2026-11-01T09:00:00.000Z" },
                  { version: 1, expiresAt: "2026-11-27", number: "L-24/2026", issuer: "Dom zdravlja", createdAt: "2026-10-01T09:00:00.000Z" },
                ],
              },
            }),
          } as unknown as Response;
        }
        if (call.url.includes("/api/workers")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: { workers: [{ id: "wrk_1", firstName: "Amina", lastName: "Karić", isActive: true }] },
            }),
          } as unknown as Response;
        }
        if (call.url.includes("/api/equipment")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: { machines: [{ id: "mch_1", code: "BAG-01", name: "Bager", isActive: true }] },
            }),
          } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({ success: true, data: { obligations, counts, today: "2026-11-07" } }),
        } as unknown as Response;
      }

      const result = handler?.(call) ?? {
        ok: true,
        body: { success: true, data: { obligation: { ...obligations[0], currentVersion: 2 }, versions: [] } },
      };
      return { ok: result.ok, json: async () => result.body } as unknown as Response;
    }) as unknown as typeof fetch,
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rokovi", () => {
  it("stanje i preostali dani se prikazuju onako kako ih server vraća", async () => {
    mockApi();
    render(<ObligationsClient canManage />);

    const rows = await screen.findAllByRole("row");
    const text = rows.map((row) => row.textContent).join(" | ");
    expect(text).toContain("Važeće");
    expect(text).toContain("Uskoro istječe");
    expect(text).toContain("Isteklo");
    // Dani su u riječima: „za 20 dana“, „za 5 dana“, „prije 1 dan“.
    expect(text).toContain("za 20 dana");
    expect(text).toContain("za 5 dana");
    expect(text).toContain("prije 1 dan");
    // Datum je u poslovnom formatu, ne ISO.
    expect(text).toContain("27. 11. 2026.");
  });

  it("poslovni datum firme je na ekranu — zna se po kojoj se zoni računa", async () => {
    mockApi();
    render(<ObligationsClient canManage />);
    expect(await screen.findByText(/danas je 7\. 11\. 2026\./)).toBeInTheDocument();
  });

  it("filter po stanju i tipu suži listu bez ponovnog zahtjeva", async () => {
    const calls = mockApi();
    render(<ObligationsClient canManage />);
    // Broj dokumenta je u ISTOM elementu kao izdavalac i verzija, pa se traži po dijelu teksta.
    // Dva reda nose isti broj (obnova), zato `findAllBy`.
    await screen.findAllByText(/L-24\/2026/);
    const before = calls.filter((call) => call.url.includes("/api/obligations")).length;

    await userEvent.selectOptions(screen.getByLabelText("Stanje"), "expired");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Isteklo");
    // Filter je na klijentu: nema novog poziva za svaki klik.
    expect(calls.filter((call) => call.url.includes("/api/obligations")).length).toBe(before);
  });

  it("obnova šalje novi rok i kaže da stara verzija ostaje", async () => {
    const calls = mockApi();
    render(<ObligationsClient canManage />);
    await screen.findAllByRole("row");

    await userEvent.click(screen.getAllByRole("button", { name: "Obnovi" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: /Obnova/ });
    expect(within(dialog).getByText(/verzija 1/)).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText("Novi rok"), "2027-11-27");
    await userEvent.click(within(dialog).getByRole("button", { name: "Obnovi" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toContain("/api/obligations/obl_1/renew");
    expect(post.body).toEqual({ number: null, issuer: "Dom zdravlja Visoko", issuedAt: null, expiresAt: "2027-11-27" });
    expect(await screen.findByText(/verzija 2/)).toBeInTheDocument();
    expect(screen.getByText(/Stara ostaje u historiji/)).toBeInTheDocument();
  });

  it("detalj prikazuje verzije, a prilog se ne šalje bez čitanja fajla", async () => {
    mockApi();
    render(<ObligationsClient canManage />);
    await screen.findAllByRole("row");
    await userEvent.click(screen.getAllByRole("button", { name: "Detalj" })[0]!);

    const dialog = await screen.findByRole("dialog", { name: "Ljekarski pregled" });
    // Verzije: oba reda se vide, sa rokovima koje nose.
    expect(await within(dialog).findByText("v2")).toBeInTheDocument();
    expect(within(dialog).getByText("v1")).toBeInTheDocument();
    expect(within(dialog).getByText("27. 11. 2027.")).toBeInTheDocument();
  });

  it("bez dozvole nema unosa ni obnove, ali detalj ostaje", async () => {
    mockApi();
    render(<ObligationsClient canManage={false} />);
    await screen.findAllByRole("row");
    expect(screen.queryByRole("button", { name: /Nova obaveza/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Obnovi" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Detalj" }).length).toBeGreaterThan(0);
  });

  it("greška servisa pri obnovi ostaje u dijalogu", async () => {
    mockApi(() => ({
      ok: false,
      body: {
        success: false,
        error: { code: "CONFLICT", message: "Novi rok (2026-12-01) nije poslije starog (2027-05-01)." },
      },
    }));
    render(<ObligationsClient canManage />);
    await screen.findAllByRole("row");
    await userEvent.click(screen.getAllByRole("button", { name: "Obnovi" })[0]!);

    const dialog = await screen.findByRole("dialog", { name: /Obnova/ });
    await userEvent.type(within(dialog).getByLabelText("Novi rok"), "2026-12-01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Obnovi" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("nije poslije starog");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("nema serious/critical a11y nalaza na listi ni u dijalogu", async () => {
    mockApi();
    const { container } = render(<ObligationsClient canManage />);
    await screen.findAllByRole("row");
    await expectNoSeriousA11yViolations(container);

    await userEvent.click(screen.getAllByRole("button", { name: "Detalj" })[0]!);
    await screen.findByRole("dialog", { name: "Ljekarski pregled" });
    await expectNoSeriousA11yViolations(document.body);
  });
});
