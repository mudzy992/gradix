// @vitest-environment jsdom
/** U5 — axe nad katalogom: svako ozbiljno kršenje u bilo kojoj komponenti pada ovdje. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ComponentCatalog } from "./catalog";
import { expectNoSeriousA11yViolations } from "@/test/axe";

describe("katalog komponenti (U5)", () => {
  it("nema serious/critical a11y nalaza, modali imaju X, podnožje i zatvaranje", async () => {
    const { container } = render(<ComponentCatalog />);
    expect(screen.getByRole("heading", { name: "Katalog komponenti" })).toBeInTheDocument();
    // Select lista: opcije postoje i nose tekst (boje nosi CSS: select option iz tokena).
    expect(screen.getByRole("option", { name: "Druga opcija" })).toBeInTheDocument();
    await expectNoSeriousA11yViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "Obični modal" }));
    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("button", { name: "Zatvori" })).toBeInTheDocument();
    expect(dialog.querySelector(".gx-dialog__footer")).not.toBeNull();
    expect(dialog.querySelector(".gx-dialog__body")).not.toBeNull();
    await expectNoSeriousA11yViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Zatvori" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Potvrda (ConfirmDialog)" }));
    expect(screen.getByRole("dialog").querySelector(".gx-dialog__footer")).not.toBeNull();
    await expectNoSeriousA11yViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Odustani" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tabela iz kataloga sortira klikom na zaglavlje", async () => {
    render(<ComponentCatalog />);
    const firstRowName = () => document.querySelector("tbody tr td")?.textContent;
    expect(firstRowName()).toContain("Amina Karić");
    await userEvent.click(screen.getByRole("button", { name: /Sortiraj po: Dani/ }));
    expect(firstRowName()).toContain("Mujo Softić");
  });
});
