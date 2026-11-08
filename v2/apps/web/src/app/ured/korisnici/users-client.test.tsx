// @vitest-environment jsdom
/**
 * Lista korisnika (R1c okvir): jedna kontekstualna akcija po redu, dijalog „Role i opseg“
 * kroz tastaturu, zaštićen red bez akcije, i a11y na listi i u dijalogu.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import UsersClient from "./users-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const users = [
  {
    id: "usr_owner",
    email: "vlasnik@demo.ba",
    firstName: "Emir",
    lastName: "Hadžić",
    isActive: true,
    mustChangePassword: false,
    roles: ["OWNER"],
    scope: "COMPANY",
    createdAt: "2026-11-07T10:00:00.000Z",
  },
  {
    id: "usr_worker",
    email: "sef@demo.ba",
    firstName: "Mario",
    lastName: "Perić",
    isActive: true,
    mustChangePassword: false,
    roles: ["SITE_SUPERVISOR"],
    scope: "COMPANY",
    createdAt: "2026-11-07T10:00:00.000Z",
  },
];

type Patch = { url: string; body: unknown };

function mockApi(handler?: (patch: Patch) => { ok: boolean; body: unknown }) {
  const patches: Patch[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const patch = { url: String(url), body: JSON.parse(String(init.body)) };
        patches.push(patch);
        const result = handler?.(patch) ?? {
          ok: true,
          body: { success: true, data: { userId: "usr_worker", before: {}, after: {}, email: "" } },
        };
        return { ok: result.ok, json: async () => result.body } as unknown as Response;
      }
      return { ok: true, json: async () => ({ success: true, data: { users } }) } as unknown as Response;
    }) as unknown as typeof fetch,
  );
  return patches;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderList = (actorIsOwner = false) =>
  render(<UsersClient canManage actorId="usr_admin" actorIsOwner={actorIsOwner} />);

describe("lista korisnika", () => {
  it("u redu je jedna akcija, ostalo u meniju „⋯“", async () => {
    mockApi();
    renderList();
    const row = (await screen.findByText("Mario Perić")).closest("tr")!;
    expect(within(row).getByRole("button", { name: "Reset lozinke" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Više radnji za Mario Perić/ })).toBeInTheDocument();

    await userEvent.click(within(row).getByRole("button", { name: /Više radnji/ }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Role i opseg" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Deaktiviraj osobu" })).toBeInTheDocument();
  });

  it("Esc zatvara meni i vraća fokus na dugme koje ga je otvorilo", async () => {
    mockApi();
    renderList();
    const row = (await screen.findByText("Mario Perić")).closest("tr")!;
    const more = within(row).getByRole("button", { name: /Više radnji/ });
    await userEvent.click(more);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(more).toHaveFocus();
  });

  it("zaštićen red (vlasnik, tuđa ruka) nema ni akciju ni meni — piše „samo vlasnik“", async () => {
    mockApi();
    renderList(false);
    const row = (await screen.findByText("Emir Hadžić")).closest("tr")!;
    expect(within(row).getByText("samo vlasnik")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Više radnji/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Reset lozinke" })).toBeNull();
  });

  it("dijalog: fokus ulazi u njega, „Sačuvaj“ je zaključan dok ništa nije promijenjeno", async () => {
    mockApi();
    renderList();
    const row = (await screen.findByText("Mario Perić")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: /Više radnji/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Role i opseg" }));

    const dialog = screen.getByRole("dialog", { name: "Role i opseg" });
    expect(within(dialog).getByRole("checkbox", { name: "Šef gradilišta" })).toBeChecked();
    // Opseg je segmentirana pilula: stanje nosi `aria-pressed`, ne `checked`.
    expect(within(dialog).getByRole("button", { name: "Cijela firma" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: "Sačuvaj" })).toBeDisabled();
  });

  it("dijalog: promjena role i opsega šalje PATCH i zatvara dijalog", async () => {
    const patches = mockApi();
    renderList();
    const row = (await screen.findByText("Mario Perić")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: /Više radnji/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Role i opseg" }));

    const dialog = screen.getByRole("dialog", { name: "Role i opseg" });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Radnik" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Samo svoje" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Sačuvaj" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]!.url).toContain("/api/users/usr_worker/membership");
    expect(patches[0]!.body).toEqual({ roles: ["SITE_SUPERVISOR", "WORKER"], scope: "SELF" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("dijalog: greška servisa ostaje u dijalogu, forma se ne zatvara", async () => {
    mockApi(() => ({
      ok: false,
      body: { success: false, error: { code: "USERS_TARGET_PROTECTED", message: "Vlasnika mijenja samo vlasnik." } },
    }));
    renderList();
    const row = (await screen.findByText("Mario Perić")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: /Više radnji/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Role i opseg" }));

    const dialog = screen.getByRole("dialog", { name: "Role i opseg" });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Radnik" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Sačuvaj" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Vlasnika mijenja samo vlasnik.");
    expect(screen.getByRole("dialog", { name: "Role i opseg" })).toBeInTheDocument();
  });

  it("Esc zatvara dijalog i vraća fokus na „⋯“", async () => {
    mockApi();
    renderList();
    const row = (await screen.findByText("Mario Perić")).closest("tr")!;
    const more = within(row).getByRole("button", { name: /Više radnji/ });
    await userEvent.click(more);
    await userEvent.click(screen.getByRole("menuitem", { name: "Role i opseg" }));
    expect(screen.getByRole("dialog", { name: "Role i opseg" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Role i opseg" })).toBeNull());
    expect(more).toHaveFocus();
  });

  it("nema serious/critical a11y nalaza (lista)", async () => {
    mockApi();
    const { container } = renderList();
    await screen.findByText("Mario Perić");
    await expectNoSeriousA11yViolations(container);
  });

  it("nema serious/critical a11y nalaza (dijalog)", async () => {
    mockApi();
    const { baseElement } = renderList(true);
    const row = (await screen.findByText("Emir Hadžić")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: /Više radnji/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Role i opseg" }));
    await expectNoSeriousA11yViolations(baseElement);
  });
});
