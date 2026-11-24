// @vitest-environment jsdom
/**
 * Pregled projekta — novac, EAC i zatvaranje (F5).
 *
 * Test čuva TRI obećanja koja se lako tiho pokvare:
 *  1. EAC bez napretka se NE prikazuje kao broj (nula bi bila tvrdnja koju nemamo).
 *  2. EAC je označen kao PROCJENA — nikad kao knjižen iznos.
 *  3. `PENDING` je broj zapisa odvojen od novca, nikad sabran sa troškom.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectOverview } from "./project-overview";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import type { ProfitabilityResult } from "@/server/project-finance-types";

const PROFITABILITY: ProfitabilityResult = {
  project_id: "prj_1",
  currency_code: "BAM",
  contract_value: "100000.00",
  approved_amendments: "5000.00",
  contract_with_amendments: "105000.00",
  posted_cost: "40000.00",
  margin: "65000.00",
  margin_pct: 61.9,
  pending_cost_count: 2,
  eac: { kind: "EAC_ESTIMATE" as const, amount: "80000.00", progress_pct: 50, reason: null },
  by_category: [
    { category_id: "cc_1", category_code: "RAD", category_name: "Rad", budget: "20000.00", posted: "25000.00" },
  ],
};

const PHASES = { phases: [], progress_pct: 50, progress_source: "MANUAL" as const };

function mockApi(profitability: ProfitabilityResult = PROFITABILITY) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("/profitability")
        ? profitability
        : url.includes("/phases")
          ? PHASES
          : {};
      return { ok: true, status: 200, json: async () => ({ success: true, data: body }), headers: { get: () => null } };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pregled projekta — novac i EAC", () => {
  it("marža, vrijednost sa aneksima i trošak stoje uz objašnjenje", async () => {
    mockApi();
    render(<ProjectOverview projectId="prj_1" canManage={false} onOpenTab={() => undefined} />);

    expect(await screen.findByText("105000.00")).toBeInTheDocument();
    expect(screen.getByText("40000.00")).toBeInTheDocument();
    expect(screen.getByText("65000.00")).toBeInTheDocument();
    expect(screen.getByText(/odobreni aneksi: 5000\.00/)).toBeInTheDocument();
  });

  it("EAC je jasno označen kao procjena, ne kao knjiga", async () => {
    mockApi();
    render(<ProjectOverview projectId="prj_1" canManage={false} onOpenTab={() => undefined} />);

    expect(await screen.findByText("Procjena konačnog troška (EAC)")).toBeInTheDocument();
    expect(screen.getByText(/Procjena, ne knjiga/)).toBeInTheDocument();
    expect(screen.getByText("80000.00")).toBeInTheDocument();
  });

  it("pri 0 % napretka EAC se NE ispisuje — nula bi bila laž", async () => {
    mockApi({
      ...PROFITABILITY,
      eac: { kind: "EAC_ESTIMATE", amount: null, progress_pct: 0, reason: "NO_PROGRESS" },
    });
    render(<ProjectOverview projectId="prj_1" canManage={false} onOpenTab={() => undefined} />);

    await waitFor(() => expect(screen.getByText("Procjena konačnog troška (EAC)")).toBeInTheDocument());
    expect(screen.queryByText("0.00")).not.toBeInTheDocument();
    expect(screen.getByText(/Procjena nije moguća pri 0 % napretka/)).toBeInTheDocument();
  });

  it("trošak bez cijene je BROJ ZAPISA, odvojen od novca", async () => {
    mockApi();
    render(<ProjectOverview projectId="prj_1" canManage={false} onOpenTab={() => undefined} />);

    expect(await screen.findByText(/2 zapisa još nema cijenu/)).toBeInTheDocument();
    expect(screen.getByText(/ne ulazi u zbroj/)).toBeInTheDocument();
  });

  it("nema ozbiljnih a11y prekršaja", async () => {
    mockApi();
    const { container } = render(
      <ProjectOverview projectId="prj_1" canManage onOpenTab={() => undefined} />,
    );
    await screen.findByText("105000.00");
    await expectNoSeriousA11yViolations(container);
  });
});
