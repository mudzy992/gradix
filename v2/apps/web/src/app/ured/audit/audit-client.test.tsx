// @vitest-environment jsdom
/**
 * Audit trag: filteri, „Učitaj još“ (keyset bez duplikata), detalj u dijalogu i a11y.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuditClient from "./audit-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const row = (id: string, action = "user.membership_changed") => ({
  id,
  action,
  entityType: "user",
  entityId: "usr_1",
  actorId: "usr_admin",
  actorEmail: "admin@demo.ba",
  metadata: { from: { roles: ["WORKER"] }, to: { roles: ["WORKER", "DRIVER"] } },
  createdAt: "2026-11-08T10:00:00.000Z",
});

const actors = [{ id: "usr_admin", label: "Amina Karić" }];

function mockPages(pages: { rows: ReturnType<typeof row>[]; nextCursor: string | null }[]) {
  let call = 0;
  const fetchMock = vi.fn(async () => {
    const page = pages[Math.min(call, pages.length - 1)]!;
    call += 1;
    return { ok: true, json: async () => ({ success: true, data: page }) } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audit trag", () => {
  it("prikazuje zapise i bosanski naziv radnje", async () => {
    mockPages([{ rows: [row("a1")], nextCursor: null }]);
    render(<AuditClient actors={actors} />);
    expect(await screen.findByText("Promijenjene role ili opseg")).toBeInTheDocument();
    expect(screen.getByText("admin@demo.ba")).toBeInTheDocument();
    expect(screen.getByText(/To je cijeli trag/)).toBeInTheDocument();
  });

  it("„Učitaj još“ spaja stranice bez duplikata i poštuje cursor", async () => {
    const fetchMock = mockPages([
      { rows: [row("a1"), row("a2")], nextCursor: "cur1" },
      { rows: [row("a2"), row("a3")], nextCursor: null },
    ]);
    render(<AuditClient actors={actors} />);
    await screen.findByText(/Ima još zapisa/);

    await userEvent.click(screen.getByRole("button", { name: "Učitaj još" }));
    await waitFor(() => expect(screen.getByText(/To je cijeli trag/)).toBeInTheDocument());

    // Drugi poziv nosi cursor iz prvog odgovora.
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toContain("cursor=cur1");
    // a2 se pojavljuje samo jedanput (dedup po id).
    // 3 reda u tabeli + 1 opcija u filteru „Radnja“ (isti naziv) — broje se redovi tabele.
    expect(screen.getAllByRole("row")).toHaveLength(4); // 1 zaglavlje + 3 reda
    expect(screen.getAllByText("Promijenjene role ili opseg")).toHaveLength(4);
  });

  it("detalj se otvara u dijalogu i Esc ga zatvara", async () => {
    mockPages([{ rows: [row("a1")], nextCursor: null }]);
    render(<AuditClient actors={actors} />);
    await userEvent.click(await screen.findByRole("button", { name: "Otvori" }));

    const dialog = screen.getByRole("dialog", { name: /Promijenjene role/ });
    expect(within(dialog).getByText(/usr_1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/DRIVER/)).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Fokus se vraća na „Otvori“ iz reda, ne na `<body>`.
    expect(screen.getByRole("button", { name: "Otvori" })).toHaveFocus();
  });

  it("prazno stanje poslije filtera nudi brisanje filtera", async () => {
    mockPages([{ rows: [], nextCursor: null }]);
    render(<AuditClient actors={actors} />);
    expect(await screen.findByText("Trag je još prazan")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Radnja"), "session.revoked_all");
    expect(await screen.findByText("Nema zapisa za ovaj filter")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Obriši filtere" }).length).toBeGreaterThan(0);
  });

  it("greška: poruka i ponovni poziv", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ success: false, error: { code: "INTERNAL", message: "Puklo." } }),
      })) as unknown as typeof fetch,
    );
    render(<AuditClient actors={actors} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Puklo.");
    await userEvent.click(screen.getByRole("button", { name: "Pokušaj ponovo" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("nema serious/critical a11y nalaza (lista)", async () => {
    mockPages([{ rows: [row("a1"), row("a2")], nextCursor: "cur" }]);
    const { container } = render(<AuditClient actors={actors} />);
    await screen.findByText("Promijenjene role ili opseg");
    await expectNoSeriousA11yViolations(container);
  });

  it("nema serious/critical a11y nalaza (dijalog detalja)", async () => {
    mockPages([{ rows: [row("a1")], nextCursor: null }]);
    const { baseElement } = render(<AuditClient actors={actors} />);
    await userEvent.click(await screen.findByRole("button", { name: "Otvori" }));
    await expectNoSeriousA11yViolations(baseElement);
  });
});
