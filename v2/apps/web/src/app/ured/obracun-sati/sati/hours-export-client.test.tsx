// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { HoursExportClient } from "./hours-export-client";
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation",()=>({useRouter:()=>({push:routerPush})}));
afterEach(()=>vi.restoreAllMocks());
describe("brzi izvoz radnih sati",()=>{
  it("PDF i XLSX koriste tačan izabrani period",async()=>{
    const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue({ok:true,blob:async()=>new Blob(["file"])} as Response);
    const create=vi.fn(()=>"blob:test"),revoke=vi.fn();
    vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:create,revokeObjectURL:revoke}));
    vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
    const {container}=render(<HoursExportClient initialFrom="2026-01-01" initialTo="2026-01-31" initialRows={[]} canReportExport />);
    await userEvent.click(screen.getByRole("button",{name:"Preuzmi PDF"}));
    expect(fetchMock).toHaveBeenCalledWith("/api/reports/WORK_HOURS?from=2026-01-01&to=2026-01-31&format=pdf",expect.any(Object));
    await userEvent.click(screen.getByRole("button",{name:"Preuzmi XLSX"}));
    expect(fetchMock).toHaveBeenCalledWith("/api/reports/WORK_HOURS?from=2026-01-01&to=2026-01-31&format=xlsx",expect.any(Object));
    await expectNoSeriousA11yViolations(container);
    vi.unstubAllGlobals();
  });
  it("izmijenjeni period prvo treba primijeniti na listu",async()=>{
    render(<HoursExportClient initialFrom="2026-01-01" initialTo="2026-01-31" initialRows={[]} canReportExport />);
    await userEvent.clear(screen.getByLabelText("Od"));
    await userEvent.type(screen.getByLabelText("Od"),"2026-01-02");
    expect(screen.getByRole("button",{name:"Preuzmi PDF"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Preuzmi CSV"})).toBeDisabled();
    await userEvent.click(screen.getByRole("button",{name:"Prikaži"}));
    expect(routerPush).toHaveBeenCalledWith("/ured/obracun-sati/sati?from=2026-01-02&to=2026-01-31");
  });
  it("PDF i XLSX nisu ponuđeni bez dozvole",()=>{
    render(<HoursExportClient initialFrom="2026-01-01" initialTo="2026-01-31" initialRows={[]} />);
    expect(screen.queryByRole("button",{name:"Preuzmi PDF"})).toBeNull();
    expect(screen.queryByRole("button",{name:"Preuzmi XLSX"})).toBeNull();
  });
});
