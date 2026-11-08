// @vitest-environment jsdom
/**
 * Okvir (R1c): tastatura i a11y.
 *
 * Ovo je jedini način da tvrdnja „radi tastaturom“ bude provjerena, a ne izgovorena:
 * test pritiska tipke kao korisnik i gleda gdje fokus ode.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Shell, { initialsOf, type NavGroup } from "./shell";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/ured/korisnici",
  useRouter: () => ({ push }),
}));

const groups: NavGroup[] = [
  {
    label: "Pregled",
    items: [{ href: "/pregled", label: "Pregled", icon: "◫", description: "Mašine" }],
  },
  {
    label: "Ured",
    items: [
      { href: "/ured/korisnici", label: "Korisnici", icon: "◍", description: "Ljudi" },
      { href: "/ured/role", label: "Matrica rola", icon: "▤", description: "Ko šta smije" },
      { href: "/ured/audit", label: "Audit trag", icon: "≡", description: "Ko je šta mijenjao" },
    ],
  },
];

const user = {
  displayName: "Amina Karić",
  email: "ured@demo.ba",
  companyName: "Niskogradnja Demo d.o.o.",
  roles: ["ADMIN"],
};

function renderShell() {
  return render(
    <Shell groups={groups} user={user}>
      <h1>Korisnici</h1>
    </Shell>,
  );
}

describe("okvir — tastatura", () => {
  it("prvi Tab ide na „Preskoči na sadržaj“, koji vodi u glavni sadržaj", async () => {
    renderShell();
    await userEvent.tab();
    const skip = screen.getByRole("link", { name: "Preskoči na sadržaj" });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute("href", "#sadrzaj");
    // Cilj preskakanja postoji i ima ID koji link traži.
    expect(document.querySelector("#sadrzaj")).not.toBeNull();
  });

  it("strelicama se prolazi kroz sidebar, Home/End idu na krajeve", async () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Glavna navigacija" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(4);

    links[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(links[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(links[2]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(links[1]).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(links[3]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    // Na zadnjoj stavci strelica dolje ne izlazi iz sidebara.
    expect(links[3]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(links[0]).toHaveFocus();
  });

  it("aktivna stavka je označena sa aria-current", () => {
    renderShell();
    const active = screen.getByRole("link", { name: /Korisnici/ });
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("Ctrl+K otvara pretragu, strelicama bira, Enter vodi, Esc zatvara", async () => {
    renderShell();
    await userEvent.keyboard("{Control>}k{/Control}");

    const dialog = await screen.findByRole("dialog", { name: "Brza navigacija" });
    const input = within(dialog).getByRole("combobox");
    expect(input).toHaveFocus();

    await userEvent.type(input, "mat");
    const options = within(dialog).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Matrica rola");

    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/ured/role");
    expect(screen.queryByRole("dialog", { name: "Brza navigacija" })).toBeNull();
  });

  it("Esc u pretrazi zatvara bez navigacije", async () => {
    renderShell();
    await userEvent.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog", { name: "Brza navigacija" });
    push.mockClear();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Brza navigacija" })).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("sklapanje sidebara je dugme sa stanjem (aria-expanded)", async () => {
    renderShell();
    const collapse = screen.getByRole("button", { name: "Skupi navigaciju" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(collapse);
    const expand = screen.getByRole("button", { name: "Proširi navigaciju" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
  });

  it("korisnički meni se otvara sa aria-haspopup i ima stavke", async () => {
    renderShell();
    const trigger = screen.getByRole("button", { name: /Korisnički meni/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await userEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Korisnički meni" });
    expect(within(menu).getByRole("menuitem", { name: "Promijeni lozinku" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Odjavi se" })).toBeInTheDocument();
  });
});

describe("okvir — a11y", () => {
  it("nema serious/critical nalaza (axe, WCAG 2.1 AA)", async () => {
    const { container } = renderShell();
    await expectNoSeriousA11yViolations(container);
  });

  it("dijalog pretrage nema serious/critical nalaza", async () => {
    const { baseElement } = renderShell();
    await userEvent.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog", { name: "Brza navigacija" });
    await expectNoSeriousA11yViolations(baseElement);
  });
});

describe("initialsOf", () => {
  it("uzima prva slova imena i prezimena", () => {
    expect(initialsOf("Amina Karić")).toBe("AK");
    expect(initialsOf("  Mario   Perić  ")).toBe("MP");
    expect(initialsOf("Emir")).toBe("E");
    expect(initialsOf("")).toBe("?");
  });
});
