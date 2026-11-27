// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { WorkerOverviewPanel } from "./worker-overview";
import type { WorkerOverview } from "@/server/worker-overview";

describe("Pregled radnika", () => {
  it("razlikuje nedostajuće podatke od nule i prikazuje četiri KPI-ja", async () => {
    const data: WorkerOverview = {linked:true,today:"2026-11-18",minutes:450,dayCount:1,current:null,
      obligations:[{label:"Ljekarski",expiresAt:"2026-12-01",state:"valid"}],leaveBalance:null};
    const {container} = render(<WorkerOverviewPanel data={data} />);
    expect(screen.getByText("7 h 30 min")).toBeTruthy();
    expect(screen.getByText("Nema unosa")).toBeTruthy();
    expect(screen.getByText("1 / 1")).toBeTruthy();
    expect(screen.getByText("Nije upisano")).toBeTruthy();
    expect(screen.getByText(/Ljekarski/)).toBeTruthy();
    await expectNoSeriousA11yViolations(container);
  });
  it("daje jasan korak kad račun nije povezan s radnikom", async () => {
    const {container} = render(<WorkerOverviewPanel data={{linked:false,ambiguous:false}} />);
    expect(screen.getByText(/još nije povezan s radnikom/)).toBeTruthy();
    expect(screen.getByRole("link", {name:"Provjerite svoj profil"})).toHaveAttribute("href", "/ured/profil");
    await expectNoSeriousA11yViolations(container);
  });
  it("rok koji ističe danas i dokument pred provjeru broji kao važeći, odbijeni ne", () => {
    const data: WorkerOverview = {linked:true,today:"2026-11-18",minutes:0,dayCount:0,current:null,leaveBalance:0,
      obligations:[{label:"Ističe",expiresAt:"2026-11-18",state:"expiring"},{label:"Provjera",expiresAt:null,state:"review_due"},{label:"Čeka",expiresAt:"2026-12-01",state:"pending_review"},{label:"Odbijeno",expiresAt:"2026-12-01",state:"rejected"}]};
    render(<WorkerOverviewPanel data={data} />);
    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect(screen.getByText("0 dana")).toBeTruthy();
  });

});
