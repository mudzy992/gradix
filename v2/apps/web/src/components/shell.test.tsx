// @vitest-environment jsdom
/**
 * Okvir (dizajn po `DESIGN.md`): tastatura, tema i a11y.
 *
 * Ovo je jedini način da tvrdnja „radi tastaturom“ i „tema se mijenja“ bude provjerena, a ne
 * izgovorena: test pritiska tipke kao korisnik i gleda gdje fokus ode i šta piše u `data-theme`.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    items: [{ href: "/pregled", label: "Pregled", icon: "home", description: "Mašine" }],
  },
  {
    label: "Ured",
    items: [
      { href: "/ured/korisnici", label: "Korisnici", icon: "users", description: "Ljudi" },
      { href: "/ured/role", label: "Pristup i role", icon: "shield", description: "Ko šta smije" },
      { href: "/ured/audit", label: "Audit trag", icon: "list", description: "Ko je šta mijenjao" },
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

beforeEach(() => {
  document.documentElement.dataset.theme = "light";
  push.mockClear();
});

describe("okvir — tastatura", () => {
  it("prvi Tab ide na „Preskoči na sadržaj“, koji vodi u glavni sadržaj", async () => {
    renderShell();
    await userEvent.tab();
    const skip = screen.getByRole("link", { name: "Preskoči na sadržaj" });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute("href", "#sadrzaj");
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
    expect(links[3]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(links[0]).toHaveFocus();
  });

  it("aktivna stavka je označena sa aria-current", () => {
    renderShell();
    const active = screen.getByRole("link", { name: /Korisnici/ });
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("Ctrl+K otvara pretragu, filtrira, Enter vodi, Esc zatvara", async () => {
    renderShell();
    await userEvent.keyboard("{Control>}k{/Control}");

    const dialog = await screen.findByRole("dialog", { name: "Brza navigacija" });
    const input = within(dialog).getByRole("combobox");
    expect(input).toHaveFocus();

    await userEvent.type(input, "pristup");
    const options = within(dialog).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Pristup i role");

    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/ured/role");
    expect(screen.queryByRole("dialog", { name: "Brza navigacija" })).toBeNull();
  });

  it("Esc u pretrazi zatvara bez navigacije", async () => {
    renderShell();
    await userEvent.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog", { name: "Brza navigacija" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Brza navigacija" })).toBeNull();
    expect(push).not.toHaveBeenCalled();
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

  it("drawer se otvara i zatvara dugmetom, sa aria-expanded", async () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: "Otvori meni" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    const close = screen.getByRole("button", { name: "Zatvori meni" });
    expect(close).toHaveAttribute("aria-expanded", "true");
    // Zatamnjenje je dugme sa imenom — ne „div na koji se klikne“.
    await userEvent.click(screen.getByRole("button", { name: "Zatvori navigaciju" }));
    expect(screen.getByRole("button", { name: "Otvori meni" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("okvir — tema", () => {
  it("prekidač mijenja `data-theme` na <html> i pamti izbor", async () => {
    renderShell();
    expect(document.documentElement.dataset.theme).toBe("light");

    const toDark = screen.getByRole("button", { name: "Pređi na tamnu temu" });
    await userEvent.click(toDark);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("gx-theme")).toBe("dark");

    const toLight = screen.getByRole("button", { name: "Pređi na svijetlu temu" });
    await userEvent.click(toLight);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("gx-theme")).toBe("light");
  });

  it(" „Tema prati sistem“ se nudi samo kad je tema izabrana ručno", async () => {
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: /Korisnički meni/ }));
    // Dok je tema „sistem“, stavka ne postoji — nema šta da se vrati na već važeće stanje.
    expect(screen.queryByRole("menuitem", { name: "Tema prati sistem" })).toBeNull();

    // `Esc` zatvara meni i vraća fokus na dugme.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Korisnički meni" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Pređi na tamnu temu" }));
    await userEvent.click(screen.getByRole("button", { name: /Korisnički meni/ }));
    const reset = screen.getByRole("menuitem", { name: "Tema prati sistem" });
    await userEvent.click(reset);
    expect(window.localStorage.getItem("gx-theme")).toBeNull();
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

  it("ikonice su ukras, ne tekst: dugme ima ime kroz aria-label", () => {
    renderShell();
    // Okrugla dugmad nemaju vidljiv tekst — ime mora doći odnekle.
    for (const button of screen.getAllByRole("button")) {
      const hasText = (button.textContent ?? "").trim().length > 0;
      const hasLabel = button.hasAttribute("aria-label") && button.getAttribute("aria-label") !== "";
      expect(hasText || hasLabel, `dugme bez imena: ${button.outerHTML.slice(0, 80)}`).toBe(true);
    }
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
