// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RowActions } from "./overlays";
import { DataTable } from "./data-table";

describe("liste/tabele u fiksnom shellu", () => {
  it("DataTable je u gx-table-scroll omotaču", () => {
    const { container } = render(
      <DataTable
        caption="Demo"
        rowKey={(row) => row.id}
        columns={[{ key: "name", header: "Ime", cell: (row) => row.name }]}
        rows={[{ id: "1", name: "Amina" }]}
      />,
    );
    expect(container.querySelector(".gx-table-scroll")).not.toBeNull();
    expect(container.querySelector("table.gx-table")).not.toBeNull();
  });

  it("RowActions ⋯ meni ide u document.body (ne siječe ga overflow)", async () => {
    render(
      <div className="gx-page gx-scroll-hidden" style={{ overflow: "hidden", height: 80 }}>
        <RowActions
          label="Akcije reda"
          actions={[
            { key: "view", label: "Otvori", onSelect: () => undefined },
            { key: "edit", label: "Uredi", onSelect: () => undefined },
          ]}
        />
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Akcije reda" }));
    const menu = screen.getByRole("menu", { name: "Akcije reda" });
    expect(menu).toHaveClass("gx-menu--floating");
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByRole("menuitem", { name: "Uredi" })).toBeInTheDocument();
  });
});
