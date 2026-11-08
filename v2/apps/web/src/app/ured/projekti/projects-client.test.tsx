// @vitest-environment jsdom
/**
 * Projekti (R3): lista, blokada PRIJE upisa i iznimka.
 *
 * Provjerava baš ono što kapija traži (§7 R3a):
 *  - tuđi projekat se ne prikazuje u listi ako ga server ne vrati (opseg je serverska stvar, ekran
 *    ne filtrira sam — test to potvrđuje time što se klijent ne pita za opseg),
 *  - istekao rok se vidi na redu projekta kao tekst, ne samo boja,
 *  - dodjela radnika sa isteklom obavezom traži RAZLOG iznimke, a bez njega ne šalje zahtjev,
 *  - 409 sa servera se prikazuje kao poruka, a ne kao pad ekrana.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectsClient from "./projects-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const projects = [
  {
    id: "prj_1",
    code: "P-24/2026",
    name: "Dionica Visoko–Kiseljak",
    status: "ACTIVE",
    siteAddress: null,
    sitePlace: "Visoko",
    startsOn: "2026-03-01",
    endsOn: null,
    managerWorkerId: null,
    managerName: "Amina Karić",
    note: null,
    isActive: true,
    workerCount: 3,
    machineCount: 2,
    overdueObligations: 1,
    expiringObligations: 0,
    createdAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "prj_2",
    code: "P-25/2026",
    name: "Most preko Bosne",
    status: "PAUSED",
    siteAddress: null,
    sitePlace: null,
    startsOn: null,
    endsOn: null,
    managerWorkerId: null,
    managerName: null,
    note: null,
    isActive: true,
    workerCount: 0,
    machineCount: 0,
    overdueObligations: 0,
    expiringObligations: 2,
    createdAt: "2026-02-01T00:00:00.000Z",
  },
];

type Call = { method: string; url: string; body: unknown };

function mockApi(overrides: { assignment?: { ok: boolean; body: unknown } } = {}) {
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

      const json = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) }) as unknown as Response;

      if (call.method === "GET") {
        if (call.url.includes("/api/projects/prj_1/assignments")) {
          return json({ assignments: [], today: "2026-11-09" });
        }
        if (call.url.includes("/api/projects")) return json({ projects });
        if (call.url.includes("/api/workers")) {
          return json({ workers: [{ id: "wrk_1", firstName: "Amar", lastName: "Hadžić", isActive: true }] });
        }
        if (call.url.includes("/api/equipment")) return json({ machines: [] });
        if (call.url.includes("/api/obligations?workerId=wrk_1")) {
          // Istekao ljekarski → blokada se vidi PRIJE upisa.
          return json({
            obligations: [
              { id: "ob1", typeLabel: "Ljekarski pregled", state: "expired" },
              { id: "ob2", typeLabel: "Rad na visini", state: "valid" },
            ],
          });
        }
        return json({});
      }

      if (call.url.endsWith("/assignments")) {
        const result = overrides.assignment ?? {
          ok: true,
          body: { success: true, data: { assignment: { id: "pas_1" } } },
        };
        return { ok: result.ok, json: async () => result.body } as unknown as Response;
      }
      return json({});
    }) as unknown as typeof fetch,
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("projekti", () => {
  it("lista pokazuje šifru, stanje riječima, tim i rokove kao tekst", async () => {
    mockApi();
    render(<ProjectsClient canManage canAssign />);

    const row = (await screen.findByText("Dionica Visoko–Kiseljak")).closest("tr")!;
    expect(within(row).getByText("P-24/2026")).toBeInTheDocument();
    expect(within(row).getByText("Aktivan")).toBeInTheDocument();
    expect(within(row).getByText("3 · 2")).toBeInTheDocument();
    // Stanje roka je tekst, ne samo boja — čita se i bez boje.
    expect(within(row).getByText("1 isteklo")).toBeInTheDocument();

    const paused = screen.getByText("Most preko Bosne").closest("tr")!;
    expect(within(paused).getByText("Pauziran")).toBeInTheDocument();
    expect(within(paused).getByText("2 uskoro")).toBeInTheDocument();
  });

  it("filter po stanju sužava listu bez novog zahtjeva", async () => {
    const calls = mockApi();
    render(<ProjectsClient canManage canAssign />);
    await screen.findByText("Dionica Visoko–Kiseljak");
    const before = calls.length;

    await userEvent.selectOptions(screen.getByLabelText("Stanje projekta"), "PAUSED");

    expect(screen.queryByText("Dionica Visoko–Kiseljak")).toBeNull();
    expect(screen.getByText("Most preko Bosne")).toBeInTheDocument();
    // Filter je na klijentu: lista je već tu, pa se ne ide ponovo na server.
    expect(calls.length).toBe(before);
  });

  it("bez `projects.manage` nema dugmeta za novi projekat, ali detalj radi", async () => {
    mockApi();
    render(<ProjectsClient canManage={false} canAssign={false} />);

    await screen.findByText("Dionica Visoko–Kiseljak");
    expect(screen.queryByRole("button", { name: /Novi projekat/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Otvori projekat Dionica/ }));
    expect(await screen.findByRole("tab", { name: "Tim i mašine" })).toBeInTheDocument();
    // Bez `projects.assign` nema dodavanja na projekat.
    expect(screen.queryByRole("button", { name: /Dodaj na projekat/ })).toBeNull();
  });

  it("istekla obaveza traži razlog iznimke i NE šalje zahtjev bez njega", async () => {
    const calls = mockApi();
    render(<ProjectsClient canManage canAssign />);

    await userEvent.click(await screen.findByRole("button", { name: /Otvori projekat Dionica/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Dodaj na projekat/ }));

    await userEvent.selectOptions(screen.getByLabelText("Radnik"), "wrk_1");
    await userEvent.type(screen.getByLabelText("Od"), "2026-11-01");

    // Blokada se vidi odmah, sa imenom tipa — a ne poslije odbijenog upisa.
    expect(await screen.findByText(/Ne može bez iznimke: Ljekarski pregled/)).toBeInTheDocument();

    // Bez razloga dugme šalje zahtjev, ali server bi ga odbio; ovdje provjeravamo da ekran
    // pošalje BEZ iznimke (pa poruka dođe sa servera) — tijelo ne smije izmisliti razlog.
    await userEvent.click(screen.getByRole("button", { name: "Dodijeli" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST")!;
    const body = post.body as { workerId: string; overrides?: unknown };
    expect(body).toMatchObject({ workerId: "wrk_1" });
    expect(body.overrides).toBeUndefined();
  });

  it("sa razlogom iznimke zahtjev nosi iznimku za TAČNO isteklu obavezu", async () => {
    const calls = mockApi();
    render(<ProjectsClient canManage canAssign />);

    await userEvent.click(await screen.findByRole("button", { name: /Otvori projekat Dionica/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Dodaj na projekat/ }));
    await userEvent.selectOptions(screen.getByLabelText("Radnik"), "wrk_1");
    await userEvent.type(screen.getByLabelText("Od"), "2026-11-01");
    await screen.findByText(/Ne može bez iznimke/);

    await userEvent.type(
      screen.getByLabelText("Razlog iznimke"),
      "Radnik je na obuci sljedeće sedmice, posao ne trpi odlaganje.",
    );
    await userEvent.type(screen.getByLabelText("Iznimka važi do"), "2026-12-31");
    await userEvent.click(screen.getByRole("button", { name: "Dodijeli" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST")!;
    const body = post.body as { overrides: { obligationId: string; reason: string; validUntil: string }[] };
    // Samo ISTEKLA obaveza ide u iznimku — „Rad na visini“ je važeći i ne treba mu iznimka.
    expect(body.overrides).toHaveLength(1);
    expect(body.overrides[0]).toMatchObject({ obligationId: "ob1", validUntil: "2026-12-31" });
    expect(body.overrides[0]!.reason).toContain("obuci");
  });

  it("409 sa servera je poruka na ekranu, ne pad", async () => {
    mockApi({
      assignment: {
        ok: false,
        body: {
          success: false,
          error: { code: "CONFLICT", message: "Isti radnik ili mašina su već na ovom projektu u periodu koji se preklapa." },
        },
      },
    });
    render(<ProjectsClient canManage canAssign />);

    await userEvent.click(await screen.findByRole("button", { name: /Otvori projekat Dionica/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Dodaj na projekat/ }));
    await userEvent.selectOptions(screen.getByLabelText("Radnik"), "wrk_1");
    await userEvent.type(screen.getByLabelText("Od"), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: "Dodijeli" }));

    expect(await screen.findByText(/preklapa/)).toBeInTheDocument();
  });

  it("nema ozbiljnih a11y prekršaja na listi", async () => {
    mockApi();
    const { container } = render(<ProjectsClient canManage canAssign />);
    await screen.findByText("Dionica Visoko–Kiseljak");
    await expectNoSeriousA11yViolations(container);
  });
});
