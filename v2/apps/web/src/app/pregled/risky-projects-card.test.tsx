// @vitest-environment jsdom
/**
 * Kartica „Rizični projekti“ na pregledu (F5, spec 06 §1.7.28).
 *
 * Ekran ne računa rizik — prikazuje IMENOVANE uzroke koje vrati server. Test čuva dvije stvari:
 *  1. Uzrok je RIJEČIMA („negativna marža“, „preko budžeta“), ne samo boja.
 *  2. `PENDING` je broj zapisa, odvojen od novca.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RiskyProjectsCard } from "./risky-projects-card";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const DATA = {
  projects: [
    {
      id: "prj_1",
      code: "P-24/2026",
      name: "Dionica Visoko–Kiseljak",
      status: "ACTIVE" as const,
      margin: "-1200.00",
      margin_pct: -3.4,
      budget_used_pct: 104.2,
      progress_pct: 62,
      risks: ["NEGATIVE_MARGIN" as const, "OVER_BUDGET" as const, "PENDING_COSTS" as const],
      pending_cost_count: 2,
    },
  ],
  pending_cost_count: 3,
};

describe("pregled — rizični projekti", () => {
  it("imenuje uzroke i vodi na projekat", () => {
    render(<RiskyProjectsCard data={DATA} />);

    expect(screen.getByRole("heading", { name: "Rizični projekti" })).toBeInTheDocument();
    expect(screen.getByText(/Dionica Visoko–Kiseljak/)).toBeInTheDocument();
    expect(screen.getByText(/negativna marža/)).toBeInTheDocument();
    expect(screen.getByText(/preko budžeta/)).toBeInTheDocument();
    expect(screen.getByText(/-1200\.00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dionica/ })).toHaveAttribute(
      "href",
      "/ured/projekti?projekat=prj_1",
    );
  });

  it("broj troškova bez cijene je odvojen od novca", () => {
    render(<RiskyProjectsCard data={DATA} />);
    expect(screen.getByText("Troškovi bez cijene")).toBeInTheDocument();
    expect(screen.getByText(/Broj zapisa, ne iznos/)).toBeInTheDocument();
  });

  it("kad nema rizika, to se kaže riječima (nema prazne tabele)", () => {
    render(<RiskyProjectsCard data={{ projects: [], pending_cost_count: 0 }} />);
    expect(screen.getByText(/Nijedan projekat nije u riziku/)).toBeInTheDocument();
  });

  it("nema ozbiljnih a11y prekršaja", async () => {
    const { container } = render(<RiskyProjectsCard data={DATA} />);
    await expectNoSeriousA11yViolations(container);
  });
});
