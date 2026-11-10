// @vitest-environment jsdom
/** U5 — axe nad katalogom: svako ozbiljno kršenje u bilo kojoj komponenti pada ovdje. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ComponentCatalog } from "./catalog";
import { expectNoSeriousA11yViolations } from "@/test/axe";

describe("katalog komponenti (U5)", () => {
  it("nema serious/critical a11y nalaza ni na jednoj kartici kataloga", async () => {
    const { container } = render(<ComponentCatalog />);
    expect(screen.getByRole("heading", { name: "Katalog komponenti" })).toBeInTheDocument();
    await expectNoSeriousA11yViolations(container);
    await userEvent.click(screen.getByRole("tab", { name: "Tabela i stanja" }));
    await expectNoSeriousA11yViolations(container);
    await userEvent.click(screen.getByRole("tab", { name: "Preklopi" }));
    await userEvent.click(screen.getByRole("button", { name: "Otvori potvrdu" }));
    await expectNoSeriousA11yViolations(container);
  });
});
